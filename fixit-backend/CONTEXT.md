# fixit-backend — Project Context

Last analyzed: 2026-11-19 (documentation-only repository audit)
Repository: `D:\fixit` (monorepo-ish: Expo app at root, API in `fixit-backend/`)

## 1. What this is

`fixit-backend` is the HTTP API for the FixIt mobile app. The product flow is: a user
photographs an appliance model sticker or error-code display, the backend identifies the
appliance and error code, then runs an AI-assisted troubleshooting conversation that can
end in one of four verdicts: `FIXED`, `NEEDS_PART`, `TECHNICIAN_REQUIRED`, `UNRESOLVED`.

**Audited current state (2026-11-19):** this is no longer an early-stage scaffold. The
repository contains implemented auth, database-backed diagnosis sessions/messages,
knowledge retrieval with approval/scope/safety policy, a Groq adapter and bounded tool
loop, backend-controlled verdict/confirmation/completion, idempotent AI turns, and a
replaceable parts provider. It is still a working tree of uncommitted feature work, and
several items are explicitly **UNVERIFIED** (especially live Groq fallback activation,
live parts discovery, and production promotion). Do not treat implementation or passing
mocked tests as production readiness or as explicit phase approval.

## 2. Stack

| Concern        | Choice                                                              |
| -------------- | ------------------------------------------------------------------- |
| Runtime        | Node.js (ESM — `"type": "module"`)                                  |
| Language       | TypeScript 7 (`strict: true`, `module`/`moduleResolution`: nodenext) |
| Server         | Express 5.3                                                         |
| Database       | PostgreSQL (Neon), via Prisma 7.10.1 + `@prisma/adapter-pg` driver adapter |
| Validation     | Zod 4 (env vars, requests, tool I/O, structured AI outcomes, and persisted JSON) |
| Auth           | `bcryptjs` password hashes, `jsonwebtoken` access tokens, opaque hashed refresh tokens |
| AI provider    | `groq-sdk` 1.6; backend adapter, sanitized diagnostics, bounded tool loop, forced final `submit_diagnosis_outcome`, and narrow deterministic fallback are implemented. Current default model: `openai/gpt-oss-20b` (overridable with `GROQ_MODEL`) |
| Dev runner     | `tsx watch`                                                         |
| Tests          | Vitest 5 + Vite 8 + Supertest 7 (`npm test` = DB-free `vitest run`; `npm run test:db` = isolated DB suite) |
| Lint / format  | **None configured**                                                 |

Pinned: `prisma`, `@prisma/client`, `@prisma/adapter-pg` all at **7.10.1** — keep them in
lockstep. Prisma 8 renames `@default(uuid(7))` to `@onCreate(uuid(7))`; do not upgrade
without rewriting the schema.

## 3. Directory layout

```
fixit-backend/
├─ .env                  # secrets, gitignored (development project)
├─ .env.test             # isolated test-project credentials, gitignored (never print)
├─ .env.example          # documents every required application variable
├─ .env.test.example     # committed placeholders for TEST_* vars only (RUN_DB_TESTS=0)
├─ prisma.config.ts      # Prisma CLI config (schema path, migrations, DIRECT_URL)
├─ vitest.config.ts      # DB-free runner: tests/**/*.test.ts excluding tests/db, envDir false
├─ vitest.db.config.ts   # DB runner: tests/db/**/*.test.ts, envDir false, serial
├─ tsconfig.test.json    # typecheck src + tests + both vitest configs (noEmit)
├─ tests/
│  ├─ setup-env.ts       # refuses NODE_ENV=production; sets dummy env before imports
│  ├─ config/env.test.ts # env schema + production guard tests
│  ├─ dependencies/groq-sdk.test.ts # ESM import/construction only, no network
│  ├─ docs/openapi.contract.test.ts # spec/validator/DTO drift contract tests
│  ├─ http/app.test.ts   # Supertest smoke tests (no database)
│  ├─ http/diagnosis.routes.test.ts # auth/validation/CORS/route contract tests
│  ├─ services/          # DB-free unit tests: AI tools, orchestrator, Groq mapping,
│  │                     # knowledge, parts, repair resolution, diagnosis service
│  └─ db/                # Phase 4A: isolated fixit-test runner only
│     ├─ setup-db-env.ts # fail-closed allowlist/opt-in guard; sets pooled test URL
│     ├─ helpers.ts      # user/appliance/session fixtures and cleanup
│     ├─ guards.test.ts  # negative guard cases, fail before any connection
│     ├─ smoke.test.ts   # read-only connectivity/schema/sentinel checks
│     └─ diagnosis.integration.test.ts # persistence, idempotency, knowledge, confirm/complete
├─ prisma/
│  ├─ schema.prisma      # 9 models, 8 enums
│  └─ migrations/
│     ├─ migration_lock.toml
│     ├─ 20261113122829_init/migration.sql
│     ├─ 20261113130000_add_user_auth/migration.sql
│     ├─ 20261114090000_add_refresh_token_family/migration.sql
│     ├─ 20261116093023_verdict_pending_confirmation/migration.sql
│     └─ 20261119120000_ai_diagnosis_metadata/migration.sql
├─ database_design/
│  └─ DATABASE_DESIGN.md # ER diagram + design rationale (source of truth for rules)
└─ src/
   ├─ server.ts                  # boots app, listens on env.PORT
   ├─ app.ts                     # express app, middleware + route mounting
   ├─ config/
   │  ├─ env.schema.ts           # pure Zod env schema + parseEnv (testable guards)
   │  ├─ env.ts                  # loads dotenv, validates process.env, exits on failure
   │  ├─ prisma.ts               # single PrismaClient instance w/ pg adapter
   │  └─ database.ts             # checkDatabase() -> SELECT 1
   ├─ routes/
   │  ├─ health.routes.ts        # /health/live, /health/ready, /health alias
   │  ├─ auth.routes.ts          # register/login/refresh/logout/change-password, GET me
   │  └─ diagnosis.routes.ts     # 7 authenticated routes; all implemented, no 501 stubs
   ├─ controllers/
   │  ├─ auth.controller.ts      # auth HTTP handlers
   │  └─ diagnosis.controller.ts # diagnosis HTTP handlers
   ├─ services/
   │  ├─ auth.service.ts / password.service.ts / token.service.ts
   │  ├─ session.service.ts      # session CRUD and ownership-scoped reads
   │  ├─ diagnosis.service.ts    # AI turns, idempotency, confirm/complete, persistence
   │  ├─ knowledge.service.ts    # approval/scope/safety-aware KB retrieval
   │  ├─ groq.service.ts         # timeout/retry/error mapping + sanitized diagnostics
   │  ├─ ai/
   │  │  ├─ orchestrator.ts      # tool loop, backend overrides, forced-tool fallback
   │  │  ├─ prompt.ts            # trusted context + explicit final-tool instructions
   │  │  └─ tool-definitions.ts  # 4 explicit tools, strict final outcome contract
   │  ├─ parts.service.ts        # none default; opt-in groq_browser path
   │  ├─ ai.service.ts           # still an empty placeholder (historical file-layout deviation)
   │  └─ appliance-scan.service.ts # still an empty placeholder (no OCR/upload)
   ├─ middleware/
   │  ├─ auth.middleware.ts      # requireAuth -> attaches req.user
   │  ├─ validate.ts             # Zod body/params/query validation (req.validatedQuery)
   │  ├─ cors.ts                 # browser-origin allowlist + preflight
   │  ├─ rateLimit.ts            # in-memory per-process fixed-window limiter
   │  ├─ errorHandler.ts         # 4-arg Express error handler, last middleware
   │  └─ notFound.ts             # 404 catch-all
   ├─ validators/
   │  ├─ auth.validator.ts       # register/login/refresh/change-password schemas
   │  ├─ diagnosis.validator.ts  # session/message/confirm/complete schemas
   │  └─ ai.validator.ts         # bounded tool args/outcomes, context, metadata, DTOs
   ├─ types/
   │  ├─ express.d.ts            # req.user / req.validatedQuery declarations
   │  └─ diagnosis.dto.ts        # explicit session/message/turn DTO mappers and selects
   ├─ docs/
   │  ├─ openapi.ts              # OpenAPI 3.0.3 spec for all live endpoints
   │  └─ swagger.ts              # opt-in Swagger UI + raw spec router
   ├─ utils/
   │  ├─ apiResponse.ts          # sendSuccess / sendError envelope
   │  ├─ httpError.ts            # client-safe HttpError (status + code)
   │  ├─ aiDiagnostics.ts        # redacted provider/tool failure logs
   │  └─ aiErrors.ts             # ForcedToolNotCalledError sentinel
   ├─ scripts/test-prisma.ts     # one-off connection smoke test
   ├─ scripts/seed.ts            # idempotent knowledge-base seed (development-only guard)
   └─ generated/prisma/          # Prisma client output, GITIGNORED
```

`src/app.ts` mounts `/health`, `/auth`, and `/diagnosis`; `/docs` is mounted only when
`ENABLE_API_DOCS=true`. CORS runs before the routers. No `501 NOT_IMPLEMENTED` stub remains
in `src/`: all seven diagnosis routes, including `/confirm` and `/complete`, are implemented.
The historical Swagger work described in earlier notes as uncommitted was already committed
at the start of Phase 3 (single commit `15ccfeb`) and was preserved at that time; it has since
been updated to document the live endpoints. `postinstall` now runs `prisma generate`, but
running `npx prisma generate` explicitly after a fresh clone remains safe (see §7).

## 4. Request lifecycle

`server.ts` → `app.ts`:
1. `corsMiddleware` — allows requests with no browser `Origin` (native clients), checks browser
   origins against `CORS_ALLOWED_ORIGINS`, sets allow-methods/headers, and short-circuits allowed
   `OPTIONS` with 204; a disallowed browser origin gets 403 `ORIGIN_NOT_ALLOWED`
2. `express.json()` body parser
3. `app.use("/health", healthRouter)` — liveness/readiness probes
4. `app.use("/auth", authRouter)` — per-IP in-memory rate limit, auth-first where required, Zod bodies
5. `app.use("/diagnosis", diagnosisRouter)` — `requireAuth` first, route-specific rate limit on
   message turns, then Zod params/query/body validation
6. `app.use("/docs", docsRouter)` — Swagger UI/OpenAPI JSON, mounted only when `ENABLE_API_DOCS=true`
7. `notFound` → `{ success:false, error:{ code:"NOT_FOUND", message:"Route not found" } }`, 404
8. `errorHandler` → expected failures thrown as `HttpError` keep their status/code;
   unknown errors log their stack server-side and return `INTERNAL_ERROR` / 500. Never leaks
   internals. If headers were already sent it delegates back to Express.

### Response contract (`src/utils/apiResponse.ts`)

```ts
// success
{ "success": true, "data": <T> }
// error
{ "success": false, "error": { "code": "STRING_CODE", "message": "human readable" } }
```

Existing codes include `VALIDATION_ERROR` (400), `PASSWORD_UNCHANGED` (400),
`ORIGIN_NOT_ALLOWED` (403), `UNAUTHORIZED` (401), `INVALID_CREDENTIALS` (401),
`INVALID_REFRESH_TOKEN` (401), `REFRESH_TOKEN_REUSED` (401), `RATE_LIMITED` (429),
`NOT_FOUND` (404), `EMAIL_ALREADY_EXISTS` / `USERNAME_ALREADY_EXISTS` /
`ACCOUNT_ALREADY_EXISTS` (409), diagnosis codes (`SESSION_NOT_FOUND`, `SESSION_CLOSED`,
`SESSION_CONFLICT`, `SESSION_NOT_COMPLETABLE`, `APPLIANCE_NOT_FOUND`,
`APPLIANCE_NOT_AVAILABLE`, `INVALID_FIX_CONFIRMATION`, `AI_TURN_INCOMPLETE`),
AI codes (`AI_NOT_CONFIGURED`, `AI_RATE_LIMITED`, `AI_TIMEOUT`,
`AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_REJECTED`, `AI_INVALID_RESPONSE`),
`INTERNAL_ERROR` (500), and `DATABASE_UNAVAILABLE` (503). `NOT_IMPLEMENTED` (501) is no
longer emitted by live source. Add new codes as SCREAMING_SNAKE_CASE; never put raw error
text in `message`.

### Endpoints

| Method | Path              | Status      | Behaviour |
| ------ | ----------------- | ----------- | --------- |
| GET    | `/health/live`    | Working     | Process liveness; no database call |
| GET    | `/health/ready`   | Working     | Bounded database readiness check; 503 `DATABASE_UNAVAILABLE` on failure |
| GET    | `/health`         | Working     | Backward-compatible alias of `/health/ready` |
| POST   | `/auth/register`  | Working     | Body `{ email, username, password }` → 201 `{ user, tokens }`; duplicate email/username → 409; invalid body → 400. Rate limited. |
| POST   | `/auth/login`     | Working     | Body `{ email, password }` **or** `{ username, password }` → 200 `{ user, tokens }`; bad credentials → 401. Rate limited. |
| POST   | `/auth/refresh`   | Working     | Body `{ refreshToken }` → 200 `{ tokens }`; rotates the token. Reuse of a rotated/revoked token → 401 `REFRESH_TOKEN_REUSED` and revokes the entire family. Rate limited. |
| POST   | `/auth/logout`    | Working     | Body `{ refreshToken }` → 200 `{ message }`; revokes the token, idempotent. Rate limited. |
| POST   | `/auth/change-password` | Working | Requires Bearer token; body `{ currentPassword, newPassword }` → 200 `{ message }`; wrong current password → 401, unchanged/short new password → 400; revokes all active refresh tokens. Rate limited. |
| GET    | `/auth/me`        | Working     | Requires Bearer token → 200 `{ user }`; missing/invalid token → 401 |
| POST   | `/diagnosis` | Working | Auth + validated body (`applianceId` required; at least one of `symptom`/`errorCode`) → 201 `SessionDto`; verifies appliance ownership in a transaction and writes the initial USER message; 404 `APPLIANCE_NOT_FOUND` |
| GET    | `/diagnosis` | Working | Auth + paginated query (`page=1`, `limit=20`, max 100) → 200 paginated `SessionDto` list, owned only, `createdAt DESC, id DESC` |
| GET    | `/diagnosis/:id` | Working | Auth + UUID param validation → 200 `SessionDto` for an owned session; otherwise 404 `SESSION_NOT_FOUND` |
| GET    | `/diagnosis/:id/messages` | Working | Auth + UUID param + paginated query → 200 paginated `MessageDto` list, `createdAt ASC, id ASC` |
| POST   | `/diagnosis/:id/messages` | Working | Auth + UUID param + `{ requestId, content }` → 201 `TurnDto`; runs the AI turn and persists one USER + one ASSISTANT message. Only for owned OPEN sessions; same `requestId` replays the stored turn. Per-user rate limited. |
| POST   | `/diagnosis/:id/confirm` | Working | Auth + UUID param + `{ challengeId }` → server-issued, unexpired single-use challenge is hashed/cleared atomically; sets `COMPLETED + FIXED`. No client verdict is accepted. |
| POST   | `/diagnosis/:id/complete` | Working | Auth + UUID param + `{ acknowledged: true }` → completes only a session whose backend-set verdict is `NEEDS_PART`, `TECHNICIAN_REQUIRED`, or `UNRESOLVED`. |
| OPTIONS| any path | Working | CORS preflight → `204` for allowed/no-Origin requests; 403 `ORIGIN_NOT_ALLOWED` for a disallowed browser origin |

There are **no** `/appliances` CRUD routes and **no** image-upload or OCR route anywhere in
`src/`, `tests/`, or `src/docs/openapi.ts`. `Appliance` rows currently exist only through
direct Prisma fixture creation in tests; diagnosis requires an existing owned appliance id.

