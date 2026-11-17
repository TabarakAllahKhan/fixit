# fixit-backend — Project Context

Last analyzed: 2026-11-17
Repository: `D:\fixit` (monorepo-ish: Expo app at root, API in `fixit-backend/`)

## 1. What this is

`fixit-backend` is the HTTP API for the FixIt mobile app. The product flow is: a user
photographs an appliance model sticker or error-code display, the backend identifies the
appliance and error code, then runs an AI-assisted troubleshooting conversation that can
end in one of four verdicts: `FIXED`, `NEEDS_PART`, `TECHNICIAN_REQUIRED`, `UNRESOLVED`.

The backend is an **early-stage scaffold**. The infrastructure (config, DB schema, health
check, error handling) is done and typechecks cleanly. The diagnosis feature is stubbed
out and not yet wired in.

## 2. Stack

| Concern        | Choice                                                              |
| -------------- | ------------------------------------------------------------------- |
| Runtime        | Node.js (ESM — `"type": "module"`)                                  |
| Language       | TypeScript 7 (`strict: true`, `module`/`moduleResolution`: nodenext) |
| Server         | Express 5.3                                                         |
| Database       | PostgreSQL (Neon), via Prisma 7.10.1 + `@prisma/adapter-pg` driver adapter |
| Validation     | Zod 4 (env vars and request bodies)                                 |
| Auth           | `bcryptjs` password hashes, `jsonwebtoken` access tokens, opaque hashed refresh tokens |
| AI provider    | `groq-sdk` 1.6 installed; adapter/tool loop not implemented and no calls made yet |
| Dev runner     | `tsx watch`                                                         |
| Tests          | Vitest 5 + Vite 8 + Supertest 7 (`npm test` = `vitest run`)          |
| Lint / format  | **None configured**                                                 |

Pinned: `prisma`, `@prisma/client`, `@prisma/adapter-pg` all at **7.10.1** — keep them in
lockstep. Prisma 8 renames `@default(uuid(7))` to `@onCreate(uuid(7))`; do not upgrade
without rewriting the schema.

## 3. Directory layout

```
fixit-backend/
├─ .env                  # secrets, gitignored
├─ .env.example          # documents every required variable
├─ prisma.config.ts      # Prisma CLI config (schema path, migrations, DIRECT_URL)
├─ vitest.config.ts      # Vitest config: node env, tests/**/*.test.ts, envDir false
├─ tsconfig.test.json    # typecheck src + tests + vitest.config.ts (noEmit)
├─ tests/
│  ├─ setup-env.ts       # refuses NODE_ENV=production; sets dummy env before imports
│  ├─ config/env.test.ts # env schema + production guard tests
│  ├─ http/app.test.ts   # Supertest smoke tests (no database)
│  └─ dependencies/groq-sdk.test.ts # ESM import/construction only, no network
├─ prisma/
│  ├─ schema.prisma      # 9 models, 8 enums
│  └─ migrations/
│     ├─ migration_lock.toml
│     ├─ 20261113122829_init/migration.sql
│     ├─ 20261113130000_add_user_auth/migration.sql
│     ├─ 20261114090000_add_refresh_token_family/migration.sql
│     └─ 20261116093023_verdict_pending_confirmation/migration.sql
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
   │  ├─ health.routes.ts        # GET /
   │  ├─ auth.routes.ts          # register/login/refresh/logout/change-password, GET me
   │  └─ diagnosis.routes.ts     # POST /  (not mounted yet)
   ├─ controllers/
   │  ├─ auth.controller.ts      # auth HTTP handlers
   │  └─ diagnosis.controller.ts # STUB
   ├─ services/
   │  ├─ auth.service.ts         # register/login/refresh/logout/change password/current user
   │  ├─ password.service.ts     # bcrypt hash + verify
   │  ├─ token.service.ts        # access JWT + opaque refresh token/family helpers
   │  ├─ diagnosis.service.ts    # placeholder
   │  ├─ ai.service.ts           # placeholder
   │  ├─ session.service.ts      # placeholder
   │  ├─ knowledge.service.ts    # placeholder
   │  └─ appliance-scan.service.ts # placeholder
   ├─ middleware/
   │  ├─ auth.middleware.ts      # requireAuth -> attaches req.user
   │  ├─ validate.ts             # Zod request-body validation
   │  ├─ errorHandler.ts         # 4-arg Express error handler, last middleware
   │  └─ notFound.ts             # 404 catch-all
   ├─ validators/
   │  └─ auth.validator.ts       # register/login/refresh/change-password schemas
   ├─ types/
   │  └─ express.d.ts            # req.user declaration for requireAuth
   ├─ utils/
   │  ├─ apiResponse.ts          # sendSuccess / sendError envelope
   │  └─ httpError.ts            # client-safe HttpError (status + code)
   ├─ scripts/test-prisma.ts     # one-off connection smoke test
   ├─ scripts/seed.ts            # idempotent knowledge-base seed (development-only guard)
   └─ generated/prisma/          # Prisma client output, GITIGNORED
```

