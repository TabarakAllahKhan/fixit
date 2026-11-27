import { z } from 'zod';

// Groq browser-search responses are provider output: every field is optional in
// practice. This adapter reads the shape observed in the live Phase 2A request
// first and never falls back to the model narrative or `tool.output` text.

const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;
const MAX_CONTENT_LENGTH = 20_000;
const DEFAULT_MAX_RESULTS = 50;

const boundedTitle = z.preprocess(
  (value) => (typeof value === 'string' ? value.slice(0, MAX_TITLE_LENGTH) : undefined),
  z.string().trim().min(1).max(MAX_TITLE_LENGTH),
);

const boundedUrl = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_URL_LENGTH) : undefined),
  z.string().min(1).max(MAX_URL_LENGTH),
);

const optionalContent = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() !== '' ? value.slice(0, MAX_CONTENT_LENGTH) : undefined,
  z.string().trim().max(MAX_CONTENT_LENGTH).optional(),
);

const optionalScore = z.preprocess(
  (value) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined,
  z.number().min(0).max(1).optional(),
);

const browserResultSchema = z.object({
  title: boundedTitle,
  url: boundedUrl,
  content: optionalContent,
  score: optionalScore,
});

export type BrowserResultKind = 'SEARCH_RESULT' | 'OPENED_PAGE';

export type BrowserResult = {
  title: string;
  url: string;
  kind: BrowserResultKind;
  content?: string;
  score?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function kindOf(tool: Record<string, unknown>): BrowserResultKind | null {
  const name = typeof tool.name === 'string' ? tool.name : '';
  const type = typeof tool.type === 'string' ? tool.type : '';
  if (name === 'browser.open' || type === 'browser.open') return 'OPENED_PAGE';
  if (name === 'browser.search' || type === 'browser_search') return 'SEARCH_RESULT';
  // Legacy bundled results have no reliable tool label; treat them as search
  // results rather than discarding a previously supported response shape.
  return null;
}

function resultsFromTool(tool: unknown): { kind: BrowserResultKind; results: unknown[] } | null {
  const record = asRecord(tool);
  if (!record) return null;

  const kind = kindOf(record);
  // Only the verified path is trusted enough to classify an opened page.
  // `browser_results` is a legacy search-only fallback.
  const live = asRecord(record.search_results);
  if (Array.isArray(live?.results) && kind !== null) {
    return { kind, results: live.results };
  }
  if (Array.isArray(live?.results)) {
    return { kind: 'SEARCH_RESULT', results: live.results };
  }
  if (Array.isArray(record.browser_results)) {
    return { kind: kind ?? 'SEARCH_RESULT', results: record.browser_results };
  }
  return null;
}

function normalizeResult(value: unknown, kind: BrowserResultKind): BrowserResult | null {
  const parsed = browserResultSchema.safeParse(value);
  if (!parsed.success) return null;

  return {
    title: parsed.data.title,
    url: parsed.data.url,
    kind,
    ...(parsed.data.content ? { content: parsed.data.content } : {}),
    ...(parsed.data.score !== undefined ? { score: parsed.data.score } : {}),
  };
}

export function extractBrowserResults(completion: unknown, maxResults = DEFAULT_MAX_RESULTS): BrowserResult[] {
  if (!Number.isFinite(maxResults) || maxResults <= 0) return [];

  const root = asRecord(completion);
  const choices = root?.choices;
  if (!Array.isArray(choices)) return [];

  const results: BrowserResult[] = [];
  for (const choice of choices) {
    const message = asRecord(asRecord(choice)?.message);
    const tools = message?.executed_tools;
    if (!Array.isArray(tools)) continue;

    for (const tool of tools) {
      const extracted = resultsFromTool(tool);
      if (!extracted) continue;
      for (const candidate of extracted.results) {
        const result = normalizeResult(candidate, extracted.kind);
        if (!result) continue;
        results.push(result);
        if (results.length >= maxResults) return results;
      }
    }
  }
  return results;
}
