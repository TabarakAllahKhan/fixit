import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import { createChatCompletion } from '../../src/services/groq.service.js';
import { ForcedToolNotCalledError } from '../../src/utils/aiErrors.js';

const originalMaxRetries = env.GROQ_MAX_RETRIES;
const originalGroqApiKey = env.GROQ_API_KEY;
const originalDatabaseUrl = env.DATABASE_URL;
let logSpy: ReturnType<typeof vi.spyOn>;
const capturedLogs: string[] = [];

const params = {
  model: 'openai/gpt-oss-20b',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

const success = { choices: [{ message: { role: 'assistant', content: 'ok' } }] };

function providerFailureLogs(): Array<Record<string, unknown>> {
  return capturedLogs.flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  }).filter((entry) => entry.event === 'groq.provider_failure');
}

beforeEach(() => {
  capturedLogs.length = 0;
  logSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') capturedLogs.push(arg);
    }
  });
  createMock.mockReset();
  env.GROQ_MAX_RETRIES = 0;
});

afterEach(() => {
  env.GROQ_MAX_RETRIES = originalMaxRetries;
  env.GROQ_API_KEY = originalGroqApiKey;
  env.DATABASE_URL = originalDatabaseUrl;
  logSpy.mockRestore();
});

describe('createChatCompletion', () => {
  it('passes a bounded request with SDK retries disabled', async () => {
    createMock.mockResolvedValueOnce(success);

    await expect(createChatCompletion(params as never)).resolves.toBe(success);
    expect(createMock).toHaveBeenCalledWith(
      params,
      expect.objectContaining({ maxRetries: 0, signal: expect.any(AbortSignal) }),
    );
  });

  it('maps provider failures to stable client-safe errors', async () => {
    const cases: Array<[unknown, number, string]> = [
      [{ status: 400 }, 502, 'AI_PROVIDER_REJECTED'],
      [{ status: 401 }, 503, 'AI_NOT_CONFIGURED'],
      [{ status: 403 }, 503, 'AI_NOT_CONFIGURED'],
      [{ status: 422 }, 502, 'AI_PROVIDER_REJECTED'],
      [{ status: 429 }, 503, 'AI_RATE_LIMITED'],
      [{ status: 500 }, 503, 'AI_PROVIDER_UNAVAILABLE'],
      [Object.assign(new Error('aborted'), { name: 'AbortError' }), 504, 'AI_TIMEOUT'],
      [new Error('unexpected'), 502, 'AI_INVALID_RESPONSE'],
    ];

    for (const [providerError, statusCode, code] of cases) {
      createMock.mockRejectedValueOnce(providerError);
      await expect(createChatCompletion(params as never)).rejects.toMatchObject({ statusCode, code });
    }
  });

  it('retries only retryable failures within the configured bound', async () => {
    env.GROQ_MAX_RETRIES = 1;
    createMock.mockRejectedValueOnce({ status: 400 });

    await expect(createChatCompletion(params as never)).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_REJECTED',
    });
    expect(createMock).toHaveBeenCalledTimes(1);

    createMock.mockReset().mockRejectedValueOnce({ status: 429 });
    await expect(createChatCompletion(params as never)).rejects.toMatchObject({
      statusCode: 503,
      code: 'AI_RATE_LIMITED',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('allows a caller to disable retries for a single bounded attempt', async () => {
    env.GROQ_MAX_RETRIES = 2;
    createMock.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce(success);

    await expect(createChatCompletion(params as never, undefined, { maxRetries: 0 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('never lets a caller exceed the configured retry bound', async () => {
    env.GROQ_MAX_RETRIES = 1;
    createMock.mockRejectedValue({ status: 503 });

    await expect(createChatCompletion(params as never, undefined, { maxRetries: 5 })).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('aborts at the caller-supplied timeout and maps it to AI_TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      createMock.mockImplementationOnce(
        (_params: unknown, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      );

      const pending = createChatCompletion(params as never, undefined, { timeoutMs: 8_000, maxRetries: 0 });
      const assertion = expect(pending).rejects.toMatchObject({ statusCode: 504, code: 'AI_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(7_999);
      expect(createMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expose provider errors or API keys', async () => {
    createMock.mockRejectedValueOnce(new Error(`failed with key ${env.GROQ_API_KEY}`));

    let captured: unknown;
    try {
      await createChatCompletion(params as never);
    } catch (error) {
      captured = error;
    }

    expect(captured).toMatchObject({ statusCode: 502, code: 'AI_INVALID_RESPONSE' });
    expect(JSON.stringify(captured)).not.toContain(env.GROQ_API_KEY ?? 'definitely-not-present');
  });

  it('logs sanitized provider failure details without secrets or long bodies', async () => {
    const apiKey = 'gsk_test_secret_abcdefghijklmnop';
    const databaseUrl = 'postgresql://reporting:db-password-123@localhost:5432/fixit';
    env.GROQ_API_KEY = apiKey;
    env.DATABASE_URL = databaseUrl;
    const longMessage = `invalid tool_choice api_key=${apiKey} dsn=${databaseUrl} user poem ${'x'.repeat(400)}`;

    class FakeBadRequestError extends Error {
      status = 422;
      name = 'UnprocessableEntityError';
      headers = new Headers({ 'x-request-id': 'req_42' });
      error = { type: 'invalid_request_error', message: longMessage };
    }

    createMock.mockRejectedValueOnce(new FakeBadRequestError(longMessage));

    await expect(createChatCompletion(params as never)).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_REJECTED',
      message: 'AI provider rejected the request',
    });

    const logs = providerFailureLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      event: 'groq.provider_failure',
      model: 'openai/gpt-oss-20b',
      errorClass: 'FakeBadRequestError',
      errorName: 'UnprocessableEntityError',
      status: 422,
      providerErrorType: 'invalid_request_error',
      providerRequestId: 'req_42',
    });
    expect(typeof logs[0]?.providerErrorMessage).toBe('string');
    expect(String(logs[0]?.providerErrorMessage).length).toBeLessThanOrEqual(300);
    expect(String(logs[0]?.providerErrorMessage)).toContain('[REDACTED]');

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain('db-password-123');
    expect(serialized).not.toContain('x'.repeat(400));
  });

  it('records round, effective tool_choice, provider code and sanitized failed_generation', async () => {
    const apiKey = 'gsk_test_secret_abcdefghijklmnop';
    env.GROQ_API_KEY = apiKey;
    const failedGeneration = `to=functions.json api_key=${apiKey} ${'y'.repeat(400)}`;
    const error = Object.assign(new Error('tool_use_failed'), {
      status: 400,
      error: {
        type: 'invalid_request_error',
        code: 'tool_use_failed',
        failed_generation: failedGeneration,
      },
    });
    createMock.mockRejectedValueOnce(error);

    const toolChoice = { type: 'function', function: { name: 'submit_diagnosis_outcome' } };
    await expect(
      createChatCompletion(
        { ...params, tool_choice: toolChoice } as never,
        { round: 1, toolChoice },
      ),
    ).rejects.toMatchObject({ statusCode: 502, code: 'AI_PROVIDER_REJECTED' });

    const logs = providerFailureLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'groq.provider_failure',
      round: 1,
      toolChoice: 'function:submit_diagnosis_outcome',
      providerErrorCode: 'tool_use_failed',
    });
    expect(typeof logs[0]?.providerFailedGeneration).toBe('string');
    expect(String(logs[0]?.providerFailedGeneration).length).toBeLessThanOrEqual(300);
    expect(String(logs[0]?.providerFailedGeneration)).toContain('[REDACTED]');

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain('y'.repeat(400));
  });

  it('records round 0 and the required tool choice without changing 400 handling', async () => {
    createMock.mockRejectedValueOnce({
      status: 400,
      error: { code: 'tool_use_failed', failed_generation: 'to=functions.json' },
    });

    await expect(
      createChatCompletion(
        { ...params, tool_choice: 'required' } as never,
        { round: 0, toolChoice: 'required' },
      ),
    ).rejects.toMatchObject({ statusCode: 502, code: 'AI_PROVIDER_REJECTED' });

    expect(providerFailureLogs()[0]).toMatchObject({
      round: 0,
      toolChoice: 'required',
      providerErrorCode: 'tool_use_failed',
      providerFailedGeneration: 'to=functions.json',
    });
  });

  it('signals the exact forced-tool missing-call rejection for fallback handling', async () => {
    const toolChoice = { type: 'function', function: { name: 'submit_diagnosis_outcome' } };
    createMock.mockRejectedValueOnce(
      Object.assign(new Error('400 Tool choice is required, but model did not call a tool.'), {
        status: 400,
        error: {
          type: 'invalid_request_error',
          code: 'tool_use_failed',
          failed_generation: 'to=functions.json',
          message: 'Tool choice is required, but model did not call a tool.',
        },
      }),
    );

    await expect(
      createChatCompletion({ ...params, tool_choice: toolChoice } as never),
    ).rejects.toBeInstanceOf(ForcedToolNotCalledError);

    // The provider rejection is still logged with its diagnostics.
    expect(providerFailureLogs()[0]).toMatchObject({
      event: 'groq.provider_failure',
      providerErrorCode: 'tool_use_failed',
    });
  });

  it('does not signal fallback for other 400s, other tool_use_failed reasons, or non-forced choices', async () => {
    const forced = { type: 'function', function: { name: 'submit_diagnosis_outcome' } } as const;
    const message = 'Tool choice is required, but model did not call a tool.';
    const cases: Array<[unknown, unknown]> = [
      // Same provider body, but the request did not force a specific tool.
      [
        { status: 400, error: { code: 'tool_use_failed', message } },
        'required',
      ],
      // Forced choice, but a different tool_use_failed reason.
      [
        { status: 400, error: { code: 'tool_use_failed', message: 'Invalid tool arguments.' } },
        forced,
      ],
      // The observed Groq tool-call validation failure must stay a provider
      // rejection, not a signal for the deterministic final-tool fallback.
      [
        {
          status: 400,
          error: {
            type: 'invalid_request_error',
            code: 'tool_use_failed',
            message:
              "Tool call validation failed: parameters for tool submit_diagnosis_outcome did not match schema: errors: [missing properties: 'reply', 'outcome', 'followUpQuestion', 'suspectedComponents', 'partNumber']",
            failed_generation: '{"name":"submit_diagnosis_outcome","arguments":{}}',
          },
        },
        forced,
      ],
      // Matching wording, but a different provider code.
      [
        { status: 400, error: { code: 'invalid_request_error', message } },
        forced,
      ],
      // Matching code and wording, but not HTTP 400.
      [
        { status: 422, error: { code: 'tool_use_failed', message } },
        forced,
      ],
    ];

    for (const [error, toolChoice] of cases) {
      createMock.mockRejectedValueOnce(error);
      const rejected = createChatCompletion({ ...params, tool_choice: toolChoice } as never);
      await expect(rejected).rejects.not.toBeInstanceOf(ForcedToolNotCalledError);
      await expect(rejected).rejects.toMatchObject({ statusCode: 502, code: 'AI_PROVIDER_REJECTED' });
    }
  });
});
