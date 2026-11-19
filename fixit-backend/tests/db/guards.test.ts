import { describe, expect, it } from 'vitest';
import { assertDbTestEnv, type DbTestEnv } from './setup-db-env.js';

// These cases exercise the pure guard: they fail before any connection is opened.
function validEnv(): DbTestEnv {
  return {
    NODE_ENV: 'test',
    RUN_DB_TESTS: '1',
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    TEST_DIRECT_URL: process.env.TEST_DIRECT_URL,
  };
}

function urlFor(host: string): string {
  return `postgresql://placeholder@${host}/db`;
}

describe('database test environment guard (fail-closed)', () => {
  it('accepts only the configured fixit-test URLs', () => {
    expect(() => assertDbTestEnv(validEnv())).not.toThrow();
  });

  it('rejects NODE_ENV=production', () => {
    expect(() => assertDbTestEnv({ ...validEnv(), NODE_ENV: 'production' })).toThrow(/NODE_ENV/);
  });

  it('rejects a missing or disabled opt-in', () => {
    expect(() => assertDbTestEnv({ ...validEnv(), RUN_DB_TESTS: undefined })).toThrow(/RUN_DB_TESTS/);
    expect(() => assertDbTestEnv({ ...validEnv(), RUN_DB_TESTS: '0' })).toThrow(/RUN_DB_TESTS/);
  });

  it('rejects missing connection URLs', () => {
    expect(() => assertDbTestEnv({ ...validEnv(), TEST_DATABASE_URL: undefined })).toThrow(
      /TEST_DATABASE_URL/,
    );
    expect(() => assertDbTestEnv({ ...validEnv(), TEST_DIRECT_URL: undefined })).toThrow(
      /TEST_DIRECT_URL/,
    );
  });

  it('rejects the current development host', () => {
    const url = urlFor('ep-winter-credit-ao2gv7ym.c-2.ap-southeast-1.aws.neon.tech');
    expect(() => assertDbTestEnv({ ...validEnv(), TEST_DATABASE_URL: url })).toThrow(/allowlist/);
  });

  it('rejects the legacy development host', () => {
    const url = urlFor('ep-shy-glade-a1uvm947.ap-southeast-1.aws.neon.tech');
    expect(() => assertDbTestEnv({ ...validEnv(), TEST_DIRECT_URL: url })).toThrow(/allowlist/);
  });

  it('rejects a production host', () => {
    const url = urlFor('ep-production-example.neon.tech');
    expect(() => assertDbTestEnv({ ...validEnv(), TEST_DATABASE_URL: url })).toThrow(/allowlist/);
  });

  it('does not echo a rejected URL or its credential in the error', () => {
    const marker = 'never-echo-this-token';
    const url = `postgresql://placeholder:${marker}@ep-production-example.neon.tech/db`;
    let message = '';
    try {
      assertDbTestEnv({ ...validEnv(), TEST_DATABASE_URL: url });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.includes(marker)).toBe(false);
    expect(message.includes('postgresql://')).toBe(false);
  });

  it('replaces the dummy database URL with the pooled test URL after guards pass', () => {
    expect(process.env.DATABASE_URL === process.env.TEST_DATABASE_URL).toBe(true);
  });
});