`src/app.ts` mounts `/health` and `/auth`; it still does **not** import
`routes/diagnosis.routes.ts`, so diagnosis is not live. The working tree also mounts an
uncommitted Swagger `/docs` router (`src/docs/**`); that pre-existing work is preserved
untouched and is not part of Phase 2. `postinstall`/generate is not scripted; run
`prisma generate` after a fresh clone (see §7).

## 4. Request lifecycle

`server.ts` → `app.ts`:
1. `express.json()` body parser
2. `app.use("/health", healthRouter)`
3. `app.use("/auth", authRouter)`
4. `app.use("/docs", docsRouter)` — uncommitted Swagger UI/OpenAPI JSON work, working tree only
5. `notFound` → `{ success:false, error:{ code:"NOT_FOUND", message:"Route not found" } }`, 404
6. `errorHandler` → expected failures thrown as `HttpError` keep their status/code;
   unknown errors log their stack server-side and return `INTERNAL_ERROR` / 500. Never leaks
   internals. If headers were already sent it delegates back to Express.

### Response contract (`src/utils/apiResponse.ts`)

```ts
// success
{ "success": true, "data": <T> }
// error
{ "success": false, "error": { "code": "STRING_CODE", "message": "human readable" } }
```

Existing codes: `VALIDATION_ERROR` (400), `PASSWORD_UNCHANGED` (400), `UNAUTHORIZED`
(401), `INVALID_CREDENTIALS` (401), `INVALID_REFRESH_TOKEN` (401),
`REFRESH_TOKEN_REUSED` (401), `NOT_FOUND` (404), `EMAIL_ALREADY_EXISTS` /
`USERNAME_ALREADY_EXISTS` / `ACCOUNT_ALREADY_EXISTS` (409), `INTERNAL_ERROR` (500),
`DATABASE_UNAVAILABLE` (503).
Add new codes as SCREAMING_SNAKE_CASE; never put raw error text in `message`.

### Endpoints

| Method | Path              | Status      | Behaviour |
| ------ | ----------------- | ----------- | --------- |
| GET    | `/health`         | Working     | `SELECT 1` against Postgres → `{ status:"ok", database:"connected" }`; 503 `DATABASE_UNAVAILABLE` on failure |
| POST   | `/auth/register`  | Working     | Body `{ email, username, password }` → 201 `{ user, tokens }`; duplicate email/username → 409; invalid body → 400 |
| POST   | `/auth/login`     | Working     | Body `{ email, password }` **or** `{ username, password }` → 200 `{ user, tokens }`; bad credentials → 401 |
| POST   | `/auth/refresh`   | Working     | Body `{ refreshToken }` → 200 `{ tokens }`; rotates the token. Reuse of a rotated/revoked token → 401 `REFRESH_TOKEN_REUSED` and revokes the entire family |
| POST   | `/auth/logout`    | Working     | Body `{ refreshToken }` → 200 `{ message }`; revokes the token, idempotent |
| POST   | `/auth/change-password` | Working | Requires `Authorization: Bearer <accessToken>`; body `{ currentPassword, newPassword }` → 200 `{ message }`; wrong current password → 401, unchanged/short new password → 400; revokes all active refresh tokens |
| GET    | `/auth/me`        | Working     | Requires `Authorization: Bearer <accessToken>` → 200 `{ user }`; missing/invalid token → 401 |
| POST   | `/diagnosis` (assumed base path) | Not mounted | Router exists but is never registered; controller is an empty `try/catch` that never responds |

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
| `DiagnosisSession`  | One troubleshooting conversation | `applianceId` nullable (`SetNull`), `errorCodeId` nullable (`Restrict`), `status` OPEN/COMPLETED/ABANDONED, `verdict` nullable, server-managed `fixConfirmationChallengeId` / `fixConfirmationIssuedAt` / `fixConfirmationExpiresAt` nullable |
| `Message`           | Chat turn                        | `role` USER/ASSISTANT, cascade with session |