Auth contract: register/login return
`{ user, tokens: { accessToken, refreshToken, tokenType: "Bearer", expiresIn } }`.
Access tokens are HS256 JWTs with `sub` = user id and a 15-minute default lifetime.
Refresh tokens are opaque random values stored only as SHA-256 hashes, with a 30-day
default lifetime. Emails and usernames are trimmed and lowercased before storage/lookup;
`passwordHash` is bcrypt and the plaintext password is never persisted or returned.

Refresh-token families: every successful login/registration starts a new `familyId`; each
rotation creates the successor in the same family. The old row is revoked with a
conditional `updateMany` inside a transaction, so only one concurrent refresh can win.
If an already-revoked token is presented again, the whole family is revoked, including any
successor issued by a racing request, and the request fails with `REFRESH_TOKEN_REUSED`.
Password change rehashes the new password, revokes every active refresh token for the user,
and returns only a message (no user object or tokens). Existing access tokens remain
stateless and valid until they expire.

## 5. Data model (Prisma → Postgres, 9 models)

Read `database_design/DATABASE_DESIGN.md` before changing anything; it explains the
safety and review rules the schema cannot express.

```
User 1─* Appliance 1─*o DiagnosisSession *o─1 ErrorCode *─* RepairStep (via ErrorCodeRepairStep)
User 1─* DiagnosisSession 1─* Message
User 1─* RefreshToken
KnowledgeSource 1─* ErrorCode / RepairStep
```

| Model               | Purpose                          | Key constraints |
| ------------------- | -------------------------------- | --------------- |
| `User`              | Owner of all data and login account | `email` + `username` unique and stored lowercase; `passwordHash` bcrypt only; `updatedAt` |
| `RefreshToken`      | Rotatable login session / token family | `familyId` shared across rotations, `tokenHash` unique (SHA-256), `expiresAt`, optional `revokedAt`; cascades with user |
| `Appliance`         | Saved machine                    | `category` + `brand` required; `modelNumber`, `nickname` optional; cascade with user |
| `KnowledgeSource`   | Provenance of knowledge          | `kind`: MANUAL / MANUFACTURER_PAGE / OTHER / TEST_FIXTURE; `Restrict` delete |
| `ErrorCode`         | What a code means                | Unique `(category, brand, code, modelScope)`; `modelScope` required, `"UNSPECIFIED"` when unknown; source required, `Restrict` |
| `RepairStep`        | One safe action                  | `safetyClass`: USER_SAFE / TECHNICIAN_ONLY; `difficulty` nullable |
| `ErrorCodeRepairStep` | Ordered steps per code         | PK `(errorCodeId, repairStepId)`, unique `(errorCodeId, position)`; own `reviewStatus` |
| `DiagnosisSession`  | One troubleshooting conversation | `applianceId` nullable (`SetNull`), `errorCodeId` nullable (`Restrict`), `status` OPEN/COMPLETED/ABANDONED (`ABANDONED` has no endpoint), `verdict` nullable, server-managed `fixConfirmationChallengeId` / `fixConfirmationIssuedAt` / `fixConfirmationExpiresAt` nullable; `context Json?` holds backend-validated cross-turn state |
| `Message`           | Chat turn                        | `role` USER/ASSISTANT, cascade with session; `clientRequestId` UUID idempotency key, `metadata Json?` for validated assistant-turn payload; unique `(sessionId, clientRequestId, role)` |

Enums: `ApplianceCategory` (WASHING_MACHINE, REFRIGERATOR), `SourceKind`, `ReviewStatus`,
`SafetyClass`, `Difficulty`, `SessionStatus`, `Verdict`
(FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED), `MessageRole`.

A fifth migration artifact, `20261119120000_ai_diagnosis_metadata`, adds
`DiagnosisSession.context`, `Message.clientRequestId`, `Message.metadata`, and the unique
`(sessionId, clientRequestId, role)` index. The isolated DB smoke test expects **five**
finished migrations. Do not apply this or any migration to production; only the approved
`fixit-test` host allowlist may be used by DB tests.

### Invariants that live in code, not the DB
- IDs are **UUID v7 generated by Prisma Client only** (no Postgres default). Raw SQL
  imports must supply an ID or call `gen_random_uuid()` explicitly.
- Every knowledge row starts `UNREVIEWED`. Any edit to an approved `ErrorCode` / `RepairStep`
  / link **resets it (and its links) to `UNREVIEWED`**. Only a dedicated approve function
  may set `APPROVED`.
- Retrieval rule: return an error code's steps **only if** the code, every link, and every
  step are `APPROVED` **and** the step is `USER_SAFE`. Otherwise an incomplete procedure
  (steps 1 and 3, no 2) could reach the user.
- All knowledge writes must funnel through a single transactional module. The starter seed
  (`src/scripts/seed.ts`) is currently the only transactional knowledge-write path; a
  general runtime/editing module does not exist yet.
- All Groq/tool output is advisory. Backend code validates tool args/results with Zod,
  resolves manufacturer codes to internal UUIDs with a fresh trusted `searchErrorCodes()`
  lookup scoped by category/brand/model, and never accepts an internal `errorCodeId` from
  the model. The 36-character repair-code bound is enforced in both the tool schema and Zod.
- Provider calls stay outside Prisma transactions; only the validated orchestrator result is
  persisted in the existing turn transaction.

## 6. Environment variables

`.env` is gitignored; `.env.example` documents every required variable.

| Var            | Used by                                | Notes |
| -------------- | -------------------------------------- | ----- |
| `NODE_ENV`     | `src/config/env.ts`                    | **required, no default**: `development` / `test` / `production`. Production enforces Groq key, unreviewed-knowledge, and rate-limit guards |
| `PORT`         | `src/config/env.ts` → `server.ts`      | default `3000`; supplied values coerced to int 1–65535 |
| `DATABASE_URL` | `src/config/prisma.ts` (runtime); seed host validation | must be `postgres://` or `postgresql://`; pooled runtime connection. Local `.env` points to the development project |
| `DIRECT_URL`   | `prisma.config.ts` (migrations/introspection) and seed | direct/session connection. Local `.env` points to the development project |
| `SEED_TARGET`  | `src/scripts/seed.ts`                  | must be exactly `development`; the seed aborts if missing or different |
| `CORS_ALLOWED_ORIGINS` | `corsMiddleware`                 | comma-separated browser origins; native clients send no `Origin` and remain allowed |
| `ENABLE_API_DOCS` | `app.ts` / `docs/swagger.ts`         | default `false`; opt-in for Swagger UI and `/docs/openapi.json` |
| `HEALTH_CHECK_TIMEOUT_MS` | `config/database.ts`            | default `3000`, allowed 500–30000 |
| `RATE_LIMIT_ENABLED` | `middleware/rateLimit.ts`          | default `true`; production refuses `false` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_MESSAGE_MAX` | in-memory limiter | defaults `60000` / `30` / `60`; per-process only, use an edge limiter for multi-instance production |
| `JWT_ACCESS_SECRET` | `src/config/env.ts` → `token.service.ts` | **required**, minimum 32 characters; changing it invalidates every access token |
| `ACCESS_TOKEN_TTL_SECONDS` | `src/config/env.ts` → `token.service.ts` | default `900` (15 min), allowed 60–86400 |
| `REFRESH_TOKEN_TTL_DAYS` | `src/config/env.ts` → `token.service.ts` | default `30`, allowed 1–365 |
| `GROQ_API_KEY` | `groq.service.ts`, opt-in parts browser search | backend-only credential; optional in development/test, **required in production**; empty/whitespace counts as absent; never logged |
| `GROQ_MODEL`   | `groq.service.ts` / `parts.service.ts` | tool-capable model id; **current default `openai/gpt-oss-20b`** (the historical Phase 2 default was `openai/gpt-oss-120b`; see D3) |
| `GROQ_TIMEOUT_MS` / `GROQ_MAX_RETRIES` / `GROQ_MAX_TOOL_ROUNDS` / `GROQ_MAX_TOOL_CALLS` / `GROQ_HISTORY_LIMIT` / `GROQ_MAX_COMPLETION_TOKENS` / `GROQ_REASONING_EFFORT` | Groq adapter/orchestrator | bounded timeout, retries, tool loop, history, tokens, and reasoning effort; defaults `15000` / `1` / `2` / `3` / `12` / `1200` / `low` |
| `FIX_CONFIRMATION_TTL_SECONDS` | `diagnosis.service.ts` | default `600`; server-issued `FIXED` confirmation TTL |
| `PARTS_PROVIDER` | `parts.service.ts` | `none` (default, no provider call) or `groq_browser` (opt-in, uses Groq browser search) |
| `PARTS_ALLOWED_DOMAINS` / `PARTS_MAX_RESULTS` | `parts.service.ts` | HTTPS host allowlist and result cap for parts candidates |
| `ALLOW_UNREVIEWED_KNOWLEDGE` | `knowledge.service.ts` via `diagnosis.service.ts` | development-only switch; default `false`; accepts exactly `true`/`false`; **startup failure when `NODE_ENV=production`** |

### Test-only environment (Phase 4A)

`fixit-test` is a completely separate Neon project. Its credentials exist only in the
gitignored `.env.test`; the committed `.env.test.example` contains placeholders only,
including `RUN_DB_TESTS=0`. No `TEST_*` variable is present in `.env.example`.

| Var | Used by | Notes |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `tests/db/setup-db-env.ts` → `DATABASE_URL` | pooled `fixit-test` connection; host must be exactly the allowlisted pooler host |
| `TEST_DIRECT_URL` | guard in `tests/db/setup-db-env.ts`; one-time `prisma migrate deploy` | direct `fixit-test` connection; host must be exactly the allowlisted direct host |
| `RUN_DB_TESTS` | DB runner and provisioning | must be exactly `1`; a value of `1` must never be committed |

Configuration is split so the rules are testable: `env.schema.ts` is a pure Zod schema plus
`parseEnv(raw)` with no dotenv, logging, or process exit; `env.ts` loads dotenv, validates
`process.env`, prints only variable names/messages (never values), and exits `1` on failure.
`server.ts` imports `env` before `app` so invalid configuration fails before the app or
database client is constructed. The variables previously listed as deferred are now active
in the repository: Groq bounds, `FIX_CONFIRMATION_TTL_SECONDS`, and `PARTS_PROVIDER`. No new
secret or full connection URL may be printed in logs, tests, or documentation.

Gotcha: env validation in `env.ts` validates the application vars above; `SEED_TARGET` is
read only by the seed and is not part of that schema. `prisma.ts` reads
`process.env.DATABASE_URL` directly and throws at import time if missing. Keep both in
sync if you add config. The JWT secret has no default, so a fresh clone must copy
`.env.example` and generate a real value before `npm run dev`.

Databases are separated by Neon **project**, not by branch. `fixit-development-preserved`
is the primary development project (current direct host
`ep-winter-credit-ao2gv7ym.c-2.ap-southeast-1.aws.neon.tech`; the older
`ep-shy-glade-a1uvm947` host belonged to the original development project and is not the
current one). `fixit-test` is a separate, isolated project used only by the DB test runner;
production is a different project that test tooling never contacts. The local backend `.env`
points both `DIRECT_URL` and `DATABASE_URL` at the development project.
`src/scripts/seed.ts` requires `SEED_TARGET=development`, validates both URLs against the
approved development hostname, and rejects `NODE_ENV=production` unconditionally. It never
prints connection strings or secrets.

## 7. Commands

Run everything from `fixit-backend/`.

```bash
npm install               # postinstall runs prisma generate
npm run dev               # tsx watch src/server.ts
npm run build             # tsc -> dist/ (tests are excluded)
npm start                 # node dist/server.js (requires build first)
npm run typecheck         # tsc --noEmit (currently passes clean)
npm run typecheck:test    # typecheck src + tests + both vitest configs
npm test                  # vitest run (one-shot; excludes tests/db, no DB access)
npm run test:db           # vitest run --config vitest.db.config.ts (isolated fixit-test only)
npm run test:watch        # vitest watch mode
npm run db:seed           # tsx src/scripts/seed.ts (requires SEED_TARGET=development; uses DIRECT_URL)

