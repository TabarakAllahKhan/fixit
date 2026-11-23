import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { logGeminiProviderFailure } from '../../utils/aiDiagnostics.js';
import { ForcedToolNotCalledError } from '../../utils/aiErrors.js';
import { HttpError } from '../../utils/httpError.js';

// Provider-neutral boundary for the diagnosis agent. The orchestrator works
// only with these types; all Gemini-specific request/response shapes stay in
// this module. Exactly one interaction is created per call: no retries, no SDK
// continuation hops and no parallel model calls for a single turn.

export type AiFunctionDeclaration = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

// Steps are passed through verbatim when replaying stateless history. Gemini
// may attach fields such as `signature` to model-generated steps; dropping them
// would invalidate the next request.
export type AiStep = { type: string; [key: string]: unknown };

export type AiToolChoice = { mode: 'any' } | { mode: 'specific'; name: string };

export type AiProviderRequest = {
  systemInstruction: string;
  steps: readonly AiStep[];
  tools: readonly AiFunctionDeclaration[];
  toolChoice: AiToolChoice;
};

export type AiFunctionCall = {
  id: string;
  name: string;
  arguments: unknown;
  // The unmodified provider step, replayed in the next stateless request.
  step: AiStep;
};

export type AiProviderResponse = {
  calls: AiFunctionCall[];
  text: string;
  // All model-generated steps exactly as received. Stateless Gemini history
  // requires thoughts, signatures and function calls to be replayed verbatim.
  steps: AiStep[];
  finishReason?: string;
};

export type ProviderDiagnostics = {
  round?: number;
  toolChoice?: AiToolChoice;
};

type GeminiInteractionLike = {
  id?: string;
  status?: string;
  output_text?: string;
  outputText?: string;
  steps?: unknown;
};

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!env.GOOGLE_API_KEY) {
    throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI provider is not configured');
  }
  if (!client) {
    // The SDK is constructed without retries; per-request options below repeat
    // that policy explicitly so a future SDK default cannot re-enable them.
    client = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
  }
  return client;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function statusOf(error: unknown): number | undefined {
  const record = asRecord(error);
  if (!record) return undefined;
  for (const candidate of [record.status, record.code, asRecord(record.response)?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function codeOf(error: unknown): string | undefined {
  const record = asRecord(error);
  if (!record) return undefined;
  for (const candidate of [record.code, asRecord(record.error)?.code, record.type, asRecord(record.error)?.type]) {
    if (typeof candidate === 'string') return candidate;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const record = asRecord(error);
  if (!record) return '';
  for (const candidate of [record.message, asRecord(record.error)?.message]) {
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

function textMatches(error: unknown, pattern: RegExp): boolean {
  return pattern.test(`${codeOf(error) ?? ''} ${messageOf(error)}`);
}

function isQuotaFailure(error: unknown): boolean {
  return statusOf(error) === 429 || textMatches(error, /resource[_-]?exhausted|quota|rate[_-]?limit|too many requests|\b429\b/i);
}

function isPermissionFailure(error: unknown): boolean {
  return (
    statusOf(error) === 403 ||
    textMatches(error, /permission[_-]?denied|permission denied|not permitted|\b403\b/i)
  );
}

function isTimeout(error: unknown): boolean {
  if (error instanceof Error && ['AbortError', 'APIUserAbortError', 'TimeoutError'].includes(error.name)) {
    return true;
  }
  const record = asRecord(error);
  const name = record?.name;
  return (
    (typeof name === 'string' && ['AbortError', 'APIUserAbortError', 'TimeoutError'].includes(name)) ||
    /timed out|timeout/i.test(messageOf(error))
  );
}

// Stable, client-safe mapping. Provider text and request details are never
// copied into the response; they go only to the sanitized diagnostic logger.
function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;

  const status = statusOf(error);
  if (isQuotaFailure(error)) {
    return new HttpError(503, 'AI_RATE_LIMITED', 'AI provider is rate limited');
  }
  if (isPermissionFailure(error) || status === 401) {
    return new HttpError(503, 'AI_NOT_CONFIGURED', 'AI provider credentials are invalid');
  }
  if (isTimeout(error)) {
    return new HttpError(504, 'AI_TIMEOUT', 'AI provider timed out');
  }
  if (status === 400 || status === 422) {
    return new HttpError(502, 'AI_PROVIDER_REJECTED', 'AI provider rejected the request');
  }
  if (status !== undefined && status >= 500) {
    return new HttpError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable');
  }
  return new HttpError(502, 'AI_INVALID_RESPONSE', 'AI provider returned an invalid response');
}

function stepRecord(value: unknown): AiStep | null {
  const record = asRecord(value);
  return typeof record?.type === 'string' ? (record as AiStep) : null;
}

function functionCalls(steps: readonly AiStep[]): AiFunctionCall[] {
  const calls: AiFunctionCall[] = [];
  for (const step of steps) {
    if (step.type !== 'function_call') continue;
    calls.push({
      id: typeof step.id === 'string' ? step.id : '',
      name: typeof step.name === 'string' ? step.name : '',
      arguments: step.arguments,
      step,
    });
  }
  return calls;
}

function outputText(interaction: GeminiInteractionLike): string {
  if (typeof interaction.output_text === 'string') return interaction.output_text;
  if (typeof interaction.outputText === 'string') return interaction.outputText;
  return '';
}

function generationConfig(request: AiProviderRequest): Record<string, unknown> {
  return {
    thinking_level: env.GEMINI_THINKING_LEVEL,
    max_output_tokens: env.GEMINI_MAX_OUTPUT_TOKENS,
    tool_choice:
      request.toolChoice.mode === 'any'
        ? 'any'
        : { allowed_tools: { mode: 'any', tools: [request.toolChoice.name] } },
  };
}

export async function createAiInteraction(
  request: AiProviderRequest,
  diagnostics?: ProviderDiagnostics,
): Promise<AiProviderResponse> {
  try {
    const params = {
      // The validated env value is the single approved free-tier model. It is
      // never overridden per request and there is no fallback model.
      model: env.GEMINI_MODEL,
      generation_config: generationConfig(request),
      system_instruction: request.systemInstruction,
      input: request.steps,
      tools: request.tools,
      // Stateless: the orchestrator owns the bounded history and replays it.
      store: false,
    };
    const interaction = (await getClient().interactions.create(
      { automatic_continuation: false, ...params } as never,
      {
        retries: { strategy: 'none' },
        retry_codes: [],
        maxRetries: 0,
        timeout_ms: env.GEMINI_TIMEOUT_MS,
      } as never,
    )) as GeminiInteractionLike;

    const rawSteps = Array.isArray(interaction.steps) ? interaction.steps : [];
    const steps = rawSteps
      .map(stepRecord)
      .filter((step): step is AiStep => step !== null);
    const calls = functionCalls(steps);

    // Mirrors the previous provider rejection for a forced final tool that the
    // model did not emit. Only the orchestrator's final round reacts to it with
    // the deterministic fallback; all other rounds keep the normal error path.
    if (request.toolChoice.mode === 'specific' && calls.length === 0) {
      throw new ForcedToolNotCalledError();
    }

    return {
      calls,
      text: outputText(interaction),
      steps,
      ...(typeof interaction.status === 'string' ? { finishReason: interaction.status } : {}),
    };
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logGeminiProviderFailure({
        model: env.GEMINI_MODEL,
        error,
        round: diagnostics?.round,
        toolChoice: diagnostics?.toolChoice ?? request.toolChoice,
      });
    }
    throw toHttpError(error);
  }
}