Enums: `ApplianceCategory` (WASHING_MACHINE, REFRIGERATOR), `SourceKind`, `ReviewStatus`,
`SafetyClass`, `Difficulty`, `SessionStatus`, `Verdict`
(FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED), `MessageRole`.

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

## 6. Environment variables

`.env` is gitignored; `.env.example` documents every required variable.

| Var            | Used by                                | Notes |
| -------------- | -------------------------------------- | ----- |
| `NODE_ENV`     | `src/config/env.ts`                    | **required, no default**: `development` / `test` / `production`. Production additionally enforces the Groq and unreviewed-knowledge guards below |
| `PORT`         | `src/config/env.ts` → `server.ts`      | default `3000`; supplied values coerced to int 1–65535 |
| `DATABASE_URL` | `src/config/prisma.ts` (runtime); required by `src/scripts/seed.ts` for host validation | must be `postgres://` or `postgresql://`; pooled runtime connection. Local `.env` points to the development branch |
| `DIRECT_URL`   | `prisma.config.ts` (migrations/introspection) and `src/scripts/seed.ts` (seed connection) | direct/session connection. Local `.env` points to the development branch |
| `SEED_TARGET`  | `src/scripts/seed.ts`                  | must be exactly `development`; the seed aborts if missing or different |
| `JWT_ACCESS_SECRET` | `src/config/env.ts` → `token.service.ts` | **required**, minimum 32 characters; changing it invalidates every access token |
| `ACCESS_TOKEN_TTL_SECONDS` | `src/config/env.ts` → `token.service.ts` | default `900` (15 min), allowed 60–86400 |
| `REFRESH_TOKEN_TTL_DAYS` | `src/config/env.ts` → `token.service.ts` | default `30`, allowed 1–365 |
| `GROQ_API_KEY` | `src/config/env.schema.ts`; future AI service | backend-only credential; optional in development/test, **required in production**; empty/whitespace counts as absent; never logged |
| `GROQ_MODEL`   | `src/config/env.schema.ts`; future AI service | tool-capable model id; default `openai/gpt-oss-120b`, non-empty override allowed |
| `ALLOW_UNREVIEWED_KNOWLEDGE` | `src/config/env.schema.ts`; future knowledge service | development-only switch; default `false`; accepts exactly `true`/`false`; **startup failure when `NODE_ENV=production`** |

Configuration is split so the rules are testable: `env.schema.ts` is a pure Zod schema plus
`parseEnv(raw)` with no dotenv, logging, or process exit; `env.ts` loads dotenv, validates
`process.env`, prints only variable names/messages (never values), and exits `1` on failure.
`server.ts` imports `env` before `app` so invalid configuration fails before the app or
database client is constructed. Deferred until their implementation phases:
`GROQ_TIMEOUT_MS`, `GROQ_MAX_RETRIES`, `GROQ_MAX_TOOL_ROUNDS`,
`FIX_CONFIRMATION_TTL_SECONDS`, and `PARTS_PROVIDER`.

Gotcha: env validation in `env.ts` validates the application vars above; `SEED_TARGET` is
read only by the seed and is not part of that schema. `prisma.ts` reads
`process.env.DATABASE_URL` directly and throws at import time if missing. Keep both in
sync if you add config. The JWT secret has no default, so a fresh clone must copy
`.env.example` and generate a real value before `npm run dev`.

The Neon project has separate production and development branches. The local backend
`.env` points both `DIRECT_URL` and `DATABASE_URL` at the development branch.
`src/scripts/seed.ts` requires `SEED_TARGET=development`, validates both URLs against the
approved development hostname, and rejects `NODE_ENV=production` unconditionally. It never
prints connection strings or secrets.

## 7. Commands

Run everything from `fixit-backend/`.

