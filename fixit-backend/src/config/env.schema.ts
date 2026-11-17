import { z } from 'zod';

// Environment variables are always text, so booleans are parsed from the exact
// strings "true"/"false" instead of JavaScript truthiness (where "false" is true).
const booleanFromEnv = z
  .enum(['true', 'false'], { message: 'must be "true" or "false"' })
  .default('false')
  .transform((value) => value === 'true');

// An empty or whitespace-only value counts as absent, so `.env` placeholders
// like `GROQ_API_KEY=` do not look like a configured credential.
const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

// Pure schema with no dotenv loading, logging, or process exit. Keeping it pure
// lets tests exercise the production guards directly.
export const envSchema = z
  .object({
    // Required with no default: a production deployment must never silently
    // fall back to development and weaken the safety guards below.
    NODE_ENV: z.enum(['development', 'test', 'production']),
    // Optional to supply; defaults to 3000 when absent. Values that are supplied
    // are still validated so an invalid port cannot reach the server.
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Signing key for short-lived access tokens. Use a random value of at least
    // 32 characters; changing it invalidates every issued access token.
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    // Backend-only AI credential. Optional for development/test, required in
    // production (enforced below). Never log this value.
    GROQ_API_KEY: optionalTrimmedString,
    GROQ_MODEL: z.string().trim().min(1).default('openai/gpt-oss-120b'),
    // Development-only access to UNREVIEWED knowledge. Rejected in production.
    ALLOW_UNREVIEWED_KNOWLEDGE: booleanFromEnv,
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    if (!value.GROQ_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_API_KEY'],
        message: 'GROQ_API_KEY is required in production',
      });
    }

    if (value.ALLOW_UNREVIEWED_KNOWLEDGE) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_UNREVIEWED_KNOWLEDGE'],
        message: 'ALLOW_UNREVIEWED_KNOWLEDGE cannot be enabled in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv) {
  return envSchema.safeParse(raw);
}
