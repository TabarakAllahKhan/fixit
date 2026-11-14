import 'dotenv/config';
import { z } from 'zod';

// Describes what valid configuration looks like.
// Environment variables are always text, so PORT is converted to a number.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Signing key for short-lived access tokens. Use a random value of at least
  // 32 characters; changing it invalidates every issued access token.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  // Print only the variable name and the problem, never the value received,
  // because DATABASE_URL contains the database password.
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

// The rest of the app imports this typed, validated object.
export const env = result.data;