```bash
npm run dev              # tsx watch src/server.ts
npm run build            # tsc -> dist/ (tests are excluded)
npm start                # node dist/server.js (requires build first)
npm run typecheck        # tsc --noEmit  (currently passes clean)
npm run typecheck:test   # typecheck src + tests + vitest.config.ts
npm test                 # vitest run (one-shot, CI-style)
npm run test:watch       # vitest watch mode
npm run db:seed          # tsx src/scripts/seed.ts (requires SEED_TARGET=development; uses DIRECT_URL)

npx prisma generate                        # rebuild src/generated/prisma (needed after clone)
npx prisma migrate dev                     # create + apply a migration (uses DIRECT_URL)
npx prisma migrate deploy                  # apply in CI/production
npx prisma studio                          # browse data
npx tsx src/scripts/test-prisma.ts         # one-off connection smoke test
```

Tests currently cover the environment schema/guards, HTTP routing/envelope smoke checks, and
Groq SDK ESM import/construction. They use dummy credentials, make no database connection,
and make no network/AI calls. `tests/setup-env.ts` refuses to run when `NODE_ENV=production`.

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

Done: env validation, Prisma client singleton with driver adapter, all three migrations
(init, user auth, refresh-token family) applied to the development branch, DB health
endpoint, error envelope, `HttpError` handling, 404/500 handling, connection smoke script,
and the complete email/password auth flow (register, login by email or username, JWT access
tokens, rotating hashed refresh tokens, logout, `GET /auth/me`, auth middleware, Zod body
validation). Password change verifies the current password, rejects an unchanged new
password, rehashes, revokes every active refresh token, and returns no user/credential data.
Refresh-token families detect replay, revoke the whole family, and use a conditional
transaction so concurrent refresh requests cannot both succeed. `tsc --noEmit` is clean and
all auth features were exercised end-to-end, including concurrent refresh races.

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

Open work, roughly in dependency order:

1. **`POST /diagnosis` never responds.** `diagnosis.controller.ts` has an empty `try`
   block: no service call, no `sendSuccess`, no `next`. Any request would hang until
   timeout. Don't mount the router until this is implemented.
2. **Diagnosis router not mounted.** `app.ts` imports `healthRouter` and `authRouter`, but
   still not `diagnosisRouter`.
3. **All five diagnosis/knowledge services are empty placeholders** — `knowledge`
   (retrieval + review rules), `diagnosis` (orchestration), `ai` (LLM call), `session`
   (persistence), `appliance-scan` (image → appliance/error code). `groq-sdk` is installed
   and import-verified, but no AI client code, tool loop, or API call exists yet.
4. **Validation middleware exists for auth only.** Reuse `validateBody` and create
   schema-per-route validators before writing the diagnosis controller.
5. **No CORS.** The Expo client calling from a device/emulator needs it (or a dev proxy).
6. **Auth hardening still deferred:** no rate limiting/account lockout, email verification,
   password reset flow, or session listing/revocation. Password change and refresh-token
   reuse detection are implemented. Access tokens are stateless, so logout/password change
   revokes refresh tokens but an already-issued access token remains valid until it expires.
7. **Test coverage is still foundational:** `npm test` runs Vitest smoke/unit tests (3
   files, 14 tests), but there is no CI, lint/format config, coverage tooling, or database
   integration suite. Database integration tests wait for a dedicated Neon test branch
   before Phase 4.
8. **`src/generated/` is gitignored** — fresh clones must run `npx prisma generate`, and
   `tsconfig` includes `src` so the build depends on generation having run.
9. Deferred by design: appliance model/family tables, review audit records (who approved),
   diagnosis state tracking, steps for symptoms without error codes, push tokens,
   subscriptions, image storage.

## 10. Connecting from the Expo app

The mobile client lives at the repo root (`src/app/`, Expo Router) and currently has **no
API client** — `lib/api.ts` and `types/index.ts` are empty. Screens: `index` (entry),
`scan` (camera/gallery picker, upload not wired), plus empty placeholders `appliances.tsx`
and `diagnose/[id].tsx`.

When wiring it up: point the app at `http://<LAN-IP>:3000`, not `localhost` (a device or
emulator can't reach the host's loopback), and consider `expo-constants` `hostUri` for
auto-detection. Responses must be parsed through the `{ success, data }` envelope, not
raw payloads. Store the access token in secure storage, send it as
`Authorization: Bearer <token>`, and refresh proactively before `expiresIn` elapses.

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

## Diagnosis & Sessions Implementation Roadmap

