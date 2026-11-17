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
    expect(result.data.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(result.data.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(result.data.GROQ_MODEL).toBe('openai/gpt-oss-120b');
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
    const result = parseEnv({ ...baseEnv, GROQ_MODEL: 'openai/gpt-oss-20b' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.GROQ_MODEL).toBe('openai/gpt-oss-20b');

    expect(failingPaths({ ...baseEnv, GROQ_MODEL: '   ' })).toContain('GROQ_MODEL');
  });

  it('requires GROQ_API_KEY in production', () => {
    expect(failingPaths({ ...baseEnv, NODE_ENV: 'production' })).toContain('GROQ_API_KEY');
  });

  it('accepts production with a GROQ_API_KEY', () => {
    const result = parseEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      GROQ_API_KEY: 'production-key',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GROQ_API_KEY).toBe('production-key');
      expect(result.data.ALLOW_UNREVIEWED_KNOWLEDGE).toBe(false);
    }
  });

  it('treats an empty GROQ_API_KEY as absent', () => {
    const development = parseEnv({ ...baseEnv, GROQ_API_KEY: '   ' });
    expect(development.success).toBe(true);
    if (development.success) expect(development.data.GROQ_API_KEY).toBeUndefined();

    expect(
      failingPaths({ ...baseEnv, NODE_ENV: 'production', GROQ_API_KEY: '   ' }),
    ).toContain('GROQ_API_KEY');
  });

  it('rejects ALLOW_UNREVIEWED_KNOWLEDGE in production', () => {
    expect(
      failingPaths({
        ...baseEnv,
        NODE_ENV: 'production',
        GROQ_API_KEY: 'production-key',
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
