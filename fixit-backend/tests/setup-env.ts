// Runs before every test file. Application modules validate the environment at
// import time, so this file must populate process.env first.
//
// Check the inherited value before overwriting it: running the suite against a
// production configuration must fail loudly rather than silently re-labelling
// the process as a test environment.
if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run tests with NODE_ENV=production');
}

process.env.NODE_ENV = 'test';

// Dummy values only. These point at a non-existent local database and a fake
// Groq key so no test can reach a real service by accident.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/fixit_test?sslmode=disable';
process.env.JWT_ACCESS_SECRET = 'test-only-access-secret-at-least-32-characters';
process.env.GROQ_API_KEY = 'test-dummy-groq-key';
process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
process.env.GROQ_TIMEOUT_MS = '15000';
process.env.GROQ_MAX_RETRIES = '0';
process.env.GROQ_MAX_TOOL_ROUNDS = '2';
process.env.GROQ_MAX_TOOL_CALLS = '3';
process.env.GROQ_HISTORY_LIMIT = '12';
process.env.GROQ_MAX_COMPLETION_TOKENS = '1200';
process.env.GROQ_REASONING_EFFORT = 'low';
process.env.FIX_CONFIRMATION_TTL_SECONDS = '600';
process.env.PARTS_PROVIDER = 'none';
process.env.PARTS_ALLOWED_DOMAINS = 'samsung.com,lg.com,partselect.com';
process.env.PARTS_MAX_RESULTS = '5';
process.env.ALLOW_UNREVIEWED_KNOWLEDGE = 'false';
process.env.PORT = '3000';
