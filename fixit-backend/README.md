# FixIt backend

Express 5 + TypeScript + Prisma 7 backend for the FixIt diagnosis flow. The React Native client is a separate project.

## Required environment

Copy `.env.example` and set at least:

- `NODE_ENV` (`development`, `test`, or `production`)
- `DATABASE_URL` — pooled PostgreSQL connection used at runtime
- `DIRECT_URL` — direct PostgreSQL connection used by Prisma migrations/seeds
- `JWT_ACCESS_SECRET` — random value of at least 32 characters
- `GOOGLE_API_KEY` — backend-only Gemini credential; optional at startup in development/test but required for any live diagnosis turn

Production additionally requires `GOOGLE_API_KEY` (Gemini diagnosis provider), keeps `RATE_LIMIT_ENABLED=true`, and rejects `ALLOW_UNREVIEWED_KNOWLEDGE=true`.

Never commit real secrets or connection strings. Never point this project at a production database during local testing.

## Install, migrate, build, run

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm start
```

`npm install` runs `prisma generate` through the `postinstall` script (added below). `npx prisma migrate deploy` must be run in the deployment step before starting the new build. Do not create or edit `ios/` or `android/` here; this repository is backend-only.

## Health checks

- `GET /health/live` — process liveness; no database call.
- `GET /health/ready` — database readiness with a bounded timeout.
- `GET /health` — backward-compatible alias of `/health/ready`.

Use `/health/live` for container restarts and `/health/ready` for traffic routing.

## API docs

Swagger UI at `/docs` and the raw spec at `/docs/openapi.json` are disabled unless `ENABLE_API_DOCS=true`. Enable them locally or in staging when needed; leave them disabled for a public production deployment unless intentionally required.

## Error-code OCR

`POST /ocr/error-code` is an authenticated, local Tesseract.js endpoint that returns **advisory** appliance error-code candidates only. It handles numeric (83, 01), alphabetic (FE, OE, dE, LE) and alphanumeric (E03, F5, H1, E83) codes, conservative casing/OCR-confusion normalization, and separated tokens such as `E 03` when bounding-box evidence confirms the layout. Numeric-first text such as `83 E` is never reordered. Model/serial identifiers, temperatures, clocks, dates and measurements are suppressed. It never extracts brand, model or serial number, creates a diagnosis session, or calls an AI provider. The client must always let the user confirm or correct the code before starting diagnosis.

- Request: `multipart/form-data` with one file in the field named `image`.
- Accepted formats: JPEG (`image/jpeg`), PNG (`image/png`) and WebP (`image/webp`). The file signature is checked in addition to the declared MIME type; HEIC/HEIF from some camera apps is not accepted and must be converted to one of these formats by the client.
- Maximum size: 5 MB per upload. Only one file per request.
- Responses are wrapped in the standard `{ success, data }` envelope. `data.status` is `DETECTED` (one code), `AMBIGUOUS` (several candidates, no single code) or `UNREADABLE` (no reliable code plus retry guidance). Even no-detection and ambiguous outcomes return HTTP 200; invalid uploads return 400 and OCR failures return 500.
- Uploads are written to a uniquely named file in the OS temporary directory, processed, and deleted before the response in success, validation-failure and OCR-failure paths. Nothing is persisted in the database.

Tesseract.js v7 requires Node.js 16 or newer (this project runs on Node 22). The first OCR request may download the cached English traineddata to the OS temp directory; subsequent requests reuse that local cache. No cloud OCR is used.

To test with Swagger: set `ENABLE_API_DOCS=true`, start the backend, open `/docs`, click **Authorize** and supply a bearer access token from `/auth/login`, expand **OCR → POST /ocr/error-code**, click **Try it out**, choose a JPEG/PNG/WebP display image, and execute. The three possible 200 response examples are included in the spec.

## Rate limits and CORS

`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX`, and `RATE_LIMIT_MESSAGE_MAX` configure the built-in in-memory limiter for auth endpoints and paid diagnosis turns. It protects a single process; use an edge/load-balancer limiter in addition for multi-instance production.

Browser origins must be listed in `CORS_ALLOWED_ORIGINS`. Native clients do not send an `Origin` header and remain allowed.

## Parts discovery

`PARTS_PROVIDER=none` is the default and keeps diagnosis working without external search. To opt in locally:

1. Set `PARTS_PROVIDER=groq_browser`.
2. Keep `GROQ_MODEL=openai/gpt-oss-20b` (or `openai/gpt-oss-120b`); Groq browser search supports these GPT-OSS models.
3. Set `GROQ_API_KEY` to a valid key. No separate browser-search provider or credential is required.
4. Optionally narrow `PARTS_ALLOWED_DOMAINS` and `PARTS_MAX_RESULTS`.

The provider uses Chat Completions with `tools: [{ type: "browser_search" }]`, not Structured Outputs. Compatibility is classified by backend code from returned titles/content; the model never supplies compatibility. Results are limited to HTTPS URLs on allowlisted domains, deduplicated, and filtered for relevance. Provider failures degrade to zero candidates and do not fail the diagnosis turn.

## Automated checks

```bash
npx prisma validate
npm test
npm run test:db
npm run typecheck
npm run typecheck:test
npm run build
git diff --check
```

`npm run test:db` uses the isolated `fixit-test` database and its guards. Do not remove those guards or point them at production.