> Authoritative handover for Fix-It Diagnosis & Sessions. This roadmap is approved as the implementation plan; **no implementation is authorized by this document alone**. Every phase requires explicit user authorization before work begins. Preserve and update this section (and existing sections above) in every session.

### Persistent progress tracker

- **Current phase:** Phase 2 — Environment, dependencies, and test harness foundation
- **Current phase status:** APPROVED BY USER (2026-11-17)
- **Last implemented phase:** Phase 2
- **Last phase with tests passed:** Phase 2 — the user independently ran and verified `npm test` (14 tests passed across 3 files), `npm run typecheck`, `npm run typecheck:test`, `npm run build`, and `npx prisma validate`; all passed on 2026-11-17. Production env guards were also verified during implementation.
- **Last phase approved by user:** Phase 2 (2026-11-17)
- **Next phase awaiting authorization:** Phase 3 — Diagnosis validators, middleware helpers, and route/controller scaffolding (NOT STARTED; separate authorization required)
- **Outstanding decisions:** D1 resolved (safe `CALL_TECHNICIAN` → `TECHNICIAN_REQUIRED` rename, `UNRESOLVED` added); D2 resolved (Vitest 5 + Vite 8 + Supertest 7; `npm test` = `vitest run`); D3 resolved (default `openai/gpt-oss-120b`, env-configurable); D4 explicit `FIXED` confirmation action form/contract; D5 `NEEDS_PART` completion trigger (end/ack and/or deterministic no-further-action rule); D6 initial parts provider enablement/keys; D7 streaming priority (JSON-only vs SSE in MVP); D8 CORS and/or basic rate limiting in-scope; D9 resolved (no DB access in Phase 2; dedicated Neon test branch before Phase 4); D10 resolved (option C hybrid: approved error-code knowledge + symptom questioning/candidate narrowing for MVP, dedicated reviewed symptom/cause model later if needed)
- **Last progress update:** 2026-11-17 — Phase 2 implemented and tested on 2026-11-16: added `groq-sdk` + Vitest/Vite/Supertest, pure env schema, required `NODE_ENV`, `GROQ_API_KEY` / `GROQ_MODEL` / `ALLOW_UNREVIEWED_KNOWLEDGE`, production guards, and a test harness. 14 tests in 3 files pass; typecheck, test-typecheck, build, and `prisma validate` pass. No database, network/AI call, seed, migration, or production access occurred; protected Swagger files remained byte-identical; package changes were additive. Phase 2 was explicitly approved by the user on 2026-11-17 after independently running and verifying `npm test` (14 tests across 3 files), `npm run typecheck`, `npm run typecheck:test`, `npm run build`, and `npx prisma validate` (all passed). **Production knowledge promotion is still required:** the approved development Neon knowledge does not automatically exist in production, so a controlled promotion process is needed before launch. The audit found exactly **one** complete production-returnable sequence in the audited development dataset; this is a finding about that dataset only — production Neon was not inspected or updated.

**Status values (use consistently):** `NOT STARTED` | `IN PROGRESS` | `IMPLEMENTED` | `TESTS PASSED` | `APPROVAL PENDING` | `APPROVED BY USER`
**Rule:** distinguish implementation completion, successful testing, and explicit user approval. Never mark `APPROVED BY USER` without the user's explicit approval.

### Current starting position (recorded)

