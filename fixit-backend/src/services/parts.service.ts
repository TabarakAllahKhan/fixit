import { env } from '../config/env.js';
import { createChatCompletion } from './groq.service.js';
import {
  compatibilitySchema,
  type PartCandidateDto,
  type PartsDto,
} from '../validators/ai.validator.js';
import { extractBrowserResults } from '../utils/groqBrowserResponse.js';
import { containsExactToken } from '../utils/textMatching.js';
import {
  canonicalUrlKey,
  isValidAllowedHttpsUrl,
  matchAllowedDomain,
  parseAllowedDomains,
  parseAllowedHttpsUrl,
} from '../utils/trustedSource.js';

export type PartsQuery = {
  brand: string;
  modelNumber: string;
  // Only the identity resolver may set this. Its presence proves the model is
  // backed by a fresh registered appliance or versioned USER_MESSAGE evidence.
  modelSource: 'APPLIANCE' | 'USER_MESSAGE';
  component: string;
  partNumber?: string;
};

function domainList(): string[] {
  return parseAllowedDomains(env.PARTS_ALLOWED_DOMAINS);
}

export function isValidPartsUrl(value: string): boolean {
  return isValidAllowedHttpsUrl(value, domainList());
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

  const domains = domainList();
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
    search_settings: { include_domains: domains },
  }, undefined, { timeoutMs: env.PARTS_TIMEOUT_MS });

  const candidates: PartCandidateDto[] = [];
  const seen = new Set<string>();
  for (const raw of extractBrowserResults(completion)) {
    if (candidates.length >= env.PARTS_MAX_RESULTS) break;
    // The URL hint is best-effort; backend allowlist validation is authoritative.
    const validated = parseAllowedHttpsUrl(raw.url, domains);
    if (!validated) continue;
    const key = canonicalUrlKey(validated.url);
    if (seen.has(key)) continue;
    seen.add(key);

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
        trustedSource: matchAllowedDomain(validated.hostname, domains) !== null,
      }),
    );

    candidates.push({
      partName: title,
      sourceName: sourceNameFromUrl(validated.url),
      url: validated.url,
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
