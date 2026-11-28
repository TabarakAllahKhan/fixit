import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.schema.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/fixit',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

function failingPaths(raw: Record<string, string | undefined>): string[] {
  const result = parseEnv(raw);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('environment schema', () => {
  it('applies defaults when optional values are absent', () => {
    const result = parseEnv(baseEnv);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.PORT).toBe(3000);
    expect(result.data.CORS_ALLOWED_ORIGINS).toContain('http://localhost:19006');
    expect(result.data.ENABLE_API_DOCS).toBe(false);
    expect(result.data.HEALTH_CHECK_TIMEOUT_MS).toBe(3000);
    expect(result.data.RATE_LIMIT_ENABLED).toBe(true);
    expect(result.data.RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(result.data.RATE_LIMIT_AUTH_MAX).toBe(30);
    expect(result.data.RATE_LIMIT_MESSAGE_MAX).toBe(60);
    expect(result.data.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(result.data.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(result.data.GROQ_MODEL).toBe('openai/gpt-oss-20b');
    expect(result.data.GROQ_TIMEOUT_MS).toBe(15_000);
    expect(result.data.GROQ_MAX_RETRIES).toBe(1);
    expect(result.data.GROQ_MAX_TOOL_ROUNDS).toBe(2);
    expect(result.data.GROQ_MAX_TOOL_CALLS).toBe(3);
    expect(result.data.GROQ_HISTORY_LIMIT).toBe(12);
    expect(result.data.GROQ_MAX_COMPLETION_TOKENS).toBe(1200);
    expect(result.data.GROQ_REASONING_EFFORT).toBe('low');
    expect(result.data.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(result.data.GEMINI_TIMEOUT_MS).toBe(30_000);
    expect(result.data.GEMINI_MAX_OUTPUT_TOKENS).toBe(3_000);
    expect(result.data.GEMINI_THINKING_LEVEL).toBe('minimal');
    expect(result.data.GEMINI_MAX_TOOL_ROUNDS).toBe(2);
    expect(result.data.GEMINI_MAX_TOOL_CALLS).toBe(3);
    expect(result.data.GEMINI_HISTORY_LIMIT).toBe(12);
    expect(result.data.SAFETY_FOLLOW_UP_USER_TURNS).toBe(6);
    expect(result.data.GOOGLE_API_KEY).toBeUndefined();
    expect(result.data.FIX_CONFIRMATION_TTL_SECONDS).toBe(600);
    expect(result.data.PARTS_PROVIDER).toBe('none');
    expect(result.data.PARTS_MAX_RESULTS).toBe(5);
    expect(result.data.RESEARCH_PROVIDER).toBe('none');
    expect(result.data.RESEARCH_MANUFACTURER_DOMAINS).toContain('lg.com');
    expect(result.data.RESEARCH_TECHNICAL_DOMAINS).toContain('partselect.com');
    expect(result.data.RESEARCH_MAX_RESULTS).toBe(5);
    expect(result.data.RESEARCH_MAX_TITLE_LENGTH).toBe(160);
    expect(result.data.RESEARCH_MAX_SNIPPET_LENGTH).toBe(360);
    expect(result.data.RESEARCH_MAX_SERIALIZED_BYTES).toBe(20_000);
    expect(result.data.RESEARCH_TIMEOUT_MS).toBe(8_000);
    expect(result.data.PARTS_TIMEOUT_MS).toBe(10_000);
    for (const domain of ['miele.com', 'electrolux.com', 'frigidaire.com', 'maytag.com', 'kitchenaid.com',
      'daikin.com', 'rheem.com', 'aosmith.com', 'panasonic.com', 'global.sharp', 'beko.com']) {
      expect(result.data.RESEARCH_MANUFACTURER_DOMAINS).toContain(domain);
    }
    expect(result.data.GROQ_API_KEY).toBeUndefined();
    expect(result.data.ALLOW_UNREVIEWED_KNOWLEDGE).toBe(false);
  });

  it('requires NODE_ENV instead of defaulting to development', () => {
    expect(failingPaths({ ...baseEnv, NODE_ENV: undefined })).toContain('NODE_ENV');
  });

  it('keeps a supplied PORT but rejects an invalid one', () => {
    const valid = parseEnv({ ...baseEnv, PORT: '8080' });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.PORT).toBe(8080);

    expect(failingPaths({ ...baseEnv, PORT: '0' })).toContain('PORT');
    expect(failingPaths({ ...baseEnv, PORT: 'not-a-port' })).toContain('PORT');
  });

  it('accepts an overridden GROQ_MODEL and rejects an empty one', () => {
    const result = parseEnv({ ...baseEnv, GROQ_MODEL: 'openai/gpt-oss-120b' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.GROQ_MODEL).toBe('openai/gpt-oss-120b');

    expect(failingPaths({ ...baseEnv, GROQ_MODEL: '   ' })).toContain('GROQ_MODEL');
  });

  it('locks the Gemini model to the approved free-tier model and bounds its limits', () => {
    const valid = parseEnv({
      ...baseEnv,
      GEMINI_TIMEOUT_MS: '45000',
      GEMINI_MAX_OUTPUT_TOKENS: '2000',
      GEMINI_THINKING_LEVEL: 'low',
      GEMINI_MAX_TOOL_ROUNDS: '3',
      GEMINI_MAX_TOOL_CALLS: '4',
      GEMINI_HISTORY_LIMIT: '8',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
      expect(valid.data.GEMINI_TIMEOUT_MS).toBe(45_000);
      expect(valid.data.GEMINI_MAX_OUTPUT_TOKENS).toBe(2_000);
      expect(valid.data.GEMINI_THINKING_LEVEL).toBe('low');
      expect(valid.data.GEMINI_MAX_TOOL_ROUNDS).toBe(3);
      expect(valid.data.GEMINI_MAX_TOOL_CALLS).toBe(4);
      expect(valid.data.GEMINI_HISTORY_LIMIT).toBe(8);
    }

    expect(failingPaths({ ...baseEnv, GEMINI_MODEL: 'gemini-3.1-pro-preview' })).toContain(
      'GEMINI_MODEL',
    );
    expect(failingPaths({ ...baseEnv, GEMINI_TIMEOUT_MS: '0' })).toContain('GEMINI_TIMEOUT_MS');
    expect(failingPaths({ ...baseEnv, GEMINI_MAX_OUTPUT_TOKENS: '100000' })).toContain(
      'GEMINI_MAX_OUTPUT_TOKENS',
    );
    expect(failingPaths({ ...baseEnv, GEMINI_THINKING_LEVEL: 'extreme' })).toContain(
      'GEMINI_THINKING_LEVEL',
    );
    expect(failingPaths({ ...baseEnv, GEMINI_MAX_TOOL_ROUNDS: '0' })).toContain(
      'GEMINI_MAX_TOOL_ROUNDS',
    );
    expect(failingPaths({ ...baseEnv, GEMINI_MAX_TOOL_CALLS: '20' })).toContain(
      'GEMINI_MAX_TOOL_CALLS',
    );
    expect(failingPaths({ ...baseEnv, GEMINI_HISTORY_LIMIT: '100' })).toContain(
      'GEMINI_HISTORY_LIMIT',
    );
  });

  it('configures the restricted follow-up window independently of the Gemini history', () => {
    const wider = parseEnv({ ...baseEnv, SAFETY_FOLLOW_UP_USER_TURNS: '10', GEMINI_HISTORY_LIMIT: '4' });
    expect(wider.success).toBe(true);
    if (wider.success) {
      expect(wider.data.SAFETY_FOLLOW_UP_USER_TURNS).toBe(10);
      expect(wider.data.GEMINI_HISTORY_LIMIT).toBe(4);
    }
    // A smaller value parses, but the safety module clamps it to its
    // six-turn minimum (see restrictedFollowUpWindow in safety.test.ts).
    expect(parseEnv({ ...baseEnv, SAFETY_FOLLOW_UP_USER_TURNS: '2' }).success).toBe(true);
    expect(failingPaths({ ...baseEnv, SAFETY_FOLLOW_UP_USER_TURNS: '0' })).toContain('SAFETY_FOLLOW_UP_USER_TURNS');
    expect(failingPaths({ ...baseEnv, SAFETY_FOLLOW_UP_USER_TURNS: '100' })).toContain('SAFETY_FOLLOW_UP_USER_TURNS');
  });

  it('validates bounded Groq limits and parts configuration', () => {
    const valid = parseEnv({
      ...baseEnv,
      GROQ_TIMEOUT_MS: '30000',
      GROQ_MAX_RETRIES: '2',
      GROQ_REASONING_EFFORT: 'medium',
      PARTS_PROVIDER: 'groq_browser',
      PARTS_ALLOWED_DOMAINS: 'example.com, shop.example.org ',
      PARTS_MAX_RESULTS: '10',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.GROQ_TIMEOUT_MS).toBe(30_000);
      expect(valid.data.GROQ_MAX_RETRIES).toBe(2);
      expect(valid.data.GROQ_REASONING_EFFORT).toBe('medium');
      expect(valid.data.PARTS_PROVIDER).toBe('groq_browser');
      expect(valid.data.PARTS_MAX_RESULTS).toBe(10);
    }

    expect(failingPaths({ ...baseEnv, GROQ_TIMEOUT_MS: '0' })).toContain('GROQ_TIMEOUT_MS');
    expect(failingPaths({ ...baseEnv, GROQ_MAX_TOOL_CALLS: '20' })).toContain('GROQ_MAX_TOOL_CALLS');
    expect(failingPaths({ ...baseEnv, GROQ_REASONING_EFFORT: 'ultra' })).toContain(
      'GROQ_REASONING_EFFORT',
    );
    expect(failingPaths({ ...baseEnv, PARTS_PROVIDER: 'google' })).toContain('PARTS_PROVIDER');
    expect(failingPaths({ ...baseEnv, PARTS_TIMEOUT_MS: '500' })).toContain('PARTS_TIMEOUT_MS');
    expect(failingPaths({ ...baseEnv, PARTS_TIMEOUT_MS: '120000' })).toContain('PARTS_TIMEOUT_MS');
    expect(failingPaths({ ...baseEnv, RESEARCH_TIMEOUT_MS: '999' })).toContain('RESEARCH_TIMEOUT_MS');
    expect(failingPaths({ ...baseEnv, RESEARCH_TIMEOUT_MS: '30001' })).toContain('RESEARCH_TIMEOUT_MS');
    expect(failingPaths({ ...baseEnv, FIX_CONFIRMATION_TTL_SECONDS: '1' })).toContain(
      'FIX_CONFIRMATION_TTL_SECONDS',
    );
  });

  it('validates bounded web-research configuration', () => {
    const valid = parseEnv({
      ...baseEnv,
      RESEARCH_PROVIDER: 'groq_browser',
      RESEARCH_MANUFACTURER_DOMAINS: ' LG.COM , lg.com ',
      RESEARCH_TECHNICAL_DOMAINS: 'repairclinic.com',
      RESEARCH_MAX_RESULTS: '10',
      RESEARCH_MAX_TITLE_LENGTH: '200',
      RESEARCH_MAX_SNIPPET_LENGTH: '500',
      RESEARCH_MAX_SERIALIZED_BYTES: '8000',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.RESEARCH_PROVIDER).toBe('groq_browser');
      expect(valid.data.RESEARCH_MAX_RESULTS).toBe(10);
      expect(valid.data.RESEARCH_MAX_TITLE_LENGTH).toBe(200);
      expect(valid.data.RESEARCH_MAX_SNIPPET_LENGTH).toBe(500);
      expect(valid.data.RESEARCH_MAX_SERIALIZED_BYTES).toBe(8_000);
    }

    expect(failingPaths({ ...baseEnv, RESEARCH_PROVIDER: 'google' })).toContain('RESEARCH_PROVIDER');
    expect(failingPaths({ ...baseEnv, RESEARCH_MANUFACTURER_DOMAINS: '   ' })).toContain(
      'RESEARCH_MANUFACTURER_DOMAINS',
    );
    expect(failingPaths({ ...baseEnv, RESEARCH_TECHNICAL_DOMAINS: ' ' })).toContain(
      'RESEARCH_TECHNICAL_DOMAINS',
    );
    expect(failingPaths({ ...baseEnv, RESEARCH_MAX_RESULTS: '0' })).toContain('RESEARCH_MAX_RESULTS');
    expect(failingPaths({ ...baseEnv, RESEARCH_MAX_TITLE_LENGTH: '10' })).toContain(
      'RESEARCH_MAX_TITLE_LENGTH',
    );
    expect(failingPaths({ ...baseEnv, RESEARCH_MAX_SERIALIZED_BYTES: '100' })).toContain(
      'RESEARCH_MAX_SERIALIZED_BYTES',
    );
  });

  it('requires GOOGLE_API_KEY in production', () => {
    expect(failingPaths({ ...baseEnv, NODE_ENV: 'production' })).toContain('GOOGLE_API_KEY');
  });

  it('accepts production with a GOOGLE_API_KEY and no Groq credential', () => {
    const result = parseEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      GOOGLE_API_KEY: 'production-key',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_API_KEY).toBe('production-key');
      expect(result.data.GROQ_API_KEY).toBeUndefined();
      expect(result.data.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
      expect(result.data.ALLOW_UNREVIEWED_KNOWLEDGE).toBe(false);
    }
  });

  it('treats an empty GOOGLE_API_KEY as absent', () => {
    const development = parseEnv({ ...baseEnv, GOOGLE_API_KEY: '   ' });
    expect(development.success).toBe(true);
    if (development.success) expect(development.data.GOOGLE_API_KEY).toBeUndefined();

    expect(
      failingPaths({ ...baseEnv, NODE_ENV: 'production', GOOGLE_API_KEY: '   ' }),
    ).toContain('GOOGLE_API_KEY');
  });

  it('requires a Groq credential in production only for the legacy parts provider', () => {
    expect(
      parseEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        GOOGLE_API_KEY: 'production-key',
        PARTS_PROVIDER: 'groq_browser',
      }).success,
    ).toBe(false);
    expect(
      failingPaths({
        ...baseEnv,
        NODE_ENV: 'production',
        GOOGLE_API_KEY: 'production-key',
        PARTS_PROVIDER: 'groq_browser',
      }),
    ).toContain('GROQ_API_KEY');
    expect(
      parseEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        GOOGLE_API_KEY: 'production-key',
        GROQ_API_KEY: 'legacy-parts-key',
        PARTS_PROVIDER: 'groq_browser',
      }).success,
    ).toBe(true);
  });

  it('requires a Groq credential in production when web research is enabled', () => {
    const productionResearch = {
      ...baseEnv,
      NODE_ENV: 'production' as const,
      GOOGLE_API_KEY: 'production-key',
      RESEARCH_PROVIDER: 'groq_browser' as const,
    };

    expect(failingPaths(productionResearch)).toContain('GROQ_API_KEY');
    expect(parseEnv({ ...productionResearch, GROQ_API_KEY: 'research-key' }).success).toBe(true);
  });

  it('rejects disabled rate limiting in production', () => {
    expect(
      failingPaths({
        ...baseEnv,
        NODE_ENV: 'production',
        GOOGLE_API_KEY: 'production-key',
        RATE_LIMIT_ENABLED: 'false',
      }),
    ).toContain('RATE_LIMIT_ENABLED');
  });

  it('rejects ALLOW_UNREVIEWED_KNOWLEDGE in production', () => {
    expect(
      failingPaths({
        ...baseEnv,
        NODE_ENV: 'production',
        GOOGLE_API_KEY: 'production-key',
        ALLOW_UNREVIEWED_KNOWLEDGE: 'true',
      }),
    ).toContain('ALLOW_UNREVIEWED_KNOWLEDGE');
  });

  it('permits ALLOW_UNREVIEWED_KNOWLEDGE outside production and parses it as a boolean', () => {
    const result = parseEnv({ ...baseEnv, ALLOW_UNREVIEWED_KNOWLEDGE: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ALLOW_UNREVIEWED_KNOWLEDGE).toBe(true);
  });

  it('accepts only the exact strings true and false for the boolean flag', () => {
    expect(failingPaths({ ...baseEnv, ALLOW_UNREVIEWED_KNOWLEDGE: '1' })).toContain(
      'ALLOW_UNREVIEWED_KNOWLEDGE',
    );
    expect(failingPaths({ ...baseEnv, ALLOW_UNREVIEWED_KNOWLEDGE: 'yes' })).toContain(
      'ALLOW_UNREVIEWED_KNOWLEDGE',
    );
  });
});