- Phases 1–9 are **planned and reviewed**; the implementation roadmap is **approved** as the plan.
- **Phase 1 is APPROVED BY USER (2026-11-16).** Its migration is applied and verified on the development branch. No migration was applied to production, and no implementation phase beyond Phase 2 has been started.
- **Phase 2 is APPROVED BY USER (2026-11-17); implementation and tests completed 2026-11-16.** The user independently ran and verified `npm test` (14 tests passed across 3 files), `npm run typecheck`, `npm run typecheck:test`, `npm run build`, and `npx prisma validate`; all passed. Phase 2 added only environment, dependency, and test-harness infrastructure; no database access, schema/migration/seed change, or diagnosis behavior. Phase 3 remains NOT STARTED.
- **No seed was run during Phase 1 or Phase 2. No production database was accessed.**
- **Phase 2 scope/decisions (implemented):** `groq-sdk` 1.6 + Vitest 5/Vite 8/Supertest 7; pure `env.schema.ts` + side-effecting `env.ts`; `NODE_ENV` required; only `GROQ_API_KEY`, `GROQ_MODEL`, and `ALLOW_UNREVIEWED_KNOWLEDGE` added; production rejects a missing Groq key and rejects unreviewed knowledge; `npm test` = `vitest run`; tests refuse `NODE_ENV=production` and use dummy credentials. Deferred: `GROQ_TIMEOUT_MS`, `GROQ_MAX_RETRIES`, `GROQ_MAX_TOOL_ROUNDS`, `FIX_CONFIRMATION_TTL_SECONDS`, and `PARTS_PROVIDER`.
- **Phase 1 scope/decisions (implemented):** `Verdict` is now `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED`; migration `20261116093023_verdict_pending_confirmation` safely renames `CALL_TECHNICIAN` → `TECHNICIAN_REQUIRED` and adds `UNRESOLVED`; `DiagnosisSession` gained the three approved nullable/server-managed fields `fixConfirmationChallengeId`, `fixConfirmationIssuedAt`, and `fixConfirmationExpiresAt` (single-use `FIXED` confirmation challenge persisted across requests; `Message` content is not authoritative). MVP keeps `applianceId`-based context (no ad-hoc snapshot columns).
- **Preflight/apply state (development branch):** before apply, 3 migrations were applied; `Verdict` was `FIXED, NEEDS_PART, CALL_TECHNICIAN`; 0 `DiagnosisSession` rows; no `fixConfirmation*` columns. After explicit authorization, the migration was applied: the enum now has all four values, all three nullable columns exist, and `_prisma_migrations` records the migration as finished. Knowledge-base row counts were unchanged (15 sources, 77 error codes, 117 repair steps, 188 links) and diagnosis sessions remain 0.
- **Baseline repo state at Phase 1 start:** diagnosis routes/controller/services are scaffolded/unwired (router not mounted in `app.ts`, controller empty, services empty); no `groq-sdk`, no test runner. Undocumented uncommitted Swagger/OpenAPI work exists and was preserved untouched. At Phase 2 start those dependencies and the test runner were still absent; Phase 2 added them.

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
| D3 | Default Groq model id (tool-capable, env-configurable) | **Resolved 2026-11-16** | Default `openai/gpt-oss-120b`, overridable with `GROQ_MODEL`; no AI client code or API calls were implemented in Phase 2. |
| D4 | Explicit `FIXED` confirmation action form/contract (e.g. dedicated endpoint/flag) matched to pending challenge | Open | Affects Phases 2–5/7 validators/routes/logic. |
| D5 | `NEEDS_PART` completion trigger (explicit end/ack action and/or deterministic no-further-in-app-action rule) | Open | Affects Phases 3–4/7 transitions. |
| D6 | Initial parts provider enablement (`none` default vs specific provider/API key) | Open | Affects Phase 8. |
| D7 | Streaming priority (JSON-only MVP vs include SSE) | Open | Affects Phase 9 scope/timing. |
| D8 | CORS and/or basic rate limiting in-scope | Open | Affects Phase 3/9 hardening. |
| D9 | Test database strategy | **Resolved 2026-11-16** | No database access in Phase 2 (unit/HTTP smoke only). A dedicated Neon test branch must be created before Phase 4 database integration tests; the development branch is not used as a test database because it holds approved knowledge. |
| D10 | Symptom-based diagnosis knowledge strategy | **Resolved 2026-11-16 — option C (hybrid)** | MVP uses approved error-code knowledge with symptom-based questioning and candidate narrowing. AI candidate codes are hypotheses, never confirmed diagnoses; the backend validates candidates against applicable knowledge before any repair instructions. A dedicated reviewed symptom/cause knowledge model may be added later if needed. |

### Complete approved implementation checklist (Phases 1–9)

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
| 3 | NOT STARTED | — | None | — | Not run | — | D4, D5, D8 | No |
| 4 | NOT STARTED | — | None | — | Not run | — | D4, D5 | No |
| 5 | NOT STARTED | — | None | — | Not run | — | — | No |
| 6 | NOT STARTED | — | None | — | Not run | — | D3 | No |
| 7 | NOT STARTED | — | None | — | Not run | — | D4, D5 | No |
| 8 | NOT STARTED | — | None | — | Not run | — | D6 | No |
| 9 | NOT STARTED | — | None | — | Not run | — | D7, D8 | No |

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
