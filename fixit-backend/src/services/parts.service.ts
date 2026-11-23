import { isIP } from 'node:net';
import { z } from 'zod';
import { env } from '../config/env.js';
import { createChatCompletion } from './groq.service.js';
import {
  compatibilitySchema,
  type PartCandidateDto,
  type PartsDto,
} from '../validators/ai.validator.js';

export type PartsQuery = {
  brand: string;
  modelNumber: string;
  // Only the identity resolver may set this. Its presence proves the model is
  // backed by a fresh registered appliance or versioned USER_MESSAGE evidence.
  modelSource: 'APPLIANCE' | 'USER_MESSAGE';
  component: string;
  partNumber?: string;
};

const rawBrowserResultSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().min(1).max(2048),
  content: z.string().max(20_000).optional(),
});

function domainList(): string[] {
  return env.PARTS_ALLOWED_DOMAINS.split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter((domain) => /^[a-z0-9.-]{1,253}$/.test(domain) && !domain.includes('..'));
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return domainList().some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isValidPartsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) return false;
    return isAllowedHost(url.hostname);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exact, delimiter-bounded matching prevents a shorter query model from being
// “confirmed” by a longer, merely similar model number. Match the literal text
// instead of a stripped string: stripping punctuation removes the boundaries
// that make this check safe.
function containsExactToken(text: string, value: string): boolean {
  const needle = value.trim();
  if (!needle) return false;
  const pattern = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(needle)}(?=$|[^A-Z0-9])`, 'i');
  return pattern.test(text);
}

function componentTokens(component: string): string[] {
  return component
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length >= 3);
}

const COMPATIBILITY_CUE =
  /\b(fits?|fit for|compatible with|compatibility|for model|designed for|replaces?|used (?:in|on)|applies to|suitable for)\b/i;
const NEGATED_COMPATIBILITY =
  /\b(not|does not|doesn't|will not|won't|never)\b[\s\S]{0,60}\b(fit|fits|compatible|compatibility|suitable)\b/i;

export function buildPartsQuery(query: PartsQuery): string {
  return [
    query.brand,
    query.modelNumber,
    query.component,
    'replacement part',
    query.partNumber ? `part ${query.partNumber}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}

export function classifyCompatibility(input: {
  query: PartsQuery;
  sourceText: string;
  trustedSource: boolean;
}): PartCandidateDto['compatibility'] {
  const exactModel = containsExactToken(input.sourceText, input.query.modelNumber);
  const exactPartNumber = Boolean(
    input.query.partNumber && containsExactToken(input.sourceText, input.query.partNumber),
  );
  const tokens = componentTokens(input.query.component);
  const exactComponent = tokens.length > 0 && tokens.every((token) => containsExactToken(input.sourceText, token));
  const partEvidence = exactPartNumber || exactComponent;

  // An explicit statement of non-compatibility must never become a match.
  if (NEGATED_COMPATIBILITY.test(input.sourceText)) return 'UNKNOWN';

  if (
    input.query.modelSource &&
    input.trustedSource &&
    exactModel &&
    partEvidence &&
    COMPATIBILITY_CUE.test(input.sourceText)
  ) {
    return 'VERIFIED';
  }
  if (exactModel || partEvidence) return 'POSSIBLE_MATCH';
  return 'UNKNOWN';
}

function compatibilityReason(compatibility: PartCandidateDto['compatibility']): string {
  if (compatibility === 'VERIFIED') {
    return 'Allowlisted source explicitly confirms the exact model and relevant replacement part.';
  }
  if (compatibility === 'POSSIBLE_MATCH') {
    return 'Credible source appears relevant, but exact model/part compatibility is not conclusive.';
  }
  return 'Insufficient evidence; do not rely on this result for compatibility.';
}

function sourceNameFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').slice(0, 200);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function extractBrowserResults(completion: {
  choices?: Array<{ message?: { executed_tools?: unknown } }>;
}): z.infer<typeof rawBrowserResultSchema>[] {
  const tools = completion.choices?.[0]?.message?.executed_tools;
  if (!Array.isArray(tools)) return [];

  const results: z.infer<typeof rawBrowserResultSchema>[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const browserResults = (tool as { browser_results?: unknown }).browser_results;
    if (!Array.isArray(browserResults)) continue;
    for (const candidate of browserResults) {
      const parsed = rawBrowserResultSchema.safeParse(candidate);
      if (parsed.success) results.push(parsed.data);
    }
  }
  return results;
}

export async function searchReplacementParts(query: PartsQuery): Promise<PartsDto> {
  if (env.PARTS_PROVIDER !== 'groq_browser') {
    return { note: 'Parts search is disabled by configuration.', candidates: [] };
  }

  if (!query.brand || !query.modelNumber || !query.component) {
    return {
      note: 'Exact brand, model number and component are required before parts discovery.',
      candidates: [],
    };
  }

  // A model without trusted provenance must never reach a model-specific
  // provider call or become the basis of a VERIFIED compatibility claim.
  if (query.modelSource !== 'APPLIANCE' && query.modelSource !== 'USER_MESSAGE') {
    return {
      note: 'A trusted appliance model is required before model-specific parts discovery.',
      candidates: [],
    };
  }

  const completion = await createChatCompletion({
    model: env.GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'Use browser search only. Return factual replacement-part sources; do not invent products, prices, availability, part numbers, URLs or compatibility.',
      },
      { role: 'user', content: buildPartsQuery(query) },
    ],
    tools: [{ type: 'browser_search' }],
    tool_choice: 'required',
    temperature: 0.2,
    max_completion_tokens: 900,
    reasoning_effort: 'low',
    search_settings: { include_domains: domainList() },
  });

  const candidates: PartCandidateDto[] = [];
  const seen = new Set<string>();
  for (const raw of extractBrowserResults(completion)) {
    if (candidates.length >= env.PARTS_MAX_RESULTS) break;
    if (!isValidPartsUrl(raw.url) || seen.has(raw.url)) continue;
    seen.add(raw.url);

    const title = truncate(raw.title, 200);
    const content = raw.content ?? '';
    const sourceText = `${title}\n${content}`;
    const exactModel = containsExactToken(sourceText, query.modelNumber);
    const exactPartNumber = Boolean(
      query.partNumber && containsExactToken(sourceText, query.partNumber),
    );
    const tokens = componentTokens(query.component);
    const componentRelevant = tokens.some((token) => containsExactToken(sourceText, token));

    // Reject malformed and clearly irrelevant provider results. Relevant but
    // inconclusive results are retained with UNKNOWN compatibility.
    if (!exactModel && !exactPartNumber && !componentRelevant) continue;

    const compatibility = compatibilitySchema.parse(
      classifyCompatibility({
        query,
        sourceText,
        trustedSource: isAllowedHost(new URL(raw.url).hostname),
      }),
    );

    candidates.push({
      partName: title,
      sourceName: sourceNameFromUrl(raw.url),
      url: raw.url,
      compatibility,
      reason: compatibilityReason(compatibility),
      ...(exactPartNumber && query.partNumber ? { partNumber: query.partNumber } : {}),
    });
  }

  return {
    note:
      candidates.length === 0
        ? 'No validated parts sources were returned. Compatibility remains unknown.'
        : 'Compatibility was classified from source evidence by the backend; verify with the seller before purchase.',
    modelNumberUsed: query.modelNumber,
    candidates,
  };
}