npx prisma validate                        # validate schema
npx prisma generate                        # rebuild src/generated/prisma
npx prisma migrate dev                     # create + apply a migration (local only)
npx prisma migrate deploy                  # apply in CI/production — NEVER to a local dev/prod target without explicit authorization
npx prisma studio                          # browse data
npx tsx src/scripts/test-prisma.ts         # one-off connection smoke test
```

There is **no lint script or ESLint/Prettier config** in the backend. Run typecheck and
`git diff --check` instead.

`npm test` currently passes **171 runtime tests across 12 DB-free files** (re-run during this
audit on 2026-11-19). Coverage includes env/production guards, HTTP envelopes/rate limiting,
all diagnosis route contracts, OpenAPI drift, knowledge approval/scope/safety, Groq error
mapping/redaction, AI tool schemas, orchestration and backend overrides, forced-tool fallback,
parts classification, and diagnosis service replay/idempotency/confirm/complete. These tests
use dummy credentials and make no database, network, or live AI calls.

`npm run test:db` has **32 tests across 3 files** against `fixit-test` only: 9 fail-closed
guard cases, 6 read-only schema/smoke checks (including the five expected migrations), and 17
diagnosis integration cases (creation/ownership, message turns and replay, approved fixture,
challenge issuance, and confirm/complete lifecycle). The last full DB run recorded in the
working history was **32/32**; it was **not rerun for the latest forced-tool fallback change**
because no persistence code changed. `tests/setup-env.ts` refuses `NODE_ENV=production`;
`tests/db/setup-db-env.ts` additionally requires `RUN_DB_TESTS=1` and an exact `fixit-test`
host allowlist match, and never prints values, credentials, or full URLs.

## 8. Conventions observed in the code

- **ESM + nodenext**: every relative import ends in `.js`, even for `.ts` sources
  (`import { app } from "./app.js"`). Do not drop the extension.
- Path aliases: **none** — use relative imports.
- Default export vs named: code uses **named exports** everywhere (`export const app`,
  `export function sendError`). Keep it that way.
- Comments explain *why*, often noting security intent ("never send it to the client",
  "must remain last"). Match that tone; avoid restating the code.
- Layering: `route → controller → service → prisma`. Controllers handle HTTP only and
  call `next(error)`; services hold business logic; `utils/` holds cross-cutting helpers.
- Expected failures are thrown as `HttpError(status, CODE, message)` from services and
  mapped by `errorHandler`; unexpected errors stay generic 500s. Never throw raw Prisma or
  library messages at the client.
- Controller signature: `async (req: Request, res: Response, next: NextFunction)`.
- Protected routes use `requireAuth`, which reads `Authorization: Bearer <token>` and sets
  `req.user = { id }`. Never take a user id from the request body/params for ownership.
- Refresh rotations must keep the existing `familyId`. Any replay of a revoked token must
  revoke the family, not just the presented row.
- Formatting is inconsistent (mixed single/double quotes, some missing semicolons, tight
  spacing like `sendError(res,503,'CODE','msg')`). Follow the surrounding file rather than
  reformatting; there is no ESLint/Prettier config to defer to.
- Type-only imports use `import type { ... }`.

## 9. Current state & known gaps

**Audited current state (2026-11-19):** the repository now implements env validation,
Prisma client with driver adapter, health probes, error envelope, `HttpError` handling,
404/500 handling, the complete email/password auth flow, owner-scoped diagnosis session and
message persistence, backend knowledge retrieval with approval/scope/safety policy, a Groq
adapter with bounded tool loop, orchestration with backend-controlled verdicts and challenge
lifecycle, idempotent AI turns with replay recovery, and a replaceable parts provider with a
safe disabled default. The earlier statement that auth was the only complete feature is
historical; it is superseded by the source and test evidence recorded below.

Historical auth detail (still true): password change verifies the current password, rejects an
unchanged new password, rehashes, revokes every active refresh token, and returns no user or
credential data. Refresh-token families detect replay, revoke the whole family, and use a
conditional transaction so concurrent refresh requests cannot both succeed. Status labels in
this document distinguish IMPLEMENTED, TESTED, APPROVED, PENDING, and UNVERIFIED; do not read
"implemented" as "approved".

Knowledge-base seeding is complete. `npm run db:seed` was run exactly once against the
development branch and the transaction committed successfully (exit code 0): 15
`KnowledgeSource` rows, 77 `ErrorCode` rows, 117 distinct `RepairStep` rows (71 in-run
reuses across 188 links), and 188 `ErrorCodeRepairStep` links, with no conflicts. All 77
ErrorCodes, 117 RepairSteps, and 188 links were verified `UNREVIEWED`; no records were
approved. LG standalone `F` remains intentionally excluded, and the Haier E1/E4 source
attribution and `TOP_LOAD` model scopes are preserved. `npm run typecheck`,
`npx prisma validate`, `npx prisma migrate status`, and static seed validation all pass.
Seeding emitted a non-blocking PostgreSQL SSL-mode deprecation warning from `pg`; it did
not affect the transaction. No schema changes or migrations were performed during seeding.

Phase 1 (2026-11-16) updated the schema to add the `UNRESOLVED` verdict, rename
`CALL_TECHNICIAN` to `TECHNICIAN_REQUIRED`, and add the three nullable `fixConfirmation*`
challenge fields on `DiagnosisSession`. The migration
`20261116093023_verdict_pending_confirmation` was generated, reviewed, and then applied to
the **development** branch after explicit authorization. Read-only verification confirmed
the DB enum is now `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED`, all three columns
exist and are nullable, and `_prisma_migrations` records the migration as finished.
`npx prisma migrate status` reports the schema up to date; `npx prisma validate`,
`npx prisma generate`, and `npm run typecheck` pass. No production database was accessed,
and diagnosis code and behaviour are untouched. Phase 1 was explicitly approved by the
user on 2026-11-16.

Phase 2 (2026-11-16) added the environment, dependency, and test-harness foundation:
`groq-sdk` 1.6 plus Vitest 5/Vite 8/Supertest 7; a pure `env.schema.ts`; required
`NODE_ENV`; `GROQ_API_KEY`, `GROQ_MODEL`, and `ALLOW_UNREVIEWED_KNOWLEDGE`; startup
guards that reject production without a Groq key and reject unreviewed knowledge in
production; and a Node/environment test config. `npm test` now runs `vitest run` and
passes 14 tests in 3 files; `npm run typecheck`, `npm run typecheck:test`, `npm run build`,
and `npx prisma validate` also pass. Tests use dummy credentials and make no database or
network/AI calls. No schema, migration, seed, diagnosis code, Swagger file, or database
record was changed. Phase 2 is implemented and tested (2026-11-16) and was explicitly
**approved by the user on 2026-11-17**.

Knowledge-base read-only audit and scoped approval (2026-11-16, development Neon only):

- **Audit (read-only, no changes):** Step 1 standalone audit of actual development Neon DB records (dev host `ep-shy-glade-a1uvm947.ap-southeast-1.aws.neon.tech`, `prodLike=false`). No production DB accessed. No schema, migrations, seed, or application code modified. Artifacts: `C:\Users\Sonic\AppData\Local\Temp\opencode\audit_report.md`, `C:\Users\Sonic\AppData\Local\Temp\opencode\audit_analysis.json`, `C:\Users\Sonic\AppData\Local\Temp\opencode\audit_kb.json`. Counts audited (all `UNREVIEWED` before update): 15 `KnowledgeSource`, 77 `ErrorCode` (22 explicitly scoped `TOP_LOAD`/`FRONT_LOAD`/`FRENCH_DOOR_BOTTOM_FREEZER`, 55 `UNSPECIFIED`), 117 `RepairStep` (74 `USER_SAFE`, 43 `TECHNICIAN_ONLY`), 188 `ErrorCodeRepairStep`.
- **Classification:** ErrorCodes 22 bucket 1 (eligible) / 55 bucket 2 (requires additional verification/correction; `UNSPECIFIED` never treated as wildcard); RepairSteps 74 bucket 1 (`USER_SAFE`, manufacturer-supported, no DIY electrical/gas/sealed-refrigerant opening/access) / 43 bucket 3 (`TECHNICIAN_ONLY`, must remain unapproved and not changed to `USER_SAFE`); Links 46 bucket 1 / 64 bucket 2 / 78 bucket 3 (approved only when independently supportable and both sides eligible). No bucket 4.
- **Explicit user approval (2026-11-16):** user approved the exact audit scope: approve 22 eligible `ErrorCode`s, 74 eligible `USER_SAFE` `RepairStep`s (preserve safety classifications), and 46 eligible `ErrorCodeRepairStep` relationships; keep remaining 55 `UNSPECIFIED` ErrorCodes, 43 `TECHNICIAN_ONLY` RepairSteps, and 142 ineligible relationships `UNREVIEWED`. No broadening of scope; no changes to source references, model scopes, safety classifications, or repair instructions.
- **DB updates executed (development only):** applied via a one-off transactional Prisma script run from `fixit-backend` using `DATABASE_URL`/`DIRECT_URL` validated against approved dev host (script removed after run; no application code modified). Updated counts: `ErrorCode.updateMany` 22, `RepairStep.updateMany` 74, `ErrorCodeRepairStep` updates 46. Final status counts: `ErrorCode` 22 `APPROVED` / 55 `UNREVIEWED`; `RepairStep` 74 `APPROVED`+`USER_SAFE` / 43 `UNREVIEWED`+`TECHNICIAN_ONLY`; `ErrorCodeRepairStep` 46 `APPROVED` / 142 `UNREVIEWED`.
- **Independent verification (passed):** (1) final status counts match expected totals; (2) 0 approved `RepairStep`s are non-`USER_SAFE`; (3) 0 approved relationships connect a non-approved/inapplicable record (every approved link joins approved ErrorCode and approved RepairStep); (4) exactly **1** complete production-returnable sequence exists — `01a1d97f-b545-736b-a307-5d55dbf9c829` (LG `WASHING_MACHINE` `FE`, `TOP_LOAD`) with 2 approved `USER_SAFE` steps/links (`01a1d97f-b616-7519-8c0c-9e3f3873f6eb` pos 1, `01a1d97f-b7f9-723b-93d5-b9623d8b262e` pos 2). 19 other approved ErrorCodes have some approved links but are **not** complete/returnable because not every linked step/link is approved (no partial repair sequence becomes returnable under the all-approved/all-`USER_SAFE`/no-partial rule); (5) only development DB accessed (host validated; `NODE_ENV` not production; no production access).
- **Current approval status:** approved knowledge scope is limited to the 22/74/46 records above (exact eligible ID sets recorded in `audit_analysis.json`/temp artifacts). All other knowledge remains `UNREVIEWED`. No Phase 2 diagnosis work started. No schema/migrations/seed/app code changes performed for this task.

Current gaps and unverified items, roughly in dependency order:

1. **Authenticated Appliance CRUD is ABSENT.** No `/appliances` route, controller, service,
   validator, DTO, OpenAPI path, or test exists. The Prisma `Appliance` model exists
   (`category`, `brand`, optional `modelNumber`/`nickname`) and diagnosis only reads/validates
   ownership of an already-existing `applianceId`. This is the next planned backend phase.
2. **OCR and image upload are ABSENT.** `src/services/appliance-scan.service.ts` is an empty
   placeholder; no OCR dependency, upload route, storage policy, or review/correction API
   exists. The root Expo `scan` screen captures/picks a photo locally but never uploads it.
3. **Groq live reliability remains UNVERIFIED.** The deterministic fallback is narrowly
   tested with mocks. The Samsung `WW80T3040WW` live test (recorded separately below)
   verified safe behavior but did not prove fallback activation. A controlled live test that
   triggers the exact provider rejection is still required. A 200 response with no tool call
   is not covered by the fallback and still becomes `AI_INVALID_RESPONSE`.
4. **Parts discovery is implemented but externally UNVERIFIED.** Local/default
   `PARTS_PROVIDER=none` disables calls; the `groq_browser` code path and compatibility
   classification are unit-tested but have not been verified with live browser search.
5. **Phase 5–8 implementation is present, but no explicit phase approval is recorded for
   those roadmap phases.** Phases 1–4B retain their historical explicit approvals. Do not
   upgrade later phases to `APPROVED BY USER` without an explicit user action.
6. **Phase 9 is PARTIAL.** Rate limiting, CORS allowlist, docs opt-in, DTO allowlists,
   redacted AI diagnostics, and OpenAPI contract tests exist. SSE/streaming does not;
   `createChatCompletion` explicitly rejects streaming completions. D7 remains open.
7. **Operational hardening gaps remain:** in-memory rate limiting is single-process only;
   email verification, password reset, account lockout, session listing/revocation, and
   distributed rate limiting are absent. Access tokens remain stateless until expiry.
8. **`src/generated/` is gitignored** — fresh clones must run `prisma generate`; `postinstall`
   now does this, but build/typecheck still depend on generation having run.
9. Deferred by design: appliance model/family tables, review audit records (who approved),
   standalone symptom/cause knowledge, push tokens, subscriptions, image/storage services,
   and production knowledge promotion. Never add these implicitly.

## 10. Connecting from the Expo app

The mobile client lives at the repo root (`src/app/`, Expo Router). Audited status on
2026-11-19: Expo SDK 58, React Native 0.88.1, React 19.3.0, `expo-router` 58; npm project
(`package-lock.json`, no `bun.lock`). The root `AGENTS.md` requires reading SDK-versioned
docs before writing Expo/EAS/RN code, using `npx expo install` for native modules, and
running `npx expo lint` / `npx tsc --noEmit` before declaring frontend work done. No `ios/`
or `android/` directories exist; do not create or hand-edit them.

Frontend implementation is still a scaffold:

- `src/app/index.tsx` — static home UI with `router.push('/scan')`.
- `src/app/scan.tsx` — real local camera/gallery capture and preview with permission states,
  but an explicit upload TODO; no API call or navigation onward.
- `src/app/appliances.tsx`, `src/app/diagnose/[id].tsx`, `lib/api.ts`, `types/index.ts`, and
  `components/{VerdictCard,StepCard,SafetyBanner}.tsx` are **empty placeholder files**.
- No `fetch`/`axios`/`FormData` calls, token storage, auth context, protected routes, session
  creation/history, message turns, confirm/complete UI, OCR, or parts presentation exists.
  `expo-secure-store` and an HTTP client library are not installed; `expo-constants` is
  installed but unused.

When wiring it up: point the app at `http://<LAN-IP>:3000`, not `localhost` (a device or
emulator can't reach the host's loopback), and consider `expo-constants` `hostUri` for
auto-detection. Responses must be parsed through the `{ success, data }` envelope, not
raw payloads. Store the access token in secure storage, send it as
`Authorization: Bearer <token>`, and refresh proactively before `expiresIn` elapses.
Frontend integration is a separate future milestone and is not authorized by this audit.

## 11. Quick orientation for an AI agent

- Read `database_design/DATABASE_DESIGN.md` before touching `prisma/schema.prisma`; the
  review/safety rules there are requirements, not suggestions.
- Follow the strict layer boundaries and the response envelope — consistency here is the
  main thing keeping the codebase coherent at this stage.
- Run `npm run typecheck` after changes; it is currently green, so any error is yours.
- Seed only through `npm run db:seed` with `SEED_TARGET=development`; `src/scripts/seed.ts`
  validates both connection URLs against the approved development host and rejects
  `NODE_ENV=production`.
- Create users only through `auth.service.register` (it hashes the password and issues a
  refresh token atomically). Password changes must go through `auth.service.changePassword`
  so the new hash and refresh-token revocation stay in one transaction. Never return
  `passwordHash`, and never let `sendError` echo internal error messages.
- Keep `familyId` stable across rotations; replaying a revoked token must revoke the family.
- Keep `.js` extensions on relative imports; the ESM config will break otherwise.
- Never access or modify a production database. `fixit-development-preserved` is development;
  `fixit-test` is the isolated integration-test project. DB tests must use only the existing
  exact host allowlist and `RUN_DB_TESTS=1`.
- Never expose secrets, API keys, passwords, or full database URLs. Redaction is enforced in
  AI diagnostics and DB-test guards; preserve it.
- Do not weaken Zod validation, knowledge approval, model-scope/safety checks, ownership
  checks, forced tool choice, or request-id idempotency. Keep provider calls outside DB
  transactions. Do not commit, push, or deploy unless explicitly requested.
- Treat model output as advisory. Backend code is authoritative for verdicts, repair steps,
  citations, parts compatibility, confirmation challenges, and persistence.

## Diagnosis & Sessions Implementation Roadmap

> Authoritative handover for Fix-It Diagnosis & Sessions. This roadmap is approved as the implementation plan; **no implementation is authorized by this document alone**. Every phase requires explicit user authorization before work begins. Preserve and update this section (and existing sections above) in every session.

### Persistent progress tracker

- **Current audited implementation state (2026-11-19):** original Phases 1–7 are implemented in source; Phase 8 is implemented with a safe disabled default and an externally unverified opt-in provider; Phase 9 is partial (hardening/docs yes, SSE absent). See the audit correction below for evidence and status labels.
- **Latest completed work:** Groq final-round reliability — prompt strengthening plus narrow deterministic backend fallback. IMPLEMENTED; unit-tested; **not live-activation-verified**; no explicit roadmap phase approval recorded.
- **Last unit-test result:** `npm test` 171/171 in 12 DB-free files; `npm run typecheck`, `npm run typecheck:test`, `npm run build`, and `git diff --check` passed on 2026-11-19.
- **Last DB integration result:** 32/32 in 3 files against isolated `fixit-test`; **NOT rerun for the latest fallback change** because persistence code did not change.
- **Last phase explicitly approved by user:** Phase 4B (2026-11-19). Phase 4A was approved 2026-11-17; Phase 3 on 2026-11-17; Phase 2 on 2026-11-17; Phase 1 on 2026-11-16. Do not infer approval for Phases 5–9.
- **Next planned implementation (awaiting explicit authorization):** Phase 10 — Authenticated Appliance CRUD. Phase 5–8 code already exists but has no recorded explicit phase approval; do not start any implementation until the user authorizes the specific task.
- **Outstanding decisions:** D1–D5 and D8–D10 resolved; D3's historical default (`openai/gpt-oss-120b`) was later changed by implementation to `openai/gpt-oss-20b` (see D3); D6 is resolved only as an implementation mechanism (`PARTS_PROVIDER=none` default, opt-in `groq_browser`) but live enablement/key choice remains operationally open; D7 remains open because no SSE exists; D4/D5 are now fully implemented, not merely contracts.
- **Historical progress update (phase-era snapshot, superseded by the 2026-11-19 audit below):** 2026-11-17 — Phase 4A implemented and tested after explicit authorization, then **explicitly approved by the user on 2026-11-17** after confirming the tables were created in `fixit-test`. Added `.env.test.example`, `vitest.db.config.ts`, and `tests/db/{setup-db-env,helpers,guards.test,smoke.test}.ts`; wired `npm run test:db`; hardened `vitest.config.ts` so plain `npm test` stays DB-free. The fail-closed guard allows only the two exact `fixit-test` hosts, requires `RUN_DB_TESTS=1`, rejects production/development hosts, and never prints credentials. One-time `prisma migrate deploy` applied all four existing migrations to the isolated `fixit-test` project (PostgreSQL 18.7) only; enum, nullable columns, empty tables, migration history and a sentinel marker were verified. `npm test` 37/37 (DB-free), `npm run test:db` 15/15, typechecks and build pass. No application service, controller, route, validator, schema, migration or seed change; no development/production access; no staging or commit. Phase 3 remains approved and its record is preserved below. **Phase 4B was subsequently explicitly authorized by the user, implemented, tested, and explicitly approved by the user on 2026-11-19; it is APPROVED BY USER.** Phase 4B added `src/types/diagnosis.dto.ts`, `tests/db/diagnosis.integration.test.ts`, and `tests/docs/openapi.contract.test.ts`; modified the two diagnosis services, `src/docs/openapi.ts`, `tests/http/diagnosis.routes.test.ts`, `tests/db/helpers.ts`, and this file. Five APIs persisted sessions/messages with owner-scoped queries, explicit DTOs, a creation transaction and a conditional OPEN-state message write; at that time confirm/complete still returned 501 and were implemented later. `npm test` 56/56 (DB-free), `npm run test:db` 27/27 on `fixit-test` twice, typechecks, build and `prisma validate` pass. An initial transient DNS failure affected the first DB run; it resolved on retry. No schema, migration, seed, controller, route or validator change; no development/production access; no staging or commit. **Production knowledge promotion is still required:** development knowledge does not automatically exist in production.

