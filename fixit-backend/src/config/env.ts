import 'dotenv/config';
import { parseEnv } from './env.schema.js';

const result = parseEnv(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  // Print only the variable name and the problem, never the value received,
  // because DATABASE_URL contains the database password.
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

// Development-only escape hatch for working with unreviewed knowledge. The
// schema rejects this in production; the warning here makes an accidental
// development toggle visible without logging any data or secret values.
if (result.data.ALLOW_UNREVIEWED_KNOWLEDGE) {
  console.warn(
    'WARNING: ALLOW_UNREVIEWED_KNOWLEDGE is enabled. UNREVIEWED knowledge must never be exposed outside development.',
  );
}

// The rest of the app imports this typed, validated object.
export const env = result.data;
