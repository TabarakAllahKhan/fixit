# fixit-backend — Project Context

Last analyzed: 2026-11-14
Repository: `D:\fixit` (monorepo-ish: Expo app at root, API in `fixit-backend/`)

## 1. What this is

`fixit-backend` is the HTTP API for the FixIt mobile app. The product flow is: a user
photographs an appliance model sticker or error-code display, the backend identifies the
appliance and error code, then runs an AI-assisted troubleshooting conversation that can
end in one of three verdicts: `FIXED`, `NEEDS_PART`, `CALL_TECHNICIAN`.

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
| Dev runner     | `tsx watch`                                                         |
| Tests / lint   | **None configured** (`npm test` is a placeholder)                    |

Pinned: `prisma`, `@prisma/client`, `@prisma/adapter-pg` all at **7.10.1** — keep them in
lockstep. Prisma 8 renames `@default(uuid(7))` to `@onCreate(uuid(7))`; do not upgrade
without rewriting the schema.

## 3. Directory layout

```
fixit-backend/
├─ .env                  # secrets, gitignored
├─ .env.example          # documents every required variable
├─ prisma.config.ts      # Prisma CLI config (schema path, migrations, DIRECT_URL)
├─ prisma/
│  ├─ schema.prisma      # 9 models, 8 enums
│  └─ migrations/
│     ├─ migration_lock.toml
│     ├─ 20261113122829_init/migration.sql
│     ├─ 20261113130000_add_user_auth/migration.sql
│     └─ 20261114090000_add_refresh_token_family/migration.sql
├─ database_design/
│  └─ DATABASE_DESIGN.md # ER diagram + design rationale (source of truth for rules)
└─ src/
   ├─ server.ts                  # boots app, listens on env.PORT
   ├─ app.ts                     # express app, middleware + route mounting
   ├─ config/
   │  ├─ env.ts                  # Zod-validated env, exits process on failure
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
`routes/diagnosis.routes.ts`, so diagnosis is not live. `postinstall`/generate is not
scripted; run `prisma generate` after a fresh clone (see §7).

## 4. Request lifecycle

`server.ts` → `app.ts`:
1. `express.json()` body parser
2. `app.use("/health", healthRouter)`
3. `app.use("/auth", authRouter)`
4. `notFound` → `{ success:false, error:{ code:"NOT_FOUND", message:"Route not found" } }`, 404
5. `errorHandler` → expected failures thrown as `HttpError` keep their status/code;
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
| `DiagnosisSession`  | One troubleshooting conversation | `applianceId` nullable (`SetNull`), `errorCodeId` nullable (`Restrict`), `status` OPEN/COMPLETED/ABANDONED, `verdict` nullable |
| `Message`           | Chat turn                        | `role` USER/ASSISTANT, cascade with session |

Enums: `ApplianceCategory` (WASHING_MACHINE, REFRIGERATOR), `SourceKind`, `ReviewStatus`,
`SafetyClass`, `Difficulty`, `SessionStatus`, `Verdict`, `MessageRole`.

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
| `NODE_ENV`     | `src/config/env.ts`                    | `development` *(default)* / `test` / `production` |
| `PORT`         | `src/config/env.ts` → `server.ts`      | default `3000`, coerced to int 1–65535 |
| `DATABASE_URL` | `src/config/prisma.ts` (runtime); required by `src/scripts/seed.ts` for host validation | must be `postgres://` or `postgresql://`; pooled runtime connection. Local `.env` points to the development branch |
| `DIRECT_URL`   | `prisma.config.ts` (migrations/introspection) and `src/scripts/seed.ts` (seed connection) | direct/session connection. Local `.env` points to the development branch |
| `SEED_TARGET`  | `src/scripts/seed.ts`                  | must be exactly `development`; the seed aborts if missing or different |
| `JWT_ACCESS_SECRET` | `src/config/env.ts` → `token.service.ts` | **required**, minimum 32 characters; changing it invalidates every access token |
| `ACCESS_TOKEN_TTL_SECONDS` | `src/config/env.ts` → `token.service.ts` | default `900` (15 min), allowed 60–86400 |
| `REFRESH_TOKEN_TTL_DAYS` | `src/config/env.ts` → `token.service.ts` | default `30`, allowed 1–365 |

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
npm run build            # tsc -> dist/
npm start                # node dist/server.js (requires build first)
npm run typecheck        # tsc --noEmit  (currently passes clean)
npm run db:seed          # tsx src/scripts/seed.ts (requires SEED_TARGET=development; uses DIRECT_URL)

npx prisma generate                        # rebuild src/generated/prisma (needed after clone)
npx prisma migrate dev                     # create + apply a migration (uses DIRECT_URL)
npx prisma migrate deploy                  # apply in CI/production
npx prisma studio                          # browse data
npx tsx src/scripts/test-prisma.ts         # one-off connection smoke test
```

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

Open work, roughly in dependency order:

1. **`POST /diagnosis` never responds.** `diagnosis.controller.ts` has an empty `try`
   block: no service call, no `sendSuccess`, no `next`. Any request would hang until
   timeout. Don't mount the router until this is implemented.
2. **Diagnosis router not mounted.** `app.ts` imports `healthRouter` and `authRouter`, but
   still not `diagnosisRouter`.
3. **All five diagnosis/knowledge services are empty placeholders** — `knowledge`
   (retrieval + review rules), `diagnosis` (orchestration), `ai` (LLM call), `session`
   (persistence), `appliance-scan` (image → appliance/error code). No AI provider SDK is
   installed yet (design mentions Groq with structured output limited to candidate IDs).
4. **Validation middleware exists for auth only.** Reuse `validateBody` and create
   schema-per-route validators before writing the diagnosis controller.
5. **No CORS.** The Expo client calling from a device/emulator needs it (or a dev proxy).
6. **Auth hardening still deferred:** no rate limiting/account lockout, email verification,
   password reset flow, or session listing/revocation. Password change and refresh-token
   reuse detection are implemented. Access tokens are stateless, so logout/password change
   revokes refresh tokens but an already-issued access token remains valid until it expires.
7. **`npm test` is a stub**, no CI, no lint/format config.
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
