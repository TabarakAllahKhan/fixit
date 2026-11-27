import { z } from 'zod';

// Environment variables are always text, so booleans are parsed from the exact
// strings "true"/"false" instead of JavaScript truthiness (where "false" is true).
function booleanFromEnvWithDefault(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'], { message: 'must be "true" or "false"' })
    .default(defaultValue)
    .transform((value) => value === 'true');
}

const booleanFromEnv = booleanFromEnvWithDefault('false');
const enabledByDefault = booleanFromEnvWithDefault('true');

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
    // Comma-separated browser origins. Native clients normally send no Origin
    // header and remain allowed; browser origins must be explicitly listed.
    CORS_ALLOWED_ORIGINS: z
      .string()
      .trim()
      .default('http://localhost:19006,http://localhost:8081,exp://localhost:19000'),
    // Docs are opt-in so Swagger UI is not public by accident.
    ENABLE_API_DOCS: booleanFromEnv,
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(3_000),
    RATE_LIMIT_ENABLED: enabledByDefault,
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(1_000).default(30),
    RATE_LIMIT_MESSAGE_MAX: z.coerce.number().int().min(1).max(1_000).default(60),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Signing key for short-lived access tokens. Use a random value of at least
    // 32 characters; changing it invalidates every issued access token.
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    // Backend-only AI credential. Optional for development/test, required in
    // production (enforced below). Never log this value.
    GROQ_API_KEY: optionalTrimmedString,
    // Cost-conscious default. 120b remains available for manual comparison.
    GROQ_MODEL: z.string().trim().min(1).default('openai/gpt-oss-20b'),
    GROQ_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    GROQ_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
    GROQ_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(5).default(2),
    GROQ_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(10).default(3),
    GROQ_HISTORY_LIMIT: z.coerce.number().int().min(1).max(50).default(12),
    GROQ_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(256).max(8_192).default(1_200),
    GROQ_REASONING_EFFORT: z.enum(['none', 'default', 'low', 'medium', 'high']).default('low'),

    // Google Gemini is the production AI provider for the diagnosis flow. The
    // credential is backend-only and must never reach the mobile client or logs.
    GOOGLE_API_KEY: optionalTrimmedString,
    // Locked to the single approved free-tier model: deployments cannot silently
    // switch to a different (potentially paid) model through configuration.
    GEMINI_MODEL: z.literal('gemini-3.5-flash-lite').default('gemini-3.5-flash-lite'),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8_192).default(3_000),
    GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).default('minimal'),
    GEMINI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(5).default(2),
    GEMINI_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(10).default(3),
    GEMINI_HISTORY_LIMIT: z.coerce.number().int().min(1).max(50).default(12),

    FIX_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
    // Disabled by default. Enable only for controlled browser-search testing.
    PARTS_PROVIDER: z.enum(['none', 'groq_browser']).default('none'),
    PARTS_ALLOWED_DOMAINS: z
      .string()
      .trim()
      .min(1)
      .default(
        'samsung.com,lg.com,whirlpool.com,bosch-home.com,bosch.com,haier.com,partselect.com,repairclinic.com,appliancepartspros.com,searspartsdirect.com',
      ),
    PARTS_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),

    // Backend web research is opt-in and disabled by default. Groq browser
    // search is the only supported provider; it reuses the validated Groq
    // credentials and model above. Domain hints are best-effort only: every
    // result is validated against these allowlists in the research service.
    RESEARCH_PROVIDER: z.enum(['none', 'groq_browser']).default('none'),
    RESEARCH_MANUFACTURER_DOMAINS: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .default(
        'samsung.com,lg.com,whirlpool.com,bosch-home.com,bosch.com,haier.com,geappliances.com,whirlpool.ca',
      ),
    RESEARCH_TECHNICAL_DOMAINS: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .default('partselect.com,repairclinic.com,appliancepartspros.com,searspartsdirect.com'),
    RESEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
    RESEARCH_MAX_TITLE_LENGTH: z.coerce.number().int().min(20).max(500).default(160),
    RESEARCH_MAX_SNIPPET_LENGTH: z.coerce.number().int().min(40).max(2_000).default(360),
    RESEARCH_MAX_SERIALIZED_BYTES: z.coerce.number().int().min(1_000).max(100_000).default(20_000),

    // Development-only access to UNREVIEWED knowledge. Rejected in production.
    ALLOW_UNREVIEWED_KNOWLEDGE: booleanFromEnv,
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    if (!value.GOOGLE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_API_KEY'],
        message: 'GOOGLE_API_KEY is required in production',
      });
    }

    // The legacy browser parts provider is opt-in, but if enabled it still
    // needs its own credential. Fail at startup instead of silently returning
    // no parts in production.
    if (value.PARTS_PROVIDER === 'groq_browser' && !value.GROQ_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_API_KEY'],
        message: 'GROQ_API_KEY is required in production when PARTS_PROVIDER=groq_browser',
      });
    }

    if (value.RESEARCH_PROVIDER === 'groq_browser' && !value.GROQ_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_API_KEY'],
        message: 'GROQ_API_KEY is required in production when RESEARCH_PROVIDER=groq_browser',
      });
    }

    if (value.ALLOW_UNREVIEWED_KNOWLEDGE) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_UNREVIEWED_KNOWLEDGE'],
        message: 'ALLOW_UNREVIEWED_KNOWLEDGE cannot be enabled in production',
      });
    }

    if (!value.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_ENABLED'],
        message: 'RATE_LIMIT_ENABLED cannot be disabled in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv) {
  return envSchema.safeParse(raw);
}
