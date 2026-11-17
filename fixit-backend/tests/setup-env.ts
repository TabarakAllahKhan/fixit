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
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
process.env.ALLOW_UNREVIEWED_KNOWLEDGE = 'false';
process.env.PORT = '3000';
