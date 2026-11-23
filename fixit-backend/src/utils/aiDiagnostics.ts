import { env } from '../config/env.js';

// Structured diagnostics for the AI layer. Only explicitly allowlisted fields
// are emitted, and every string is redacted before it reaches stdout/stderr.
// Conversation content, tool arguments, raw response bodies and credentials
// are never passed to these helpers.

const MAX_MESSAGE_LENGTH = 300;
const MAX_TOKEN_LENGTH = 120;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function redactKnownSecrets(value: string): string {
  let result = value;

  // Exact configured values first. Empty/short placeholders are ignored so a
  // generic word like "test" cannot redact unrelated diagnostic text.
  const secrets = [env.GOOGLE_API_KEY, env.GROQ_API_KEY, env.DATABASE_URL].filter(
    (secret): secret is string => typeof secret === 'string' && secret.length >= 8,
  );
  for (const secret of secrets) {
    result = result.split(secret).join('[REDACTED]');
  }

  // Credentials embedded in URLs, e.g. postgresql://user:password@host/db.
  result = result.replace(/([a-z][a-z\d+.-]*:\/\/)([^\s/@]+):([^\s/@]+)@/gi, '$1[REDACTED]@');

  // Common key/value secret assignments in provider error strings.
  result = result.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*(["']?)[^\s"',;}]+\2/gi,
    '$1=[REDACTED]',
  );

  return result;
}

function safeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return truncate(redactKnownSecrets(value), MAX_MESSAGE_LENGTH);
}

function safeToken(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const token = value.trim();
  if (!/^[A-Za-z0-9_.:/@-]{1,120}$/.test(token)) return fallback;
  return truncate(redactKnownSecrets(token), MAX_TOKEN_LENGTH);
}

function classNameOf(error: unknown): string | undefined {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
  const ctor = (error as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' ? ctor.name : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  const record = asRecord(headers);
  if (!record) return undefined;
  const get = record.get;
  if (typeof get === 'function') {
    try {
      const value = get.call(headers, name);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }
  const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  return typeof direct === 'string' ? direct : undefined;
}

function emit(level: 'error' | 'warn', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.warn(line);
}

export type ProviderFailureDetails = {
  model: unknown;
  error: unknown;
  // 0-based orchestration loop index (round 0 = initial tool choice). Omitted
  // for callers outside the diagnosis orchestrator.
  round?: number;
  // The effective tool_choice actually sent with the request.
  toolChoice?: unknown;
};

function safeToolChoice(value: unknown): string | undefined {
  if (typeof value === 'string') return safeToken(value);
  const choice = asRecord(value);
  if (!choice) return undefined;
  const mode = choice.mode;
  if (mode === 'any') return 'any';
  if (mode === 'specific') {
    return `function:${typeof choice.name === 'string' ? (safeToken(choice.name) ?? 'unknown') : 'unknown'}`;
  }
  const name = asRecord(choice.function)?.name;
  return typeof name === 'string' ? `function:${safeToken(name) ?? 'unknown'}` : undefined;
}

export function logGroqProviderFailure({ model, error, round, toolChoice }: ProviderFailureDetails): void {
  const record = asRecord(error);
  const body = asRecord(record?.error);
  const status = record?.status;
  const rawMessage = error instanceof Error ? error.message : record?.message;
  // Groq returns the rejected completion in `failed_generation` on tool-use
  // failures. It may echo user text, so it goes through the same redaction and
  // truncation as provider messages before it is ever emitted.
  const rawFailedGeneration =
    body?.failed_generation ??
    body?.failedGeneration ??
    record?.failed_generation ??
    record?.failedGeneration;
  const rawRequestId =
    headerValue(record?.headers, 'x-request-id') ??
    headerValue(record?.headers, 'x-groq-request-id') ??
    body?.request_id ??
    body?.requestId ??
    record?.request_id ??
    record?.requestId;

  emit('error', 'groq.provider_failure', {
    model: safeToken(model, 'unknown'),
    errorClass: safeToken(classNameOf(error), 'unknown'),
    errorName: safeToken(record?.name),
    status: typeof status === 'number' && Number.isFinite(status) ? status : undefined,
    round: typeof round === 'number' && Number.isFinite(round) ? round : undefined,
    toolChoice: safeToolChoice(toolChoice),
    providerErrorType: safeToken(body?.type ?? record?.type),
    providerErrorCode: safeToken(body?.code ?? record?.code),
    providerErrorMessage: safeMessage(rawMessage),
    providerFailedGeneration: safeMessage(rawFailedGeneration),
    providerRequestId: safeToken(rawRequestId),
  });
}

// Gemini provider failures use the same allowlist/redaction rules as the legacy
// Groq logger. No conversation content, tool arguments, response bodies or
// credentials are emitted.
export function logGeminiProviderFailure({
  model,
  error,
  round,
  toolChoice,
}: ProviderFailureDetails): void {
  const record = asRecord(error);
  const body = asRecord(record?.error);
  const status = record?.status ?? (typeof record?.code === 'number' ? record.code : undefined);
  const rawMessage = error instanceof Error ? error.message : record?.message;
  const rawRequestId =
    headerValue(record?.headers, 'x-request-id') ??
    headerValue(record?.headers, 'x-goog-request-id') ??
    body?.request_id ??
    body?.requestId ??
    record?.request_id ??
    record?.requestId;

  emit('error', 'gemini.provider_failure', {
    model: safeToken(model, 'unknown'),
    errorClass: safeToken(classNameOf(error), 'unknown'),
    errorName: safeToken(record?.name),
    status: typeof status === 'number' && Number.isFinite(status) ? status : undefined,
    round: typeof round === 'number' && Number.isFinite(round) ? round : undefined,
    toolChoice: safeToolChoice(toolChoice),
    providerErrorCode: safeToken(body?.code ?? record?.code),
    providerErrorMessage: safeMessage(rawMessage),
    providerRequestId: safeToken(rawRequestId),
  });
}

export type ToolFailureDetails = {
  reason: string;
  round: number;
  toolName?: unknown;
  finishReason?: unknown;
  toolCallCount?: number;
  totalToolCalls?: number;
  zodIssuePaths?: readonly (readonly (string | number)[])[];
};

export function logAiToolFailure(details: ToolFailureDetails): void {
  emit('error', 'ai.tool_failure', {
    reason: safeMessage(details.reason) ?? 'tool call failed',
    round: Number.isFinite(details.round) ? details.round : undefined,
    toolName: safeToken(details.toolName, 'unknown'),
    finishReason: safeToken(details.finishReason),
    toolCallCount:
      typeof details.toolCallCount === 'number' && Number.isFinite(details.toolCallCount)
        ? details.toolCallCount
        : undefined,
    totalToolCalls:
      typeof details.totalToolCalls === 'number' && Number.isFinite(details.totalToolCalls)
        ? details.totalToolCalls
        : undefined,
    zodIssuePaths: details.zodIssuePaths?.map((path) => path.map((segment) => String(segment))),
  });
}
