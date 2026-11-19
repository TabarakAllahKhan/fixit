// Fail-closed guard for database integration tests. This runs after
// tests/setup-env.ts, which installs a dummy DATABASE_URL and a safe NODE_ENV.
//
// Only the two exact hosts of the isolated `fixit-test` Neon project are allowed.
// Every other host — development, legacy development, and production — is
// rejected before any module can open a connection.
import { config as loadDotenv } from 'dotenv';

const ALLOWED_TEST_HOSTS = new Set([
  'ep-withered-mode-aoa83pzz.c-2.ap-southeast-1.aws.neon.tech',
  'ep-withered-mode-aoa83pzz-pooler.c-2.ap-southeast-1.aws.neon.tech',
]);

const DENIED_HOSTS = new Set([
  'ep-winter-credit-ao2gv7ym.c-2.ap-southeast-1.aws.neon.tech',
  'ep-shy-glade-a1uvm947.ap-southeast-1.aws.neon.tech',
  'ep-shy-glade-a1uvm947-pooler.ap-southeast-1.aws.neon.tech',
]);

export type DbTestEnv = {
  NODE_ENV?: string;
  RUN_DB_TESTS?: string;
  TEST_DATABASE_URL?: string;
  TEST_DIRECT_URL?: string;
};

function hostnameOf(value: string, label: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error(`Refusing database tests: ${label} is not a valid URL`);
  }
}

// Pure so the negative cases can be proven without touching process.env or a DB.
// Error messages name only variables, never values, hosts, or credentials.
export function assertDbTestEnv(raw: DbTestEnv): void {
  if (raw.NODE_ENV === 'production') {
    throw new Error('Refusing database tests: NODE_ENV=production');
  }
  if (raw.RUN_DB_TESTS !== '1') {
    throw new Error('Refusing database tests: RUN_DB_TESTS must be exactly 1');
  }
  if (!raw.TEST_DATABASE_URL) {
    throw new Error('Refusing database tests: TEST_DATABASE_URL is required');
  }
  if (!raw.TEST_DIRECT_URL) {
    throw new Error('Refusing database tests: TEST_DIRECT_URL is required');
  }
  for (const label of ['TEST_DATABASE_URL', 'TEST_DIRECT_URL'] as const) {
    const host = hostnameOf(raw[label]!, label);
    if (DENIED_HOSTS.has(host) || !ALLOWED_TEST_HOSTS.has(host)) {
      throw new Error(`Refusing database tests: ${label} host is not in the fixit-test allowlist`);
    }
  }
}

// Only .env.test is loaded; the development .env is never consulted by this runner.
loadDotenv({ path: '.env.test', override: false });
assertDbTestEnv(process.env);

// NODE_ENV was checked before being changed. The explicit assignment replaces the
// dummy value installed by tests/setup-env.ts only after every guard has passed.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