**Status values (use consistently):** `NOT STARTED` | `IN PROGRESS` | `IMPLEMENTED` | `TESTS PASSED` | `APPROVAL PENDING` | `APPROVED BY USER`
**Rule:** distinguish implementation completion, successful testing, and explicit user approval. Never mark `APPROVED BY USER` without the user's explicit approval.

### Historical starting position (recorded at Phase 4B; superseded by the 2026-11-19 audit)

The bullets below preserve phase-era history. Statements such as “501 stubs”, “no AI”,
“rate limiting deferred”, and phase-era test counts were true at the time recorded; they are
not the current repository state. The current status is in the persistent tracker above and
in the 2026-11-19 audit addendum at the end of this file.

- Phases 1–9 are **planned and reviewed**; the implementation roadmap is **approved** as the plan.
- **Phase 1 is APPROVED BY USER (2026-11-16).** Its migration is applied and verified on the development branch. No migration was applied to production.
- **Phase 2 is APPROVED BY USER (2026-11-17); implementation and tests completed 2026-11-16.** The user independently ran and verified `npm test` (14 tests passed across 3 files), `npm run typecheck`, `npm run typecheck:test`, `npm run build`, and `npx prisma validate`; all passed. Phase 2 added only environment, dependency, and test-harness infrastructure; no database access, schema/migration/seed change, or diagnosis behavior.
- **Phase 3 is APPROVED BY USER (2026-11-17).** The user explicitly authorized Phase 3 with D4/D5/D8 decisions, then explicitly approved the completed phase after the final read-only review. Implementation added HTTP scaffolding only. Phase 4A is implemented, tested, and **APPROVED BY USER (2026-11-17)**. Phase 4B was later authorized by the user, implemented, tested, and **APPROVED BY USER (2026-11-19)**; nothing was staged or committed.
- **Phase 4A (2026-11-17): IMPLEMENTED; TESTS PASSED; APPROVED BY USER (2026-11-17).** The user authorized only test infrastructure and one-time provisioning of `fixit-test`, then explicitly approved the completed phase after confirming the tables were successfully created in the isolated `fixit-test` Neon project. D9 is resolved by a separate isolated Neon project, not a child branch. Four existing migrations were deployed to `fixit-test` with `prisma migrate deploy` and verified; a sentinel marker was added. No application service, controller, route, validator, Prisma schema, existing migration or seed logic was changed.
- **Phase 4B (2026-11-17 implemented; APPROVED BY USER 2026-11-19): IMPLEMENTED; TESTS PASSED; APPROVED BY USER (2026-11-19).** The user explicitly authorized the implementation plan, including all five APIs, Swagger documentation, integration tests, and the optional-model-number requirement, then explicitly approved the completed result on 2026-11-19. At Phase 4B, five endpoints persisted conversations only; no AI, knowledge, verdict, confirmation or completion logic was added in that phase. Later uncommitted work implemented the remaining features. No schema/migration/seed change; no development/production access; no staging or commit.
- **No seed was run during Phases 1–4B. No production database was accessed; no development database was accessed during Phase 4A or 4B.**
- **Phase 3 scope/decisions (implemented):** seven authenticated routes under `/diagnosis`; `createSessionSchema` requires `applianceId` plus at least one of `symptom`/`errorCode` (no model number needed in the request — older appliances are supported through an `Appliance` with no `modelNumber`); pagination `page=1`, `limit=20`, max 100; `501 NOT_IMPLEMENTED` stubs at that time; `POST /diagnosis/:id/confirm` with `{ challengeId }` and `POST /diagnosis/:id/complete` with `{ acknowledged: true }`; minimal CORS, rate limiting deferred then; `src/docs/**` untouched at that time. These historical scope decisions were not downgraded; later phases superseded only the temporary stubs and added rate limiting.
- **Phase 4B scope/decisions (implemented):** five persistence APIs implemented; `SessionDto`/`MessageDto`/paginated DTO mappers with explicit selects; creation transaction verifies appliance ownership then writes the session and one initial USER message; initial message maps `symptom` then `errorCode` (newline-separated when both supplied), with no model-number inference or knowledge lookup; message sending uses an owner-scoped OPEN-state conditional `updateMany` inside a transaction; confirm/complete stayed 501 at Phase 4B; OpenAPI documents all seven endpoints; DB-free contract tests guard spec/validator/DTO drift.
- **Phase 2 scope/decisions (implemented):** `groq-sdk` 1.6 + Vitest 5/Vite 8/Supertest 7; pure `env.schema.ts` + side-effecting `env.ts`; `NODE_ENV` required; only `GROQ_API_KEY`, `GROQ_MODEL`, and `ALLOW_UNREVIEWED_KNOWLEDGE` added; production rejects a missing Groq key and rejects unreviewed knowledge; `npm test` = `vitest run`; tests refuse `NODE_ENV=production` and use dummy credentials. Deferred: `GROQ_TIMEOUT_MS`, `GROQ_MAX_RETRIES`, `GROQ_MAX_TOOL_ROUNDS`, `FIX_CONFIRMATION_TTL_SECONDS`, and `PARTS_PROVIDER`.
- **Phase 1 scope/decisions (implemented):** `Verdict` is now `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED`; migration `20261116093023_verdict_pending_confirmation` safely renames `CALL_TECHNICIAN` → `TECHNICIAN_REQUIRED` and adds `UNRESOLVED`; `DiagnosisSession` gained the three approved nullable/server-managed fields `fixConfirmationChallengeId`, `fixConfirmationIssuedAt`, and `fixConfirmationExpiresAt` (single-use `FIXED` confirmation challenge persisted across requests; `Message` content is not authoritative). MVP keeps `applianceId`-based context (no ad-hoc snapshot columns).
- **Preflight/apply state (development branch):** before apply, 3 migrations were applied; `Verdict` was `FIXED, NEEDS_PART, CALL_TECHNICIAN`; 0 `DiagnosisSession` rows; no `fixConfirmation*` columns. After explicit authorization, the migration was applied: the enum now has all four values, all three nullable columns exist, and `_prisma_migrations` records the migration as finished. Knowledge-base row counts were unchanged (15 sources, 77 error codes, 117 repair steps, 188 links) and diagnosis sessions remain 0.
- **Baseline repo state at Phase 1 start:** diagnosis routes/controller/services are scaffolded/unwired (router not mounted in `app.ts`, controller empty, services empty); no `groq-sdk`, no test runner. Swagger/OpenAPI work was described as uncommitted in earlier notes; at Phase 3 start the working tree was clean and that work was present in commit `15ccfeb`. Phase 2 added the dependencies and test runner; Phase 3 wired the HTTP scaffold and preserved `src/docs/**` byte-identical.

### Permanent implementation workflow (follow in every future session)

**One phase at a time**
- The user will explicitly authorize each phase. Implement **only** the currently authorized phase.
- Never automatically proceed to the next phase. After completing a phase, **stop and wait** for user review and approval.
- Approval of one phase **does not** authorize the next phase.

**After each phase (before ending the session)**
- Update `CONTEXT.md` with: phase status; actual files created or modified; schema and migration changes; commands actually executed and their results; tests passed, failed, or not run; unresolved issues and deviations; decisions requiring user input; and whether the user has explicitly approved the phase.
- Never mark a phase as user-approved without the user's explicit approval.

**New-session procedure**
1. Read `CONTEXT.md`.
2. Read the implementation roadmap and progress tracker.
3. Inspect the actual repository state and Git changes.
4. Verify documented progress against the code and test results.
5. Identify the current phase and its approval status.
6. Ask for approval if the next action has not already been authorized.

- Never assume a phase was implemented or approved just because the roadmap lists it.
- If `CONTEXT.md` and repository state disagree, **report the discrepancy and ask before proceeding**.

### Approved architectural decisions and non-negotiable engineering constraints

- **Stack/architecture:** preserve existing project architecture and layering (`route → controller → service → prisma`), Express/Prisma/Zod, named exports, ESM `.js` imports, response envelope/error handling, Groq SDK approach (backend-only), JSON-first baseline, replaceable parts provider, minimal dependencies, no unrelated refactoring.
- **MVP appliance context:** require existing saved `Appliance` referenced via `DiagnosisSession.applianceId` (ownership-validated, server-derived trusted context). No ad-hoc appliance snapshot columns in MVP (standalone snapshot only if later explicitly approved with migration).
- **Verdicts & states:** final verdicts `FIXED | NEEDS_PART | TECHNICIAN_REQUIRED | UNRESOLVED`; `NEEDS_CLARIFICATION` is an intermediate outcome (not a verdict) keeping session `OPEN`, `verdict=null`. `status` and `verdict` are separate and backend-controlled; `verdict` nullable during diagnosis.
- **`FIXED`:** only with deterministic, backend-validated explicit user confirmation gated by server-controlled pending confirmation state persisted across requests (not `Message` content, not Groq-supplied confirmation). Backend alone authorizes `FIXED` and completion.
- **`NEEDS_PART`:** only with deterministic backend-validated minimum evidence (relevant symptoms/user reports + validated troubleshooting observations/results or exhausted/inapplicable eligible safe checks + concrete component linkage supported by applicable in-scope/model-specific knowledge where available). Groq confidence alone never compensates. Suspected-component diagnosis is separate from replacement-part compatibility (`VERIFIED|POSSIBLE_MATCH|UNKNOWN`), never claimed verified without authoritative evidence.
- **`NEEDS_PART` lifecycle:** evidence-validated → `OPEN + verdict=NEEDS_PART` (parts discovery/follow-up allowed); `COMPLETED + NEEDS_PART` only on explicit user end/acknowledgment or backend-determined no-further-in-app-action (exact trigger per D5). No auto-complete merely for showing parts.
- **Safety/knowledge (non-negotiable):** Groq proposes, backend independently validates/overrides; never trust model verdict/free-form output for state. `USER_SAFE` steps only when approval/env policy and model-scope pass; `TECHNICIAN_ONLY` never exposed as DIY. Electrical/gas/sealed-refrigerant work always escalates to `TECHNICIAN_REQUIRED` in dev and prod. Never return partial repair sequences omitting unsafe/ineligible required steps. Dev `UNREVIEWED` access env-gated, explicitly labeled, and **impossible in production** — never bypasses safety or model-scope. Missing knowledge/eligible safe steps alone must **not** auto-escalate; distinguish genuine hazard/professional need (`TECHNICIAN_REQUIRED`) from insufficient info (`NEEDS_CLARIFICATION`/`UNRESOLVED`).
- **Diagnosis modes (product requirement, recorded):** Fix-It must support both error-code-based and symptom-based diagnosis. Users may provide an error code, but must also be able to describe symptoms when they do not know the error code or exact model number, including on older appliances. The agent must ask targeted questions, distinguish confirmed knowledge from possible causes, respect model applicability, and never invent repair instructions.
- **Tools/outcomes:** keep `search_error_codes`, `get_repair_steps`, `find_replacement_parts` (backend-authorized, ephemeral, no Prisma persistence); no `get_appliance_info` tool (inject trusted context); clarification and escalation are structured/backend-enforced outcomes, not model-invoked tools. Model never executes arbitrary DB/external requests.
- **Security/integrity:** Groq/parts secrets backend-only (`.env` never requested/exposed); enforce auth/ownership on every diagnosis access; validate all tool I/O and structured outcomes with Zod/bounds; preserve existing invariants; no `userId` trusted from client for ownership.

### Outstanding decisions and current status

| ID | Decision | Status | Notes |
|---|---|---|---|
| D1 | `Verdict` enum migration mapping/SQL strategy for `CALL_TECHNICIAN`→`TECHNICIAN_REQUIRED` and handling of any existing rows; generate-only vs apply in Phase 1 | **Resolved 2026-11-16** | In-place `ALTER TYPE ... RENAME VALUE` preserves existing values; `ADD VALUE 'UNRESOLVED'`. Generated and reviewed first, then applied to development via `migrate deploy` after separate explicit authorization. Preflight found 0 `DiagnosisSession` rows; post-apply verification passed. Production untouched. |
| D2 | Test stack & scripts (`vitest`+`supertest` or alternative) | **Resolved 2026-11-16** | Vitest 5.1 + Vite 8.3.8 + Supertest 7.3.2; `npm test` = `vitest run`, with `test:watch` kept separate. Coverage/browser tooling deferred. |
| D3 | Default Groq model id (tool-capable, env-configurable) | **Resolved 2026-11-16; current default later changed by implementation** | Phase 2 resolved `openai/gpt-oss-120b` with `GROQ_MODEL` override. The implemented adapter now defaults to **`openai/gpt-oss-20b`** (`src/config/env.schema.ts`); this is a later implementation change, not a downgrade of the Phase 2 decision. No API key or live model result is recorded here. |
| D4 | Explicit `FIXED` confirmation action form/contract (e.g. dedicated endpoint/flag) matched to pending challenge | **Resolved 2026-11-17 (Phase 3 contract)** | `POST /diagnosis/:id/confirm` with `{ challengeId }`; the challenge must be server-issued and checked against persisted state in a later phase. No client-provided verdict is accepted. Later implementation now issues a server-side UUID, stores only its SHA-256 hash, checks expiry/single use atomically, and sets `FIXED`. |
| D5 | `NEEDS_PART` completion trigger (explicit end/ack action and/or deterministic no-further-in-app-action rule) | **Resolved 2026-11-17 (Phase 3 contract)** | `POST /diagnosis/:id/complete` with `{ acknowledged: true }`; deterministic no-further-action rule still belongs to Phase 7. Later implementation accepts completion only for backend-set `NEEDS_PART`, `TECHNICIAN_REQUIRED`, or `UNRESOLVED`. |
| D6 | Initial parts provider enablement (`none` default vs specific provider/API key) | **Implementation mechanism resolved; operational choice still open** | Phase 8 is implemented with `PARTS_PROVIDER=none` as the safe default and opt-in `groq_browser`. Local/default is `none`; live `groq_browser` discovery and any production enablement/key choice remain UNVERIFIED and require separate authorization. |
| D7 | Streaming priority (JSON-only MVP vs include SSE) | Open | Current implementation is JSON-only; `createChatCompletion` explicitly rejects streaming completions and no SSE utility/route exists. Any SSE work is a separate future scope decision. |
| D8 | CORS and/or basic rate limiting in-scope | **Resolved 2026-11-17 (Phase 3 scope); later extended** | Minimal CORS was implemented in Phase 3 and remains approved. Phase 9 later added a strict browser-origin allowlist and in-memory per-process rate limiting; the multi-instance/edge-limiter choice remains an operational gap. |
| D9 | Test database strategy | **Resolved 2026-11-17** | No database access in Phase 2. Phase 4A uses a separate, isolated Neon project `fixit-test` (PostgreSQL 18.7), **not** a child branch of the development project, avoiding knowledge contamination. Four migrations were deployed and verified there; development and production were untouched. |
| D10 | Symptom-based diagnosis knowledge strategy | **Resolved 2026-11-16 — option C (hybrid)** | MVP uses approved error-code knowledge with symptom-based questioning and candidate narrowing. AI candidate codes are hypotheses, never confirmed diagnoses; the backend validates candidates against applicable knowledge before any repair instructions. A dedicated reviewed symptom/cause knowledge model may be added later if needed. |

