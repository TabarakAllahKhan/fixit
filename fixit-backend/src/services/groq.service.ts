import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { logGroqProviderFailure } from '../utils/aiDiagnostics.js';
import { ForcedToolNotCalledError } from '../utils/aiErrors.js';
import { HttpError } from '../utils/httpError.js';

type CompletionParams = Parameters<Groq['chat']['completions']['create']>[0];
type Completion = Extract<Awaited<ReturnType<Groq['chat']['completions']['create']>>, { choices: unknown }>;

// The only place that constructs a Groq client. The API key is read from the
// validated backend environment and never accepted from requests or logs.

let client: Groq | null = null;

function getClient(): Groq {
  if (!env.GROQ_API_KEY) {
    throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI provider is not configured');
  }
  if (!client) {
    client = new Groq({ apiKey: env.GROQ_API_KEY, maxRetries: 0 });
  }
  return client;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError');
}

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  // Do not immediately retry rate limits: that adds pressure during a 429 and
  // can extend the limiting window. The caller receives a stable 503 instead.
  return isAbort(error) || (status !== undefined && status >= 500);
}

function providerCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const body = (error as { error?: unknown }).error;
  if (!body || typeof body !== 'object') return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function providerMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (!error || typeof error !== 'object') return '';
  const direct = (error as { message?: unknown }).message;
  if (typeof direct === 'string') return direct;
  const body = (error as { error?: { message?: unknown } }).error;
  return body && typeof body.message === 'string' ? body.message : '';
}

function forcesSpecificTool(toolChoice: CompletionParams['tool_choice']): boolean {
  return Boolean(
    toolChoice && typeof toolChoice === 'object' && (toolChoice as { type?: unknown }).type === 'function',
  );
}

// Narrowly identifies the one provider failure eligible for a deterministic
// fallback. Status, provider code and provider wording must all match; a
// generic 400, a different tool_use_failed reason, or a plain-text 200 does not.
function isMissingForcedToolCall(error: unknown): boolean {
  return (
    statusOf(error) === 400 &&
    providerCodeOf(error) === 'tool_use_failed' &&
    /did not call a tool/i.test(providerMessageOf(error))
  );
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;

  const status = statusOf(error);
  if (isAbort(error)) {
    return new HttpError(504, 'AI_TIMEOUT', 'AI provider timed out');
  }
  if (status === 429) {
    return new HttpError(503, 'AI_RATE_LIMITED', 'AI provider is rate limited');
  }
  if (status === 400 || status === 422) {
    // A provider-side rejection (for example an unsupported tool choice) is
    // classified separately from malformed model output. The message stays
    // generic; the sanitized diagnostic log carries the useful detail.
    return new HttpError(502, 'AI_PROVIDER_REJECTED', 'AI provider rejected the request');
  }
  if (status === 401 || status === 403) {
    return new HttpError(503, 'AI_NOT_CONFIGURED', 'AI provider credentials are invalid');
  }
  if (status !== undefined && status >= 500) {
    return new HttpError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable');
  }
  return new HttpError(502, 'AI_INVALID_RESPONSE', 'AI provider returned an invalid response');
}

async function request(params: CompletionParams, timeoutMs: number): Promise<Completion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const completion = await getClient().chat.completions.create(params, {
      signal: controller.signal,
      maxRetries: 0,
    });
    if ('choices' in completion) return completion;
    throw new Error('Streaming completions are not supported');
  } finally {
    clearTimeout(timer);
  }
}

// Diagnostics-only context threaded from the orchestrator. It is used solely
// to label provider-failure logs and never changes the request or retry policy.
export type CompletionDiagnostics = {
  round?: number;
  toolChoice?: unknown;
};

// Per-call bounds. Callers on a latency-sensitive path pass their own
// per-attempt timeout. `timeoutMs` is clamped to 1..120000 ms; it may be
// shorter or longer than GROQ_TIMEOUT_MS. `maxRetries` can only lower
// GROQ_MAX_RETRIES, never raise it. A timed-out attempt or a 5xx counts as
// retryable, so the worst case for one call is
// (1 + effective retries) x timeoutMs. Research passes maxRetries: 0 (one
// attempt of RESEARCH_TIMEOUT_MS). The parts lookup passes only its timeout,
// so it keeps GROQ_MAX_RETRIES: by default 2 x PARTS_TIMEOUT_MS = 20 s.
export type CompletionOptions = {
  timeoutMs?: number;
  maxRetries?: number;
};

function boundedInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.trunc(value), max));
}

export async function createChatCompletion(
  params: CompletionParams,
  diagnostics?: CompletionDiagnostics,
  options?: CompletionOptions,
): Promise<Completion> {
  const timeoutMs = Math.max(1, boundedInt(options?.timeoutMs, env.GROQ_TIMEOUT_MS, 120_000));
  const maxRetries = boundedInt(options?.maxRetries, env.GROQ_MAX_RETRIES, env.GROQ_MAX_RETRIES);
  let attempt = 0;
  while (true) {
    try {
      return await request(params, timeoutMs);
    } catch (error) {
      if (attempt < maxRetries && isRetryable(error)) {
        attempt += 1;
        continue;
      }
      // HttpError here is a local configuration failure, not a provider response.
      if (!(error instanceof HttpError)) {
        logGroqProviderFailure({
          model: params.model,
          error,
          round: diagnostics?.round,
          toolChoice: diagnostics?.toolChoice ?? params.tool_choice,
        });
        // Only a forced final tool call that the model did not emit degrades to
        // the safe fallback. Every other failure keeps its existing mapping.
        if (forcesSpecificTool(params.tool_choice) && isMissingForcedToolCall(error)) {
          throw new ForcedToolNotCalledError();
        }
      }
      throw toHttpError(error);
    }
  }
}
