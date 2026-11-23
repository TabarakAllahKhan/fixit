import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';

const { createMock, constructorConfigs, GoogleGenAIMock } = vi.hoisted(() => {
  const createMock = vi.fn();
  const constructorConfigs: unknown[] = [];
  class GoogleGenAIMock {
    interactions = { create: createMock };
    constructor(config: unknown) {
      constructorConfigs.push(config);
    }
  }
  return { createMock, constructorConfigs, GoogleGenAIMock };
});

vi.mock('@google/genai', () => ({ GoogleGenAI: GoogleGenAIMock }));

import { createAiInteraction, type AiProviderRequest } from '../../src/services/ai/provider.js';
import { ForcedToolNotCalledError } from '../../src/utils/aiErrors.js';

const originalApiKey = env.GOOGLE_API_KEY;
const originalDatabaseUrl = env.DATABASE_URL;
let logSpy: ReturnType<typeof vi.spyOn>;
const capturedLogs: string[] = [];

const step = { type: 'function_call', id: 'call-1', name: 'search_error_codes', arguments: { codes: ['FE'] } };
const interaction = {
  id: 'interaction-1',
  status: 'completed',
  output_text: 'Model text',
  steps: [step],
};

function request(toolChoice: AiProviderRequest['toolChoice'] = { mode: 'any' }): AiProviderRequest {
  return {
    systemInstruction: 'System instruction',
    steps: [{ type: 'user_input', content: [{ type: 'text', text: 'What is wrong?' }] }],
    tools: [{ type: 'function', name: 'search_error_codes', description: 'Lookup', parameters: { type: 'object' } }],
    toolChoice,
  };
}

function providerFailureLogs(): Array<Record<string, unknown>> {
  return capturedLogs.flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  }).filter((entry) => entry.event === 'gemini.provider_failure');
}

beforeEach(() => {
  capturedLogs.length = 0;
  logSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') capturedLogs.push(arg);
    }
  });
  createMock.mockReset();
  createMock.mockResolvedValue(interaction);
  env.GOOGLE_API_KEY = originalApiKey;
  env.DATABASE_URL = originalDatabaseUrl;
});

afterEach(() => {
  env.GOOGLE_API_KEY = originalApiKey;
  env.DATABASE_URL = originalDatabaseUrl;
  logSpy.mockRestore();
});

describe('Gemini Interactions adapter', () => {
  it('sends one stateless, retry-free request with central model configuration', async () => {
    const response = await createAiInteraction(request());

    expect(createMock).toHaveBeenCalledTimes(1);
    const [params, options] = createMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      store: false,
      automatic_continuation: false,
      system_instruction: 'System instruction',
      input: request().steps,
      tools: request().tools,
    });
    expect(params).not.toHaveProperty('previous_interaction_id');
    expect((params.generation_config as Record<string, unknown>).tool_choice).toBe('any');
    expect(options).toMatchObject({
      retries: { strategy: 'none' },
      retry_codes: [],
      maxRetries: 0,
      timeout_ms: 30_000,
    });
    expect(response).toMatchObject({
      text: 'Model text',
      finishReason: 'completed',
      calls: [{ id: 'call-1', name: 'search_error_codes', arguments: { codes: ['FE'] } }],
    });
    expect(response.calls[0]?.step).toBe(step);
    expect(response.steps).toEqual([step]);
    expect(constructorConfigs).toEqual([{ apiKey: originalApiKey }]);
  });

  it('forces a specific tool through generation_config.allowed_tools', async () => {
    await createAiInteraction(request({ mode: 'specific', name: 'submit_diagnosis_outcome' }));

    const [params] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect((params.generation_config as Record<string, unknown>).tool_choice).toEqual({
      allowed_tools: { mode: 'any', tools: ['submit_diagnosis_outcome'] },
    });
  });

  it('maps a missing forced final call to the deterministic fallback signal', async () => {
    createMock.mockResolvedValueOnce({ steps: [], output_text: 'plain text answer' });

    await expect(
      createAiInteraction(request({ mode: 'specific', name: 'submit_diagnosis_outcome' })),
    ).rejects.toBeInstanceOf(ForcedToolNotCalledError);
    expect(providerFailureLogs()).toEqual([]);
  });

  it('does not degrade a non-forced round with no tool calls', async () => {
    createMock.mockResolvedValueOnce({ steps: [], output_text: 'plain text answer' });

    const response = await createAiInteraction(request());

    expect(response.calls).toEqual([]);
    expect(response.text).toBe('plain text answer');
  });

  it('maps quota, permission, timeout and provider failures to stable client errors', async () => {
    const cases: Array<[unknown, number, string]> = [
      [{ status: 429 }, 503, 'AI_RATE_LIMITED'],
      [{ code: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' }, 503, 'AI_RATE_LIMITED'],
      [{ status: 403, message: 'PERMISSION_DENIED' }, 503, 'AI_NOT_CONFIGURED'],
      [{ status: 401 }, 503, 'AI_NOT_CONFIGURED'],
      [{ status: 400 }, 502, 'AI_PROVIDER_REJECTED'],
      [{ status: 422 }, 502, 'AI_PROVIDER_REJECTED'],
      [{ status: 500 }, 503, 'AI_PROVIDER_UNAVAILABLE'],
      [Object.assign(new Error('aborted'), { name: 'AbortError' }), 504, 'AI_TIMEOUT'],
      [new Error('unexpected'), 502, 'AI_INVALID_RESPONSE'],
    ];

    for (const [providerError, statusCode, code] of cases) {
      createMock.mockRejectedValueOnce(providerError);
      await expect(createAiInteraction(request())).rejects.toMatchObject({ statusCode, code });
    }
    expect(createMock).toHaveBeenCalledTimes(cases.length);
  });

  it('fails closed before a request when the provider key is absent', async () => {
    env.GOOGLE_API_KEY = undefined;

    await expect(createAiInteraction(request())).rejects.toMatchObject({
      statusCode: 503,
      code: 'AI_NOT_CONFIGURED',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('logs sanitized provider diagnostics without keys, URLs or long bodies', async () => {
    const apiKey = 'google_test_secret_abcdefghijklmnop';
    const databaseUrl = 'postgresql://reporting:db-password-123@localhost:5432/fixit';
    env.GOOGLE_API_KEY = apiKey;
    env.DATABASE_URL = databaseUrl;
    const longMessage = `quota exceeded api_key=${apiKey} dsn=${databaseUrl} ${'x'.repeat(400)}`;
    class FakeGeminiError extends Error {
      status = 429;
      name = 'ApiError';
      headers = new Headers({ 'x-request-id': 'req_gemini_1' });
    }
    createMock.mockRejectedValueOnce(new FakeGeminiError(longMessage));

    await expect(createAiInteraction(request(), { round: 1 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'AI_RATE_LIMITED',
      message: 'AI provider is rate limited',
    });

    const logs = providerFailureLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      event: 'gemini.provider_failure',
      model: 'gemini-3.5-flash-lite',
      errorClass: 'FakeGeminiError',
      status: 429,
      round: 1,
      toolChoice: 'any',
      providerRequestId: 'req_gemini_1',
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain('db-password-123');
    expect(serialized).not.toContain('x'.repeat(400));
  });
});