### 2026-11-19 audit correction — current implementation status

This section was added by a **documentation-only audit**. The original approved checklist
below is preserved verbatim as the approved plan; the table here records what the repository
actually contains now. Status labels are: **IMPLEMENTED**, **TESTED**, **APPROVED**,
**PENDING**, and **UNVERIFIED**. Implementation/testing is not approval.

| Phase | Current status | Evidence / reason for correction |
|---|---|---|
| 1 | IMPLEMENTED; TESTED; **APPROVED BY USER (2026-11-16)** | `prisma/schema.prisma`; `20261116093023_verdict_pending_confirmation/migration.sql`; DB verification record below. |
| 2 | IMPLEMENTED; TESTED; **APPROVED BY USER (2026-11-17)** | `src/config/env.schema.ts`, `vitest.config.ts`, `tests/config/env.test.ts`. Env surface later expanded by implemented phases; original D3 default is unchanged as a historical decision but current default is `openai/gpt-oss-20b`. |
| 3 | IMPLEMENTED; TESTED; **APPROVED BY USER (2026-11-17)** | Seven diagnosis routes are live in `src/routes/diagnosis.routes.ts`; validators/middleware/controllers exist. The original `501` stubs were intentionally temporary and were replaced by later phases; D4/D5/D8 decisions were preserved. |
| 4A | IMPLEMENTED; TESTED; **APPROVED BY USER (2026-11-17)** | Isolated `fixit-test` guard/runner in `tests/db/setup-db-env.ts`, `vitest.db.config.ts`, and `tests/db/guards.test.ts`. Current smoke test expects five finished migrations; the original Phase 4A record of four is historical. |
| 4B | IMPLEMENTED; TESTED; **APPROVED BY USER (2026-11-19)** | Owner-scoped session/message persistence in `src/services/session.service.ts`, `src/services/diagnosis.service.ts`, and `tests/db/diagnosis.integration.test.ts`. Confirm/complete were 501 during this phase and are now implemented. |
| 5 | IMPLEMENTED; TESTED; **not explicitly phase-approved** | `src/services/knowledge.service.ts`, `tests/services/knowledge.service.test.ts`, `tests/services/repair-resolution.test.ts`, and the approved DB fixture in `tests/db/diagnosis.integration.test.ts`. Approval/scope/safety and manufacturer-code handling are present. |
| 6 | IMPLEMENTED; TESTED; **not explicitly phase-approved** | `src/services/groq.service.ts`, `src/services/ai/{orchestrator,prompt,tool-definitions}.ts`, `src/validators/ai.validator.ts`, `tests/services/{groq.service,ai-tool-schema,orchestrator}.test.ts`. The planned file layout differs: `src/services/ai.service.ts` is still empty and there is no `agentOutcome.ts` or `ai/tools/` directory. No live-provider validation is claimed. |
| 7 | IMPLEMENTED; TESTED; **not explicitly phase-approved** | `src/services/ai/orchestrator.ts`, `src/services/diagnosis.service.ts`, all seven live diagnosis routes, `tests/services/diagnosis.service.test.ts`, and DB confirm/complete tests. Backend overrides, challenges, idempotency, and provider-outside-transaction flow are present. |
| 8 | PARTIALLY IMPLEMENTED; TESTED with mocks; **not explicitly phase-approved** | `src/services/parts.service.ts` and `tests/services/parts.service.test.ts` implement `none` default, opt-in `groq_browser`, host/HTTPS allowlists, and backend compatibility. Live `groq_browser`, install-safety classification, and the planned provider factory are absent or UNVERIFIED. |
| 9 | PARTIALLY IMPLEMENTED; hardening/docs TESTED; **not explicitly phase-approved** | `src/middleware/rateLimit.ts`, CORS allowlist, docs opt-in, DTO allowlists, redacted AI diagnostics, `src/docs/openapi.ts`, and contract tests exist. SSE/streaming is ABSENT (`createChatCompletion` rejects it); D7 remains open. |

The stale statements “Phases 5–9 NOT STARTED”, “confirm/complete return 501”, “rate limiting
deferred”, and the 56/27 phase-era test counts in older records are preserved as historical
snapshots but are superseded by this table and the tracker at the top of the roadmap. The
current DB-free suite is 171/171 in 12 files; DB integration is recorded as 32/32 in 3 files
but was not rerun for the latest forced-tool fallback change.

### Complete approved implementation checklist (Phases 1–9)

The following checklist is the original approved plan and is not rewritten by the audit.
Deviations, later implementation details, and current status are recorded separately above.

#### Phase 1 — Schema & migration foundation (verdict + pending confirmation)
- **Objective and expected outcome:** Align persistence with approved verdict system and deterministic `FIXED` confirmation. Schema/migration prepared (and applied only with explicit approval) so `Verdict` becomes `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED` and `DiagnosisSession` persists server-controlled pending confirmation state. Prisma Client regenerated; typecheck passes; no runtime behavior change.
- **Scope:** schema enum update, additive pending-confirmation fields, migration artifact review/generation, optional apply only if explicitly approved, client regeneration.
- **Files/modules to create or modify:** Modify `prisma/schema.prisma`; create `prisma/migrations/<timestamp>_<name>/migration.sql` (on approval to generate); regenerate gitignored `src/generated/prisma/**`; minimal type-only touchpoints only if required by typecheck.
- **Dependencies on previous phases:** None (baseline). Requires **D1** resolved before apply.
- **Database/schema impact:** **Yes (migration).** `Verdict` enum replace/map `CALL_TECHNICIAN`→`TECHNICIAN_REQUIRED`, add `UNRESOLVED`; additive nullable/server-managed pending-confirmation fields on `DiagnosisSession`. No ad-hoc appliance snapshot fields; no other models.
- **Tests and acceptance criteria:** `npx prisma validate` passes; migration SQL reviewed and mapping safe/explicit; apply only with explicit approval; `npx prisma generate` and `npm run typecheck` pass; schema diff limited to approved changes; routes/behavior unchanged.

#### Phase 2 — Environment, dependencies, and test harness foundation
- **Objective and expected outcome:** Validated Groq/parts/diagnosis config with hard prod guard (unreviewed impossible in production), required deps installed, and working test runner scaffold for subsequent phases.
- **Scope:** env validation/docs, `groq-sdk` + agreed test deps/scripts, minimal test config/setup (no feature tests beyond smoke if useful).
- **Files/modules to create or modify:** Modify `package.json` (+ lockfile), `src/config/env.ts`, `.env.example`; create `vitest.config.ts` (or equivalent) and minimal test setup/helpers if D2 approved; `tsconfig.json` only if required.
- **Dependencies on previous phases:** Phase 1 complete before feature code relying on new fields (sequencing per approval). Decisions **D2, D3** (D8 noted).
- **Database/schema impact:** None.
- **Tests and acceptance criteria:** install succeeds; `npm run typecheck` passes; env validation guards (esp. no unreviewed-in-prod) verified and reported; `npm test` runs suite successfully; no API behavior change beyond startup config validation.

#### Phase 3 — Diagnosis validators, middleware helpers, and route/controller scaffolding (no AI/DB behavior yet)
- **Objective and expected outcome:** Reachable, authenticated, validated diagnosis HTTP scaffolding with correct envelope/error flow and explicit non-hanging placeholder behavior; no business logic/AI/knowledge.
- **Scope:** Zod validators, param/query helpers, mount routes, thin controllers delegating to explicit stubs/placeholders.
- **Files/modules to create or modify:** Create `src/validators/diagnosis.validator.ts`; modify `src/middleware/validate.ts` (if needed), `src/routes/diagnosis.routes.ts`, `src/controllers/diagnosis.controller.ts`, `src/services/diagnosis.service.ts`, `src/services/session.service.ts` (stubs/501 as needed), `src/app.ts` (mount `/diagnosis`; CORS only if D8 approved).
- **Dependencies on previous phases:** Phases 1–2. Decisions **D4, D5, D8**.
- **Database/schema impact:** None.
- **Tests and acceptance criteria:** `npm run typecheck`/`npm test` pass; unauth→401, invalid input→400 `VALIDATION_ERROR`, unknown routes→404, scaffold endpoints return explicit placeholder (not hang); no DB/LLM/external calls.

#### Phase 4 — Session & message persistence core (ownership, lifecycle primitives)
- **Objective and expected outcome:** Ownership-scoped session/message CRUD, pagination, MVP `applianceId` (owned `Appliance`) requirement, guarded status/verdict/pending-confirmation primitives and transition helpers (no AI/knowledge/tools, no diagnosis turn generation).
- **Scope:** session service implementation, diagnosis service CRUD/state delegation, wired endpoints/responses, tests.
- **Files/modules to create or modify:** Modify `src/services/session.service.ts`, `src/services/diagnosis.service.ts`, `src/controllers/diagnosis.controller.ts`, `src/routes/diagnosis.routes.ts`, `src/validators/diagnosis.validator.ts`; create/modify session-related tests.
- **Dependencies on previous phases:** Phases 1–3. Decisions **D4, D5**.
- **Database/schema impact:** Runtime reads/writes only (uses Phase 1 fields); no new migration.
- **Tests and acceptance criteria:** typecheck/tests pass with reported results; auth/ownership/appliance ownership enforced; pagination/order correct; invalid state combos rejected; terminal guards; pending-confirmation mutated only via guarded primitives; correct envelopes/codes.

#### Phase 5 — Knowledge service with safety, scope, and environment policy
- **Objective and expected outcome:** Sole KB retrieval for diagnosis enforcing env gating/labeling, approval/link/`USER_SAFE` invariants, no partial sequences, scope enforcement, bounded provenance DTOs (no AI loop).
- **Scope:** `searchErrorCodes`/`getRepairSteps` (and helpers), policy-aware filtering/eligibility reasons.
- **Files/modules to create or modify:** Modify `src/services/knowledge.service.ts`; minimal shared types/helpers if needed; create/modify knowledge tests.
- **Dependencies on previous phases:** Phases 1–2.
- **Database/schema impact:** Read-only; no migration.
- **Tests and acceptance criteria:** typecheck/tests pass; prod excludes `UNREVIEWED` always; dev unreviewed only env-gated+flagged; scope enforced; eligibility/invariant enforced (no partial/unsafe sequences, no DIY `TECHNICIAN_ONLY`, no electrical/gas/sealed-refrigerant bypass); structured ineligible reasons.

#### Phase 6 — AI adapter, structured outcome contract, and simplified tool registry (no verdict mutation)
- **Objective and expected outcome:** Groq adapter with bounded loop, injected trusted context, Zod-validated structured outcome, simplified tools (`search_error_codes`, `get_repair_steps`; `find_replacement_parts` stub/none), clarification/escalation as outcomes — no verdict/status mutation from model.
- **Scope:** AI service, outcome contract, tool registry/implementations, sanitized events, mocked-provider tests.
- **Files/modules to create or modify:** Modify `src/services/ai.service.ts`; create `src/services/ai/agentOutcome.ts`, `src/services/ai/tools/{index,searchErrorCodes.tool,getRepairSteps.tool,findReplacementParts.tool}.ts`, optional `llm.types.ts`; create/modify AI/tool tests.
- **Dependencies on previous phases:** Phases 2, 4, 5. Decision **D3**.
- **Database/schema impact:** Read-only via services; no migration.
- **Tests and acceptance criteria:** typecheck/tests pass; allowlist/arg-result/bounds enforced; trusted context injected; outcome schema-validated; clarification/escalation not tools; errors sanitized; no session state mutation.

#### Phase 7 — Diagnosis orchestration, backend validation/overrides, verdict lifecycle, and message turns (JSON)
- **Objective and expected outcome:** End-to-end JSON diagnosis turns with backend-validated effective outcomes, deterministic safety/evidence/confirmation enforcement, guarded transitions (`NEEDS_CLARIFICATION` OPEN/null, `OPEN+NEEDS_PART`, completion per D5, `FIXED` via pending challenge per D4), persisted messages, correct responses/events.
- **Scope:** orchestration/validation engine, confirmation handling, send/confirm/ack endpoints, transactional persistence, integration tests (AI/parts mocked).
- **Files/modules to create or modify:** Modify `src/services/diagnosis.service.ts`, `src/services/session.service.ts`, `src/controllers/diagnosis.controller.ts`, `src/routes/diagnosis.routes.ts`, `src/validators/diagnosis.validator.ts`, AI/tool hooks as needed; create/modify diagnosis/integration tests.
- **Dependencies on previous phases:** Phases 1–6. Decisions **D4, D5** finalized.
- **Database/schema impact:** Runtime reads/writes (messages/session state/pending confirmation/linkage); no new migration.
- **Tests and acceptance criteria:** typecheck/tests pass; all required cases proven (deterministic `FIXED` confirmation, `NEEDS_PART` evidence rules & lifecycle, clarification/UNRESOLVED/TECHNICIAN_REQUIRED distinction, safety/knowledge invariants, no partial sequences, invalid/unsupported outcomes cannot mutate state, auth/ownership/envelope).

#### Phase 8 — Parts search provider & authorized `find_replacement_parts`
- **Objective and expected outcome:** Replaceable backend-authorized parts discovery with `none` default (+ selected provider if D6), normalized ephemeral results (`VERIFIED|POSSIBLE_MATCH|UNKNOWN` + install-safety), no persistence.
- **Scope:** provider interface/factory/implementations, authorization gate, tool/orchestration wiring, tests.
- **Files/modules to create or modify:** Create `src/services/parts/{parts-search.provider.ts,parts-search.service.ts,providers/none.provider.ts,providers/<selected>.provider.ts}` (if any); modify `src/services/ai/tools/findReplacementParts.tool.ts`, `src/services/diagnosis.service.ts`, config/docs for provider vars; create/modify parts/diagnosis tests.
- **Dependencies on previous phases:** Phases 2, 6, 7. Decision **D6**.
- **Database/schema impact:** None (ephemeral); no migration.
- **Tests and acceptance criteria:** typecheck/tests pass; blocked without validated evidence/context; no unverified compatibility claims; correct UNKNOWN/POSSIBLE_MATCH; part-needed vs install-requires-technician handled; safe provider failure handling; no persistence.

#### Phase 9 — Streaming/events (optional, JSON-parity) and hardening/docs
- **Objective and expected outcome:** Optional SSE streaming with sanitized events/JSON parity (per D7), agreed hardening (CORS/rate limiting per D8), and docs/OpenAPI aligned to implementation.
- **Scope:** streaming path/helpers, hardening middleware/config, documentation updates, tests.
- **Files/modules to create or modify:** Create/modify `src/utils/sse.ts` (if needed), `src/controllers/diagnosis.controller.ts`, `src/services/ai.service.ts`, `src/services/diagnosis.service.ts`, `src/app.ts` (as approved); modify `CONTEXT.md` and `src/docs/**`; create/modify streaming/hardening tests.
- **Dependencies on previous phases:** Phase 7 (and 8 if parts included). Decisions **D7, D8**.
- **Database/schema impact:** None.
- **Tests and acceptance criteria:** typecheck/tests pass; if streaming: ordered/sanitized events, parity with JSON, safe abort/fallback; hardening verified per scope; docs consistent.

### Phase execution log (append per phase; do not pre-fill approvals)

| Phase | Status | Files changed | Schema/migration | Commands & results | Tests (pass/fail/not run) | Issues/deviations | Decisions needed | Explicit user approval |
|---|---|---|---|---|---|---|---|---|
| 1 | APPROVED BY USER (2026-11-16); migration applied and verified on development | `prisma/schema.prisma`; `prisma/migrations/20261116093023_verdict_pending_confirmation/migration.sql`; `CONTEXT.md`; `database_design/DATABASE_DESIGN.md`; regenerated gitignored `src/generated/prisma/**` | `Verdict` → FIXED/NEEDS_PART/TECHNICIAN_REQUIRED/UNRESOLVED; added nullable `fixConfirmationChallengeId`, `fixConfirmationIssuedAt`, `fixConfirmationExpiresAt`; migration generated, reviewed, then applied to the development branch | Preflight read-only DB; `prisma validate` pass; `prisma migrate diff` SQL reviewed; `prisma generate` pass; `tsc --noEmit` pass; `prisma migrate deploy` applied the pending migration; post-apply DB verification pass; `prisma migrate status` reports schema up to date; final `prisma validate` + `tsc --noEmit` pass | Migration executed successfully; post-apply enum/columns/migration-record checks passed; no automated test runner exists | `migrate dev --create-only` is non-interactive-unsupported; used read-only `migrate diff` + hand-created migration dir, then `migrate deploy`. No drift detected; no production access; no seed run. | D1 resolved | Yes — Phase 1 approved by user 2026-11-16 |
| 2 | APPROVED BY USER (2026-11-17); implemented and tested 2026-11-16 | `src/config/env.schema.ts` (new); `src/config/env.ts`; `src/server.ts`; `.env.example`; `.gitignore`; `package.json`; `package-lock.json`; `vitest.config.ts` (new); `tsconfig.test.json` (new); `tests/setup-env.ts`, `tests/config/env.test.ts`, `tests/http/app.test.ts`, `tests/dependencies/groq-sdk.test.ts` (new); `CONTEXT.md` | None | `npm install groq-sdk@^1.6.0`; `npm install -D vitest@^5.1.0 vite@^8.3.8 supertest@^7.3.2 @types/supertest@^7.2.1`; `npm run typecheck` pass; `npm run typecheck:test` pass; `npm test` 14/14 pass; `npm run build` pass; `npx prisma validate` pass; production-guard commands exit 1 as expected; development env load exits 0; protected file hashes unchanged; lockfile has 0 missing pre-existing package keys | 3 files / 14 tests pass (independently re-run and verified by the user on 2026-11-17); no DB, network, or AI calls | No DB access; no schema/migration/seed/app/diagnosis/Swagger changes; `GROQ_TIMEOUT_MS`, `GROQ_MAX_RETRIES`, `GROQ_MAX_TOOL_ROUNDS`, `FIX_CONFIRMATION_TTL_SECONDS`, and `PARTS_PROVIDER` deferred | D2, D3 resolved; D9, D10 resolved | Yes — Phase 2 approved by user 2026-11-17; user independently ran and verified `npm test` (14 tests / 3 files), `npm run typecheck`, `npm run typecheck:test`, `npm run build`, and `npx prisma validate` (all passed) |
| 3 | APPROVED BY USER (2026-11-17) | Created `src/validators/diagnosis.validator.ts`, `src/middleware/cors.ts`, `tests/http/diagnosis.routes.test.ts`; modified `src/app.ts`, `src/middleware/validate.ts`, `src/types/express.d.ts`, `src/routes/diagnosis.routes.ts`, `src/controllers/diagnosis.controller.ts`, `src/services/diagnosis.service.ts`, `src/services/session.service.ts`, `CONTEXT.md` | None | `npm run typecheck` pass; `npm run typecheck:test` pass; `npm test` 37/37 in 4 files; `npm run build` pass; `git status` on branch `feat/backend-setup`; Swagger file hashes unchanged | 37 tests pass across 4 files (23 new); no DB/network/AI calls | D4/D5/D8 resolved for contract/CORS; no schema, migration, seed, Prisma/Groq imports, verdict mutation or persistence; remaining non-blocking issues recorded below (permissive CORS, malformed-JSON 500, minor test gaps, stale Swagger docs); documented Swagger work was already committed at Phase 3 start | D4, D5, D8 resolved | Yes — Phase 3 explicitly approved by user 2026-11-17 after final read-only review |
| 4A | APPROVED BY USER (2026-11-17) | Created `.env.test.example`, `vitest.db.config.ts`, `tests/db/setup-db-env.ts`, `tests/db/helpers.ts`, `tests/db/guards.test.ts`, `tests/db/smoke.test.ts`; modified `.gitignore`, `vitest.config.ts`, `tsconfig.test.json`, `package.json`, `CONTEXT.md` | No repo schema/migration change; 4 existing migrations deployed to `fixit-test` only, plus an idempotent sentinel table outside Prisma migrations | credential-free `.env.test` verification; `prisma migrate deploy` (4 applied); `prisma migrate status` up to date; PG 18.7 confirmed; enum/columns/empty tables/sentinel verified; `npm test` 37/37; `npm run test:db` 15/15; typecheck, test-typecheck, build pass; negative guard runs exit 1 | 37 DB-free + 15 DB tests pass; production/opt-out/dev-host runs fail closed before connecting | Extra `smoke.test.ts`; `vitest.config.ts` excludes `tests/db`; Prisma 7 uses `finished_at`/`rolled_back_at`; temporary provisioning script removed; non-blocking pg SSL warning | D9 resolved by separate project | Yes — Phase 4A explicitly approved by user 2026-11-17 after confirming the `fixit-test` tables were created |
| 4B | APPROVED BY USER (2026-11-19); IMPLEMENTED; TESTS PASSED | Created `src/types/diagnosis.dto.ts`, `tests/db/diagnosis.integration.test.ts`, `tests/docs/openapi.contract.test.ts`; modified `src/services/session.service.ts`, `src/services/diagnosis.service.ts`, `src/docs/openapi.ts`, `tests/http/diagnosis.routes.test.ts`, `tests/db/helpers.ts`, `CONTEXT.md` | None (no schema/migration/seed change; `Appliance.modelNumber` already nullable) | `npm test` 56/56 (DB-free); `npm run test:db` 27/27 on `fixit-test` twice; `npm run typecheck`, `npm run typecheck:test`, `npm run build`, `npx prisma validate` pass; `git status --short --branch` checked | 56 DB-free + 27 DB tests pass; first DB run blocked by transient DNS failure, resolved on retry, two full passing runs after; no dev/prod access | Initial DB run hit transient `ENOTFOUND` for the allowlisted `fixit-test` hosts; no code change was needed. No staging or commit. | — | Yes — Phase 4B explicitly approved by user 2026-11-19 |
| 5 | IMPLEMENTED; TESTED; no explicit phase approval recorded | `src/services/knowledge.service.ts`; `src/validators/ai.validator.ts`; `tests/services/knowledge.service.test.ts`; `tests/services/repair-resolution.test.ts`; approved fixture in `tests/db/diagnosis.integration.test.ts` | None | 2026-11-19 audit: `npm test` 171/171; typechecks/build pass; DB suite previously 32/32 | Unit tests and DB fixture tests pass; no live production knowledge test | Planned Phase 5 file layout differs slightly; implementation preserves approval/scope/safety rules | — | No |
| 6 | IMPLEMENTED; TESTED; no explicit phase approval recorded | `src/services/groq.service.ts`; `src/services/ai/{orchestrator,prompt,tool-definitions}.ts`; `src/validators/ai.validator.ts`; `src/utils/{aiErrors,aiDiagnostics}.ts`; related service tests | None | 2026-11-19 audit: `npm test` 171/171; typechecks/build pass | Mocked tests pass; no live-provider test | `ai.service.ts` remains empty; no `agentOutcome.ts`/`ai/tools/` directory; no SSE event stream | D3 (current default `openai/gpt-oss-20b`) | No |
| 7 | IMPLEMENTED; TESTED; no explicit phase approval recorded | `src/services/diagnosis.service.ts`; `src/services/ai/orchestrator.ts`; `src/routes/diagnosis.routes.ts`; `tests/services/{orchestrator,diagnosis.service}.test.ts`; DB confirm/complete tests | Runtime use of existing AI metadata migration; no new migration in this audit | 2026-11-19 audit: `npm test` 171/171; typechecks/build pass; DB suite previously 32/32 | Idempotency, safety overrides, challenges, confirm/complete, and provider-outside-transaction tests pass | Forced-tool fallback is narrowly mocked; live activation not proven | D4, D5 | No |
| 8 | PARTIALLY IMPLEMENTED; no explicit phase approval recorded | `src/services/parts.service.ts`; `src/config/env.schema.ts`; `tests/services/parts.service.test.ts`; `README.md` | None | 2026-11-19 audit: `npm test` 171/171; typechecks/build pass | Mocked tests pass; live discovery not run | `PARTS_PROVIDER=none` default; `groq_browser` UNVERIFIED; install-safety field and factory layout absent | D6 operational enablement still open | No |
| 9 | PARTIALLY IMPLEMENTED; hardening/docs TESTED; no explicit phase approval recorded | `src/middleware/{cors,rateLimit}.ts`; `src/utils/aiDiagnostics.ts`; `src/docs/openapi.ts`; `tests/docs/openapi.contract.test.ts`; `tests/http/app.test.ts` | None | 2026-11-19 audit: `npm test` 171/171; typechecks/build pass | CORS, rate-limit, and docs contract tests pass; SSE not tested because absent | JSON-only; streaming explicitly rejected; in-memory limiter is single-process | D7 open; D8 later extended beyond minimal Phase 3 CORS | No |

All phase implementation records below are historical snapshots of what was true when each
phase was completed and approved. Current status is recorded in the persistent tracker, the
2026-11-19 audit correction, and section 12; later implementation may have superseded temporary
stubs, deferred settings, and phase-era test counts without changing those historical approvals.

### Phase 1 implementation & application record (2026-11-16)

**Generated migration:** `prisma/migrations/20261116093023_verdict_pending_confirmation/migration.sql`

```sql
-- AlterEnum
-- Rename the existing value in place so any existing CALL_TECHNICIAN verdicts are
-- preserved as TECHNICIAN_REQUIRED. Recreating the enum type would fail on those
-- rows (or require a lossy default), so the rename is the safe mapping.
BEGIN;
ALTER TYPE "Verdict" RENAME VALUE 'CALL_TECHNICIAN' TO 'TECHNICIAN_REQUIRED';
ALTER TYPE "Verdict" ADD VALUE 'UNRESOLVED';
COMMIT;

-- AlterTable
ALTER TABLE "DiagnosisSession" ADD COLUMN     "fixConfirmationChallengeId" TEXT,
ADD COLUMN     "fixConfirmationIssuedAt" TIMESTAMP(3),
ADD COLUMN     "fixConfirmationExpiresAt" TIMESTAMP(3);
```

**Commands executed and results:**

- `npx prisma migrate status` — 3 migrations applied, database up to date (preflight).
- Read-only `pg` query — `Verdict = [FIXED, NEEDS_PART, CALL_TECHNICIAN]`; `DiagnosisSession` count `0`; no `fixConfirmation*` columns.
- `npx prisma validate` (after schema edit) — valid.
- `npx prisma migrate dev --create-only --name verdict_pending_confirmation` — **not run to completion**: Prisma Migrate rejects non-interactive environments. No migration was created or applied by this command.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` — read-only; produced the enum recreation plus three additive columns. The enum recreation was replaced with the safe in-place rename above.
- `npx prisma generate` — client regenerated to `src/generated/prisma` with the four-value enum and the three fields.
- `npm run typecheck` — passed.
- `npx prisma migrate status` (after generation, before application) — 4 migrations found; `20261116093023_verdict_pending_confirmation` reported as **not yet applied** at that stage.
- Post-check read-only `pg` query — live DB still has the old enum and no `fixConfirmation*` columns; session count still `0`.

**Deviations/issues:** `migrate dev --create-only` could not run non-interactively, so the migration was generated from the read-only `migrate diff` output and written manually. No drift was detected. Swagger/OpenAPI uncommitted work was preserved untouched.

**Migration application and verification (after explicit authorization):**

- Verified both `DIRECT_URL` and `DATABASE_URL` hostnames still belong to the expected development branch (`ep-shy-glade-a1uvm947`); credentials were not printed.
- `npx prisma migrate deploy` — applied `20261116093023_verdict_pending_confirmation` successfully; no other migrations were pending.
- Read-only post-apply verification:
  - `Verdict` enum = `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED`.
  - `DiagnosisSession` columns: `fixConfirmationChallengeId` (`text`, nullable), `fixConfirmationIssuedAt` (`timestamp`, nullable), `fixConfirmationExpiresAt` (`timestamp`, nullable); no defaults.
  - `_prisma_migrations` row for the migration: `finished = true`, `rolled_back = false`, `applied_steps_count = 1`.
  - Unrelated data unchanged: 15 `KnowledgeSource`, 77 `ErrorCode`, 117 `RepairStep`, 188 `ErrorCodeRepairStep` links, 0 `DiagnosisSession` rows.
- `npx prisma migrate status` — 4 migrations found, “Database schema is up to date!”
- `npx prisma validate` — valid.
- `npm run typecheck` — passed.
- No seed was run and no production database was accessed.

**User approval:** Phase 1 was explicitly approved by the user on 2026-11-16, after review of the implementation, migration SQL, and development-database verification results.

### Phase 2 implementation & approval record (implemented 2026-11-16; approved 2026-11-17)

**Status:** IMPLEMENTED; TESTS PASSED; **APPROVED BY USER (2026-11-17)**. Phase 3 was not
started; nothing was staged or committed.

**Authorized scope and corrections:** environment, dependencies, configuration, and test
harness only. The user approved D2 (Vitest 5 + Vite 8 + Supertest 7), D3
(`openai/gpt-oss-120b` default), a required `NODE_ENV`, no database access during Phase 2,
a dedicated Neon test branch before Phase 4, `GROQ_API_KEY` optional in development/test
and required in production, and no staging/commit. Phase 2 environment additions were kept
minimal to `GROQ_API_KEY`, `GROQ_MODEL`, and `ALLOW_UNREVIEWED_KNOWLEDGE`;
`GROQ_TIMEOUT_MS`, `GROQ_MAX_RETRIES`, `GROQ_MAX_TOOL_ROUNDS`,
`FIX_CONFIRMATION_TTL_SECONDS`, and `PARTS_PROVIDER` were deferred. D10 option C (hybrid)
was chosen and recorded above.

**Files created:**
- `src/config/env.schema.ts`
- `vitest.config.ts`
- `tsconfig.test.json`
- `tests/setup-env.ts`
- `tests/config/env.test.ts`
- `tests/http/app.test.ts`
- `tests/dependencies/groq-sdk.test.ts`

**Files modified:**
- `package.json`, `package-lock.json` (additive dependency/script changes; Swagger entries preserved)
- `src/config/env.ts`
- `src/server.ts` (imports `env` before `app`)
- `.env.example`
- `.gitignore` (`.vitest/`)
- `CONTEXT.md`

**Not changed:** `src/app.ts`, `src/routes/auth.routes.ts`, `src/docs/**`, `prisma/**`,
`prisma.config.ts`, `database_design/**`, `.env`, all diagnosis controllers/routes/services,
and all database records.

**Commands executed and results:**
- `npm install groq-sdk@^1.6.0` — added 1 package, 0 vulnerabilities.
- `npm install -D vitest@^5.1.0 vite@^8.3.8 supertest@^7.3.2 @types/supertest@^7.2.1` — added 59 packages, 0 vulnerabilities.
- `npm run typecheck` — passed.
- `npm run typecheck:test` — passed.
- `npm test` (`vitest run`) — **14 tests passed in 3 files**.
- `npm run build` — passed; `dist/` contains no test files.
- `npx prisma validate` — schema valid.
- Production guard check without `GROQ_API_KEY` — process exited `1` with
  `GROQ_API_KEY: GROQ_API_KEY is required in production`.
- Production guard check with `ALLOW_UNREVIEWED_KNOWLEDGE=true` — process exited `1` with
  `ALLOW_UNREVIEWED_KNOWLEDGE: ALLOW_UNREVIEWED_KNOWLEDGE cannot be enabled in production`.
- Development configuration load from the existing `.env` — exited `0`.

**Independent user verification (2026-11-17):** the user independently ran and verified:
- `npm test` — 14 tests passed across 3 files.
- `npm run typecheck` — passed.
- `npm run typecheck:test` — passed.
- `npm run build` — passed.
- `npx prisma validate` — passed.

**Test coverage:** environment defaults, required `NODE_ENV`, `PORT` default/validation,
`GROQ_MODEL` validation, production Groq-key requirement, empty-key handling, production
rejection of unreviewed knowledge, boolean parsing, HTTP 404/400/401 envelopes, and Groq
SDK ESM import/construction with a dummy key. The Groq test makes **no API request** and
does not imply network connectivity was tested. `tests/setup-env.ts` checks the inherited
`NODE_ENV` first, throws if it is `production`, and otherwise sets `NODE_ENV=test` plus
dummy credentials before application modules are imported.

**Protected work verification:** `src/app.ts`, `src/routes/auth.routes.ts`,
`src/docs/openapi.ts`, and `src/docs/swagger.ts` remained byte-identical to the hashes
recorded before implementation. `package.json` retains `swagger-ui-express` and
`@types/swagger-ui-express`; the new lockfile retains those package entries, and a
package-key comparison against the previous committed lockfile found **0** missing
pre-existing package keys. The lockfile also contains npm re-resolution changes; no
pre-existing dependency was removed.

**Issues/deviations:** none beyond the npm lockfile re-resolution noted above. No database
connection, network request, Groq API call, seed run, migration, or production access
occurred. Swagger/OpenAPI files were preserved untouched.

**Production knowledge-promotion requirement (recorded):** the approved knowledge updates
were applied to the **development** Neon database only. They do **not** automatically exist
in production. A controlled promotion process is required before launch, with verification
that the same approved records, review statuses, model scopes, safety classifications, and
complete sequences exist in production.

**Audit scope note (recorded):** the earlier audit identified exactly **one** complete
production-returnable sequence in the audited development dataset (LG `WASHING_MACHINE`
`FE`, `TOP_LOAD`, `01a1d97f-b545-736b-a307-5d55dbf9c829`). This is a finding about the
development dataset only. **Production Neon was not inspected or updated.**

**User approval:** Yes — Phase 2 was explicitly approved by the user on 2026-11-17 after
independently running and verifying the commands listed above.

### Phase 3 implementation record (2026-11-17)

**Status:** IMPLEMENTED; TESTS PASSED; **APPROVED BY USER (2026-11-17)**. The user explicitly
authorized Phase 3 only, set the final contract decisions below, and approved the completed
phase after the final read-only review. Nothing was staged or committed.

**Authorized decisions:**
- D4: `POST /diagnosis/:id/confirm` with `{ challengeId }`; the challenge must eventually be
  server-issued and validated against persisted state. No client-provided verdict.
- D5: `POST /diagnosis/:id/complete` with `{ acknowledged: true }`.
- D8: minimal CORS for frontend integration; rate limiting deferred.
- Seven endpoints under `/diagnosis`; pagination `page=1`, `limit=20`, max 100; valid scaffold
  requests return `501 NOT_IMPLEMENTED`, never fake success or hang.
- `applianceId` required on create plus at least one of `symptom`/`errorCode`; no model number
  is required in the request, so older appliances without a known model number are supported.
- Session operations stay in `session.service.ts`; diagnosis/message/confirmation/completion
  operations stay in `diagnosis.service.ts`; stubs throw `HttpError(501, 'NOT_IMPLEMENTED', ...)`.
- Auth runs before validation; query parsing uses `req.validatedQuery`; existing envelopes and
  validation behaviour preserved; tests cover auth, validation, pagination, 501 and 404.
- No DB access, Prisma imports in new services, Groq calls, knowledge retrieval, verdict
  mutation, persistence, schema/migration/seed changes, staging or committing.
- `src/docs/**` untouched until Phase 9.

**Files created:**
- `src/validators/diagnosis.validator.ts`
- `src/middleware/cors.ts`
- `tests/http/diagnosis.routes.test.ts`

**Files modified:**
- `src/app.ts` (added CORS middleware, diagnosis import and `/diagnosis` mount only)
- `src/middleware/validate.ts` (shared validation-error helper; `validateParams`, `validateQuery`)
- `src/types/express.d.ts` (`req.validatedQuery?: unknown`)
- `src/routes/diagnosis.routes.ts` (seven routes with auth-first middleware chains)
- `src/controllers/diagnosis.controller.ts` (thin handlers, owner id from `req.user`)
- `src/services/diagnosis.service.ts`, `src/services/session.service.ts` (501 stubs)
- `CONTEXT.md`

**Commands executed and results (from `fixit-backend/`):**
- `npm run typecheck` — passed.
- `npm run typecheck:test` — passed.
- `npm test` — **37 tests passed in 4 files** (23 new diagnosis tests).
- `npm run build` — passed.
- `git status --porcelain=v1` / `git branch --show-current` — branch `feat/backend-setup`;
  only the Phase 3 files above are modified/untracked; no staging or commits.
- `git hash-object src/docs/openapi.ts src/docs/swagger.ts` before and after — unchanged
  (`5b01e0dc…`, `7a1d31f3…`).

**Test coverage:** missing/invalid bearer token → 401; auth before body validation; invalid
body, missing applianceId, missing symptom/errorCode, malformed IDs → 400 `VALIDATION_ERROR`;
pagination `page=0`, `limit=101`, non-numeric limit → 400; empty message, missing challengeId,
`acknowledged:false` → 400; all seven valid routes → 501 `NOT_IMPLEMENTED` with the exact
error envelope; unknown nested route → 404 `NOT_FOUND`; CORS Origin reflection and 204 preflight.
No test opens a database connection or makes a network/Groq call.

**Issues/deviations:**
- Earlier notes described the Swagger work as uncommitted; at Phase 3 start the tree was clean
  and `src/docs/**` was present in commit `15ccfeb`. It was preserved byte-identical.
- No environment variables, dependencies, Prisma schema/migrations/seeds or database records
  were changed. No production access.

**Remaining non-blocking issues (recorded at final read-only review):**
- Permissive CORS: `corsMiddleware` reflects any request `Origin`. No `Access-Control-Allow-Credentials`
  header is set, which is correct for Bearer-token auth, but a strict allowlist is deferred to
  Phase 9 hardening. Rate limiting was also deferred.
- Malformed JSON bodies currently return `500 INTERNAL_ERROR` instead of `400`. The central
  `errorHandler` maps every non-`HttpError` to 500 and does not inspect body-parser's `status`.
  This is pre-existing (it also affects `/auth/*`), was not introduced or changed in Phase 3,
  and should be tracked for a later fix/Phase 9 hardening.
- Minor test coverage gaps: missing-auth is asserted for `POST /diagnosis` but not individually
  for all seven routes; absence of `Access-Control-Allow-Credentials` is not explicitly asserted;
  accepted pagination boundaries (`limit=100`, `limit=1`, `page=1`) are not tested; trimming and
  max-length boundaries for `symptom`/`errorCode` are not tested; expired/wrong-signature JWTs
  and malformed JSON bodies are not covered. None of these block Phase 4.
- Swagger diagnosis documentation remains stale: `src/docs/openapi.ts` still describes `/diagnosis`
  as “NOT MOUNTED” / deprecated. It was deliberately left untouched per the approved decision;
  alignment with the live routes is deferred to Phase 9.

**User approval:** Yes — Phase 3 was explicitly approved by the user on 2026-11-17 after the
final read-only review. Phase 4 was not started.

### Phase 4A implementation record (2026-11-17) — approved by user

**Status:** IMPLEMENTED; TESTS PASSED; **APPROVED BY USER (2026-11-17)**. The user authorized Phase 4A
only. Phase 4B was not started; nothing was staged or committed.

**Authorized scope:** environment separation, a separate fail-closed database test runner,
one-time provisioning of `fixit-test` with `prisma migrate deploy`, a test-database sentinel,
and documentation. No diagnosis/session service, controller, route, validator, Prisma schema,
existing migration, or seed logic was touched.

**Database topology (D9 resolved):** `fixit-development-preserved` is the primary development
Neon project; its current direct host is
`ep-winter-credit-ao2gv7ym.c-2.ap-southeast-1.aws.neon.tech`. The older
`ep-shy-glade-a1uvm947` host belongs to the original development project, not the preserved
one. `fixit-test` is an entirely separate Neon project (PostgreSQL 18.7) with direct host
`ep-withered-mode-aoa83pzz.c-2.ap-southeast-1.aws.neon.tech` and pooled host
`ep-withered-mode-aoa83pzz-pooler.c-2.ap-southeast-1.aws.neon.tech`. These two hosts are the
exact allowlist; every other host is rejected. Production was never contacted.

**Files created:**
- `.env.test.example` (placeholders only: `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `RUN_DB_TESTS=0`)
- `vitest.db.config.ts`
- `tests/db/setup-db-env.ts` (pure `assertDbTestEnv` plus opt-in/host guard)
- `tests/db/helpers.ts`
- `tests/db/guards.test.ts`
- `tests/db/smoke.test.ts` (additional to the minimum list: read-only schema checks)

**Files modified:**
- `.gitignore` — preserved the pre-existing `.env.test` line; added `!.env.test.example`
- `vitest.config.ts` — `exclude: [...configDefaults.exclude, 'tests/db/**']` so `npm test` stays DB-free
- `tsconfig.test.json` — added `vitest.db.config.ts` to `include`
- `package.json` — added `test:db`
- `CONTEXT.md` — this record and the topology/test-infrastructure updates above

**Not changed:** `.env`, `.env.test`, `.env.example`, `prisma/**`, `prisma.config.ts`,
`src/**` (including all services, controllers, routes, validators, seed, and Swagger docs),
all Phase 1–3 working-tree changes, and all development/production database records.

**Commands executed and results (from `fixit-backend/`):**
- Read-only inspection: `git status --short`, `git log -1 --oneline`, `git branch --show-current`,
  `git diff --numstat`, `git status --porcelain=v1`. Branch `feat/backend-setup`, HEAD `15ccfeb`;
  all Phase 3 changes preserved. No `bun.lock` (npm project).
- `npm run typecheck` — passed (twice, before and after final edits).
- `npm run typecheck:test` — passed (twice).
- `npm test` — **37 tests passed in 4 files**, twice; no database connection or SSL warning.
- `npm run build` — passed.
- Credential-free `.env.test` check: dotenv parse booleans only — hostnames matched the exact
  allowlist, both URLs had the same database name, `RUN_DB_TESTS` present and equal to `1`.
  No connection string, username, password, or file content was printed.
- Temporary provisioning script (created, run, then removed): first two attempts stopped
  before any write (fresh DB has no tables; Windows `spawnSync` could not launch bare `npx`);
  the third applied all four migrations and stopped only on a verification query that used a
  pre-Prisma-7 column name; the fourth re-ran the now-idempotent verification to completion.
- `npx prisma migrate deploy` (with test-only `DIRECT_URL`/`DATABASE_URL` supplied via env) —
  applied `20261113122829_init`, `20261113130000_add_user_auth`,
  `20261114090000_add_refresh_token_family`, and
  `20261116093023_verdict_pending_confirmation`; no seed, no `db push`, no `migrate dev`,
  no reset/drop.
- `RUN_DB_TESTS=1 NODE_ENV=test npm run test:db` — **15 tests passed in 2 files**.
- `NODE_ENV=production RUN_DB_TESTS=1 npm run test:db` — exited 1 at `tests/setup-env.ts`
  before any connection.
- `RUN_DB_TESTS=0 npm run test:db` — exited 1 at `assertDbTestEnv` before any connection.
- `TEST_DATABASE_URL=<development host> RUN_DB_TESTS=1 npm run test:db` — exited 1 at
  `assertDbTestEnv` (host not in allowlist) before any connection.
- `npm run test:db` with the local `.env.test` — passed 15/15 because that file supplies
  `RUN_DB_TESTS=1`; the committed example uses `0`.

**Migration and database verification results (`fixit-test` only):**
- PostgreSQL version reported as **18.7**; Prisma 7.10.1 + `@prisma/adapter-pg` applied all
  four migrations successfully — no compatibility failure.
- Before deploy: 0 finished migrations; application tables absent/empty.
- After deploy: 4 expected migrations finished, none rolled back; `prisma migrate status`
  reported “Database schema is up to date!”.
- `Verdict` enum = `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED`.
- `DiagnosisSession.fixConfirmationChallengeId`, `fixConfirmationIssuedAt`, and
  `fixConfirmationExpiresAt` all exist and are nullable.
- All nine application tables (including knowledge tables) are empty; no seed ran.
- Idempotent sentinel table `_fixit_test_sentinel` created with exactly one
  `fixit-test-phase4a` marker row, then verified.
- Only the `fixit-test` direct endpoint was used for provisioning/verification and its pooled
  endpoint for runtime smoke checks. **Development and production were never contacted.**

**Fail-closed design:** `tests/db/setup-db-env.ts` checks inherited `NODE_ENV` before changing
it, requires `RUN_DB_TESTS=1`, requires both `TEST_*` URLs, parses hostnames with `new URL`,
rejects the current and legacy development hosts and anything not in the exact two-host
allowlist, then overwrites the dummy `DATABASE_URL` from `tests/setup-env.ts`. Error messages
name only variables, never values, hosts, or credentials. `.env` is never auto-loaded by the
DB runner (`envDir: false`), and `.env.test` is loaded only by the guard.

**Issues/deviations:** added `tests/db/smoke.test.ts` beyond the minimum file list; modified
`vitest.config.ts` to exclude `tests/db`; used a temporary provisioning script that was
removed; Prisma 7's migration table uses `finished_at`/`rolled_back_at` rather than the older
`finished`/`rolled_back` columns; a non-blocking `pg` SSL-mode deprecation warning was emitted;
the local `.env.test` already contains `RUN_DB_TESTS=1`. No safety check failed at completion.

**User approval:** Yes — Phase 4A was explicitly approved by the user on 2026-11-17 after the
user confirmed that the tables were successfully created in the isolated `fixit-test` Neon
project. Phase 4B was subsequently authorized separately and is recorded below.

### Phase 4B implementation record (2026-11-17) — approved by user 2026-11-19

**Status:** IMPLEMENTED; TESTS PASSED; **APPROVED BY USER (2026-11-19)**. The user explicitly authorized the
Phase 4B plan (five database-backed APIs, Swagger documentation, integration testing, and the
optional appliance model-number requirement), then explicitly approved the completed result on
2026-11-19.

**Implemented behaviour:**
- `POST /diagnosis` — inside one Prisma transaction: verifies `applianceId` belongs to
  `req.user.id`, creates the session (`OPEN`, `verdict=null`, no `errorCodeId`), and writes one
  initial `USER` message. Returns 201 `SessionDto`. Missing or non-owned appliances both give
  404 `APPLIANCE_NOT_FOUND`. The initial message content is `symptom`, `errorCode`, or both
  newline-separated in validator order; no model number is inferred and no knowledge lookup
  occurs.
- `GET /diagnosis` — owner-scoped page of `SessionDto` (`page=1`, `limit=20`, max 100),
  ordered `createdAt DESC, id DESC`, with `items/page/limit/total/totalPages`.
- `GET /diagnosis/:id` — owner-scoped single `SessionDto`; nonexistent and non-owned ids return
  the identical 404 `SESSION_NOT_FOUND`.
- `GET /diagnosis/:id/messages` — ownership check, then `MessageDto` page ordered
  `createdAt ASC, id ASC`.
- `POST /diagnosis/:id/messages` — ownership check, 409 `SESSION_CLOSED` for non-OPEN sessions,
  then an owner+OPEN conditional `updateMany` inside a transaction before the `Message` insert.
  A concurrent close cannot be overwritten. Returns 201 `MessageDto`.
- `POST /diagnosis/:id/confirm` and `POST /diagnosis/:id/complete` remain 501
  `NOT_IMPLEMENTED`.

**DTO/security:** `src/types/diagnosis.dto.ts` defines explicit `sessionDtoSelect`,
`messageDtoSelect`, `toSessionDto`, `toMessageDto`, `toPaginatedDto`, and their types. Response
queries select only DTO fields; `userId`, `errorCodeId`, `fixConfirmationChallengeId`,
`fixConfirmationIssuedAt`, `fixConfirmationExpiresAt` and user data are never mapped into
responses. Every query derives identity from `req.user.id` and uses owner-scoped `where`
clauses; no client-provided user id is trusted.

**Optional model number:** no schema change was needed — `Appliance.modelNumber` is already
nullable. Null, empty-string and unspecified values are accepted unchanged by session creation
and message persistence, are never invented, and are never treated as a wildcard for
model-specific knowledge (no knowledge retrieval exists in this phase). Integration tests cover
all three cases.

**Files created:**
- `src/types/diagnosis.dto.ts`
- `tests/db/diagnosis.integration.test.ts`
- `tests/docs/openapi.contract.test.ts`

**Files modified:**
- `src/services/session.service.ts`, `src/services/diagnosis.service.ts`
- `src/docs/openapi.ts`
- `tests/http/diagnosis.routes.test.ts`, `tests/db/helpers.ts`
- `CONTEXT.md`

**Not changed:** `prisma/schema.prisma`, migrations, seed logic, `src/app.ts`,
`src/routes/diagnosis.routes.ts`, `src/controllers/diagnosis.controller.ts`,
`src/validators/diagnosis.validator.ts`, `src/docs/swagger.ts`, `package.json`, `.env*`,
frontend files, and any development/production database record. Swagger UI still uses the
existing `swagger-ui-express` dependency at `/docs` with raw JSON at `/docs/openapi.json`;
no duplicate dependency was installed. Try it out and Authorize remain enabled by the existing
UI setup plus the documented `bearerAuth` scheme and per-operation `security`.

**Commands executed and results (from `fixit-backend/`):**
- `npm test` — **56 tests passed in 5 files** (DB-free, includes 20 new OpenAPI contract tests).
- `npm run test:db` — **27 tests passed in 3 files** on `fixit-test` only, on two consecutive
  full runs. Covers creation/initial message, ownership and missing appliance, all
  model-number variants, rollback via a forced mid-transaction failure, listing/pagination/
  ordering, retrieval, message listing/sending, closed-session rejection, a row-lock race
  proving the conditional OPEN gate, and the two remaining 501 stubs.
- `npm run typecheck` — passed. `npm run typecheck:test` — passed. `npm run build` — passed.
  `npx prisma validate` — schema valid.
- `git status --short --branch` — branch `feat/backend-setup`; only the expected Phase 1–4B
  working-tree changes; no staged files and no commits.

**Issues/deviations:** the first `npm run test:db` attempt failed at DNS resolution for the
exact allowlisted `fixit-test` hosts (`ENOTFOUND`), including the pre-existing Phase 4A smoke
tests; no credentials or connection strings were printed. The host resolved on retry and two
subsequent full runs passed 27/27. A temporary credential-free connectivity probe was created
and removed; it is not part of the repository. The non-blocking `pg` SSL-mode deprecation
warning persists. The exact wording of the prior session's approved initial-message mapping was
not present in `CONTEXT.md`; the implementation uses the validator-order mapping documented
above and in the OpenAPI description. No unresolved functional issue remains.

**Scope of this approval update (2026-11-19):** only `CONTEXT.md` was edited to record the
Phase 4B approval. No application code, tests, Prisma schema/migrations, seed, configuration,
or any other file in the codebase was changed. All prior records, decisions, status values,
open work items, and known gaps below are preserved unchanged. Phase 5 was **not** started and
requires separate explicit authorization.

**User approval:** Yes — Phase 4B was explicitly approved by the user on 2026-11-19. It is
IMPLEMENTED; TESTS PASSED; **APPROVED BY USER (2026-11-19)**.

## 12. 2026-11-19 documentation-only audit addendum

### 12.1 Scope and integrity

This addendum records a read-only repository audit and a documentation-only update. **Only
`fixit-backend/CONTEXT.md` was changed by this task.** No application source, test, schema,
migration, configuration, `.env` file, frontend file, commit, push, or deployment was changed.
Many backend files were already modified or untracked before this task; those pre-existing
working-tree changes were inspected and left untouched.

Commands rerun during the audit from `fixit-backend/`: `npm test`, `npm run typecheck`,
`npm run typecheck:test`, and `npm run build`. All passed. `npm test` reported **171 tests in
12 files**. The isolated DB suite was **not** rerun; its last recorded result was **32 tests in
3 files**. No migration, production database access, live Groq test, live parts-provider test,
or secret exposure occurred. A prior Groq key that may have appeared in an earlier transcript
must be treated as exposed and rotated if that transcript is considered shared; no key value is
recorded here.

### 12.2 Verified current implementation boundaries

- All seven diagnosis routes (`POST/GET /diagnosis`, `GET /diagnosis/:id`,
  `GET/POST /diagnosis/:id/messages`, `/confirm`, `/complete`) are implemented; no `501`
  `NOT_IMPLEMENTED` remains in live source.
- Diagnosis requires an existing, owned `Appliance`. There are **no** `/appliances` CRUD routes
  anywhere in source, OpenAPI, or tests.
- No backend OCR, image-upload, vision, or multipart service exists. `appliance-scan.service.ts`
  is a zero-byte placeholder.
- The Expo app is SDK 58 with real static home/camera screens, but no API client, auth token
  storage, appliance screen, diagnosis screens, confirm/complete UI, OCR, or parts UI. The `scan`
  screen captures/picks locally and has an explicit upload TODO.
- OpenAPI documents the live health, auth, and diagnosis endpoints only. Swagger is opt-in via
  `ENABLE_API_DOCS`.
- Rate limiting is present but in-memory and per-process. SSE/streaming is absent.

### 12.3 Groq final-round reliability record

The repository contains the prior final-round reliability fix: the system prompt requires the
structured final tool even when information is insufficient, and the orchestrator forces
`submit_diagnosis_outcome` after the first lookup round. `ForcedToolNotCalledError` is produced
only for the narrow provider rejection: the **forced final tool round** with HTTP 400,
`tool_use_failed`, and a message containing `did not call a tool`. Other provider failures keep
their existing mapped errors.

On that exact signal, the backend generates a deterministic safe result: `UNRESOLVED` by
default, escalation to `TECHNICIAN_REQUIRED` when hazard text is present, and removal of repair
steps, citations, `errorCodeId`, and `issueFixChallenge`. This is a safety fallback, not a
replacement diagnosis. It is covered by mocked tests in
`tests/services/groq.service.test.ts` and `tests/services/orchestrator.test.ts`.

Limitations are explicit:

- Live activation of this fallback is **UNVERIFIED**; a controlled live provider test is
  required and was not authorized here.
- HTTP 200 with no tool call is outside the fallback and still maps to `AI_INVALID_RESPONSE`.
- The observed live Samsung `WW80T3040WW` diagnosis produced a safe technician-required
  response, persisted messages, left the session `OPEN`, and returned no repair steps, error
  codes, or citations. It did **not** prove that the narrow fallback branch was triggered.

### 12.4 Unresolved and unverified items

1. **Phase approvals:** Phases 1–4B retain explicit historical approvals. No explicit user
   approval is recorded for Phases 5–9, regardless of implementation or passing tests.
2. **Groq fallback:** not live-activation-verified; HTTP 200 with no tool call remains an
   unresolved safe-error path.
3. **Parts provider:** `PARTS_PROVIDER=none` is the default; `groq_browser` is unit-tested but
   externally UNVERIFIED. Production enablement remains a separate decision.
4. **DB suite:** last recorded 32/32, not rerun after the fallback change. If rerun, it must
   remain isolated to the exact `fixit-test` allowlist with `RUN_DB_TESTS=1`.
5. **Production knowledge/readiness:** the approved development knowledge promotion has not
   been applied or verified in production. Production readiness remains blocked pending a
   separate controlled review and explicit authorization.
6. **Phase 9:** streaming/SSE absent; D7 remains open; rate limiting is not distributed.
7. **Appliance CRUD/OCR/frontend:** all are future work only, with no implementation in this
   task.
8. **Confirm/complete regression:** backend unit/DB/validation coverage exists, but live
   frontend or end-to-end lifecycle testing does not.

### 12.5 Future phases added by this audit (not part of the original approved Phases 1–9)

These are proposed roadmap entries only. They require explicit authorization and do not change
the approved plan above.

#### Phase 10 — Authenticated Appliance CRUD

- **Status:** PENDING; NOT STARTED; no authorization in this document.
- **Objective:** let an authenticated user create, list, retrieve, update, and delete their own
  appliances without depending on test fixtures or direct Prisma writes.
- **Dependencies:** Phase 1 `Appliance` schema; Phase 3 auth/route/validation patterns;
  Phases 4A/4B ownership and DTO patterns; D9's isolated test database for any DB tests. No OCR
  or frontend work is in scope. No migration is expected because the model already exists; any
  schema change requires separate explicit approval.
- **Scope:** `src/routes/appliance.routes.ts`, controller, service, validators, DTOs, `app.ts`
  mount, OpenAPI paths, and DB-free/isolated-DB tests. All reads and writes must derive
  ownership from `req.user.id`; never trust a client-supplied `userId`.
- **Acceptance criteria:** `POST /appliances`, `GET /appliances`, `GET /appliances/:id`,
  `PATCH /appliances/:id`, and `DELETE /appliances/:id` are authenticated, Zod-validated,
  paginated where appropriate, DTO-filtered, owner-scoped, and OpenAPI-documented; non-owned
  ids produce the same 404 shape as missing ids; typechecks, DB-free tests, build, and
  `git diff --check` pass; isolated DB tests pass only under the existing fail-closed guard.

#### Phase 11 — OCR / sticker and error-code extraction

- **Status:** PENDING; NOT STARTED; no authorization in this document.
- **Dependencies:** Phase 10 must provide owned appliances and a review target. Decisions are
  needed for upload/storage provider (D11), OCR provider and confidence thresholds (D12),
  retention/deletion, and whether native modules require a development build. Any migration or
  storage change requires separate approval.
- **Scope:** authenticated image upload, bounded file/size/type validation, OCR extraction of
  brand/model/error-code candidates, confidence metadata, and a user-review/correction contract.
  Existing local camera/gallery capture in the Expo app is not a backend implementation.
- **Acceptance criteria:** uploads are authenticated, bounded, and never trusted as authoritative;
  extracted fields require explicit user review before writing appliance data; no knowledge row
  is approved automatically; secrets stay server-side; unsafe or low-confidence results are
  labeled; tests cover invalid files, oversize input, extraction failure, and correction flow.

#### Phase 12 — Frontend integration

- **Status:** PENDING; NOT STARTED; no authorization in this document.
- **Dependencies:** stable Phases 7–8 APIs, Phase 10 CRUD, Phase 11 OCR/review if scanning is
  included, and a manual confirm/complete lifecycle regression before client work. Expo SDK 58
  versioned docs must be fetched before writing Expo/EAS/RN code. This is an npm project, so use
  `npx expo install`, not Bun commands.
- **Scope:** typed API client and DTOs, secure token storage/refresh, auth gate, appliance list
  and management screens, scan upload/review wiring, diagnosis session creation/history,
  message turns, verdict/step/safety components, confirm/complete actions, parts presentation,
  loading/error/empty states, and navigation via Expo Router. Backend contract changes must be
  separately authorized.
- **Acceptance criteria:** no backend secrets in the app; all requests handle `{ success, data }`
  and error envelopes; bearer tokens are stored securely and refreshed; screens use real API
  data; `npx expo lint` and `npx tsc --noEmit` pass; native modules use a development build, not
  hand-edited `ios/`/`android/` directories.

### 12.6 Exact next implementation task

The next implementation task is **Phase 10 — Authenticated Appliance CRUD**, and it is currently
**PENDING explicit user authorization**. Do not begin it merely because this document records it.

When authorized, the exact task is:

1. Re-read `prisma/schema.prisma`, `src/services/session.service.ts`,
   `src/routes/diagnosis.routes.ts`, DTO/validator patterns, and `src/docs/openapi.ts`.
2. Add owner-scoped appliance routes under `/appliances` using
   `route → controller → service → Prisma`, Zod validation, explicit DTO selects, the existing
   response envelope, and auth before validation.
3. Implement create/list/get/update/delete without trusting client ownership fields; do not add
   a migration or change the diagnosis/OCR/frontend code.
4. Add DB-free HTTP/contract tests and, only with the existing isolated `fixit-test` guard,
   integration tests for ownership, validation, update, and delete.
5. Run `npm test`, `npm run typecheck`, `npm run typecheck:test`, `npm run build`,
   `git diff --check`, and the isolated DB suite if authorized/configured.
6. Update this `CONTEXT.md` with actual files, commands, results, status, and explicit approval
   state, then stop for user review. Do not commit, push, or deploy.

### 12.7 Consolidated agent safety rules

- Never access or modify a production database. `fixit-development-preserved` is development;
  `fixit-test` is isolated and must be guarded by the exact existing host allowlist and
  `RUN_DB_TESTS=1`.
- Never expose API keys, passwords, secrets, or full database URLs. Preserve redaction in AI
  diagnostics and DB-test guards.
- Do not weaken Zod validation, knowledge approval, exact model-scope checks, `USER_SAFE`
  filtering, no-partial-sequence rules, auth/ownership checks, forced final tool choice,
  request-id idempotency, or provider-call-outside-transaction rules.
- Model output remains advisory. Backend code alone controls verdicts, repair steps, citations,
  parts compatibility, confirmation challenges, idempotent persistence, and completion.
- Manufacturer `errorCode` is a human-readable code bounded to 36 characters. The backend
  resolves it with a fresh trusted `searchErrorCodes()` call scoped by category/brand/model and
  never copies a model-supplied UUID into `errorCodeId`.
- Never mark a phase `APPROVED BY USER` without explicit user approval; never infer that
  approval of one phase authorizes the next.
- Documentation-only tasks must not change source, schema, tests, config, database records, or
  git history. Preserve pre-existing uncommitted work.
