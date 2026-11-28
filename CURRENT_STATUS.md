# Fix-It — Current Status

Concise operational handoff. Read `AGENTS.md` (rules), `PROJECT_PLAN.md`
(requirements and approved architecture) and this file at the start of every
session. Keep this file short: replace stale sections instead of appending
history. Detailed review history lives in Git and past conversations, not here.

**Last updated:** 2026-11-28
**Branch:** `feat/backend-setup`
**Last commit (HEAD):** `2852780` (verified 2026-11-28)

## 1. Where we are

| Item | State |
| --- | --- |
| Phase 2C + 2D (research integration, backend safety, outcome gate, evidence guards) | **APPROVED BY USER** after an independent Opus review. **Git checkpoint pending user authorisation** (not staged, not committed). |
| Next phase | **Appliance sticker OCR** (section 7). Not started. |
| Known targeted follow-up | Microwave context can expire in long sessions (section 5). Small fix; does not reopen the safety audit. |

## 2. Project identity and stack

Fix-It is an AI-powered household appliance troubleshooting app.

| Layer | Technology |
| --- | --- |
| Mobile app | React Native, Expo SDK 58 (`expo ~58.1.0`), Expo Router, TypeScript (`src/app/`) |
| API | Express 5, TypeScript, Zod (`fixit-backend/`) |
| Database | PostgreSQL, Prisma 7 |
| Diagnosis reasoning | Gemini (bounded tool loop) — primary diagnosis and conversation |
| Research | Groq browser search — optional, one bounded call per turn, disabled by default |
| Knowledge base | PostgreSQL tables — supplementary reviewed error codes and approved repair sequences |

Layering: route → controller → service → Prisma. All AI output is advisory;
the backend validates it and decides what is persisted or shown. Full
architecture: `PROJECT_PLAN.md` §3–§9. Backend conventions and env table:
`fixit-backend/CONTEXT.md` (sections before the Phase 2C + 2D note predate it).

## 3. Product requirements (summary; details in PROJECT_PLAN.md)

- Arbitrary household appliances; no hardcoded category list. A new appliance
  may have a null category; the backend never invents one.
- Diagnosis requires **brand** and **symptoms**; model number and error code
  are optional.
- Manual entry and sticker scanning converge on the **same diagnosis API**
  (`POST /diagnosis`).
- Conversational, stepwise diagnosis with manageable questions.
- Distinguish confirmed facts from possibilities. Never invent model-specific
  facts, repair instructions, codes, parts, compatibility, availability or
  prices.
- Safety is enforced in the backend, not only in prompts. Immediate hazards
  bypass research and Gemini and return backend-written guidance.
- Separate safe user checks, professional repairs and dangerous procedures.
- Preserve existing knowledge-base data and functionality (KB tables,
  `searchErrorCodes`, `getApprovedRepairSequence`, KB tools, citations,
  `errorCodeId` linkage, `find_replacement_parts`).

## 4. Diagnosis outcomes

| Outcome | Meaning |
| --- | --- |
| `NEEDS_CLARIFICATION` | More information needed. Also the forced-tool fallback and the downgrade for unsupported readiness claims. |
| `NEEDS_MODEL_NUMBER` | A model-specific step (e.g. parts) needs a trusted model. |
| `READY_FOR_CONFIRMATION` | Meaningful safe troubleshooting (KB steps, new troubleshooting steps) or a user-reported resolution; a single-use challenge lets the user confirm. |
| `FIXED` | **Only** after explicit user confirmation via `POST /diagnosis/:id/confirm`. Gemini can never set it. |
| `NEEDS_PART` | Evidence-based replacement tied to a trusted model and a named, non-restricted component. Parts candidates never justify a replacement. |
| `TECHNICIAN_REQUIRED` | Professional work is required, or a hazard is active. |
| `UNRESOLVED` | Model concluded no further progress is possible. |

After "that didn't work", only *new* steps can produce a new challenge.

## 5. Backend status

### Implemented, committed

| Commit | Work |
| --- | --- |
| `15ccfeb`–`be43d81` | Express backend, auth, diagnosis session APIs, appliance CRUD, Gemini diagnosis integration, KB |
| `9938805` | App shell and **error-code display OCR** (`POST /ocr/error-code`, see §7) |
| `9bb1e4a`, `85d4a45`, `88e347a`, `91879cd` | Appliance API and screens, username login, auth UI |
| `e0f54d7` | Phase 1: general appliance input (nullable category, optional error code, inline appliance + session creation, ownership and idempotency) |
| `2852780` | Phase 2B: allowlisted Groq research service (disabled by default, sanitised, tiered, bounded) |

### Implemented, tested, approved — not yet committed: Phase 2C + 2D

- **Turn flow** (`diagnosis.service.ts`): ownership/replay → trusted identity →
  backend hazard check (skips research and Gemini) → one bounded research call
  or cache reuse → KB lookups → Gemini → backend policy → existing conditional
  transaction.
- **Research integration:** key = SHA-256 of brand, trusted model, persisted
  session error code, symptom hash and a classification version. Cached in
  `context.research` (summary in `metadata.research`); `UNAVAILABLE` retried
  next turn. Single attempt, `RESEARCH_TIMEOUT_MS` (default 8000), no retry.
- **Evidence tiers:** `MANUFACTURER_CONFIRMED` needs the reviewed brand →
  official-domain mapping (`src/utils/manufacturerDomains.ts`); another brand's
  site is at most `WEAK`; official info without exact model is
  `THIRD_PARTY_SUPPORTED`.
- **Safety** (`src/services/ai/safety.ts`, wired in `orchestrator.ts`):
  - Categories: `GAS`, `FIRE_SMOKE`, `ELECTRICAL`, `REFRIGERANT`,
    `WATER_ELECTRICAL`, `UNVERIFIED_HAZARD`, `UNSAFE_REQUEST`,
    `UNSAFE_MODEL_INSTRUCTION`. Backend-written, composed responses (breaker
    isolation with electrical/water hazards, never "unplug"; no switch/plug
    advice with gas).
  - Gas detection by co-occurrence (gas term near smell/hiss/leak, damaged or
    disconnected gas hardware), not fixed phrases.
  - High-risk subjects (capacitors, microwave HV/internals, magnetron, gas
    hardware, thermal fuses/TCOs/limiters, mains wiring) blocked in any
    actionable user or model wording; prohibitions, warnings, technician
    referrals and approved safe checks are kept. An unsafe model draft
    replaces the whole turn (no steps, challenge, facts or parts persisted).
  - Restricted components (incl. every microwave internal part; only a small
    user-serviceable microwave allowlist) never reach `NEEDS_PART` or the
    parts provider.
  - Physical hazards are sticky; dangerous requests are refused in-turn and
    open a subject-scoped restricted follow-up window of 6 USER turns
    (`SAFETY_FOLLOW_UP_USER_TURNS`, never below 6). Hypothetical hazard
    questions are not reports (gas hypotheticals get gas guidance, not
    persisted). Corrupt safety context fails closed (`UNVERIFIED_HAZARD`).
  - Wet conditions: plug advice replaced by breaker guidance; KB sequences
    that say to unplug are withheld for that turn.
- **Outcome policy and guards** (`orchestrator.ts`): `READY_FOR_CONFIRMATION`
  gate; `NEEDS_PART` evidence rules (PROJECT_PLAN §7); manufacturer-claim
  guard; part-number guard on every user-visible field; unverified part
  numbers never persisted.
- **API:** `TurnDto` / message metadata gain optional `troubleshooting`,
  `research`, `safety`; tool gains `troubleshootingSteps`. OpenAPI and
  `.env.example` updated. **No DB migration** (state in JSON `context` /
  `metadata`).

### Approval record (Phase 2C + 2D)

- Four independent review/remediation cycles, then a final independent Opus
  review: **no reproducible critical safety failure or material bypass** in gas
  detection, dangerous model instructions, microwave parts restrictions, or
  follow-up restrictions / hazard questions.
- Verified results (DB-free): `npm test` **1,872 passed, 38 files**;
  `npm run typecheck` pass; `npm run typecheck:test` pass. `npm run build`
  passed in the implementation pass but was **not rerun** in the final review.
- Final review modified no files, ran no DB operations and made no live
  provider calls.
- **User approval: APPROVED.** Git checkpoint awaits explicit user approval of
  the file list (section 8).

### Known limitations (non-blocking)

- **Microwave context can expire (targeted follow-up).** `isMicrowaveContext`
  (`orchestrator.ts:109`) reads only the current turn, the bounded Gemini
  history and the restriction-window USER turns — not persisted session
  context or `session.symptom`. After enough turns, a microwave's bare "main
  fuse" (or other internal part) may no longer be restricted, so an unsafe
  parts recommendation becomes possible. Fix: derive microwave context from
  persisted data (session symptom / appliance / a sticky context flag) and add
  a long-session regression test. Do not expand into a new audit.
- **Live behaviour unverified.** No live Gemini/Groq call; unknown whether
  Gemini reliably fills `troubleshootingSteps` or how research tiers
  distribute on real results. No end-to-end run yet.
- **Manufacturer domain mapping needs human review** before production
  (e.g. `global.sharp`, `sharpusa.com`, `bosch.com`). Unmapped brands never
  reach `MANUFACTURER_CONFIRMED`.
- **Safety detection is pattern-based and conservative.** Known false
  positives: "fridge smells like rotten eggs" → gas; "my gas oven smells
  funny" → sticky gas; "How do I turn off the gas?" refused; "To discharge the
  capacitor safely, call a technician" blocked; pronoun carry-over
  over-restricts. Known false negatives: descriptive instructions with no
  known verb/directive ("Owners usually tackle the thermal fuse."); gas
  mention two sentences from the smell; "What if it sparks?" while sparking.
- **Product decisions to revisit:** door switches/interlocks and breakers are
  never offered as DIY parts; "inverter board" restricted for all appliances;
  physical hazards are sticky for the whole session with no clearing.
- **Parts worst-case latency** 20 s by default ((1 + `GROQ_MAX_RETRIES`) ×
  `PARTS_TIMEOUT_MS`).
- **`fixit-backend/CONTEXT.md`** predates Phase 2C + 2D in most sections; a
  full documentation pass is outstanding.

### Not implemented

- Sticker OCR for brand/model (next phase).
- Frontend diagnosis chat rendering of `troubleshooting`, parts, research
  tiers, safety responses and fix challenge (confirm/complete).
- Production knowledge promotion, review audit records, distributed rate
  limiting, streaming.

## 6. API surface (current)

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/...` | Auth (email/username login, signup, tokens) |
| `GET/POST/PATCH/DELETE /appliances[/:id]` | Owned appliances |
| `POST /diagnosis` | Create session: exactly one of `applianceId` or `brand` (+ optional `modelNumber`), optional `errorCode`, required `symptom` |
| `GET /diagnosis`, `GET /diagnosis/:id`, `GET /diagnosis/:id/messages` | Read sessions/messages |
| `POST /diagnosis/:id/messages` | Diagnosis turn |
| `POST /diagnosis/:id/confirm` | User confirms fix challenge → `FIXED` |
| `POST /diagnosis/:id/complete` | Complete session |
| `POST /ocr/error-code` | Error-code display OCR (existing; not sticker OCR) |
| `/docs` | OpenAPI / Swagger, only when `ENABLE_API_DOCS=true` |

Verify against `src/routes/*.ts` and `src/docs/openapi.ts` before relying on
details.

## 7. NEXT PHASE — Appliance sticker OCR

**Goal:** the user photographs (camera) or picks (gallery) an appliance
rating/model sticker; the backend extracts identifying fields; the user
reviews and corrects them; the result feeds the **same** `POST /diagnosis`
input as manual entry.

### What already exists (verified 2026-11-28 — inspect before building)

- Backend `POST /ocr/error-code` (`routes/ocr.routes.ts`,
  `controllers/ocr.controller.ts`, `services/appliance-scan.service.ts`,
  `types/ocr.dto.ts`): **reads an error code from a display**, not a sticker.
  Local `tesseract.js` (v7) OCR, statuses `DETECTED` / `AMBIGUOUS` /
  `UNREADABLE`, advisory only.
- Upload middleware `middleware/upload.ts` (`multer`): single `image` field,
  JPEG/PNG/WebP, 5 MB max, magic-byte signature check, unpredictable temp-file
  name in OS temp dir, file deleted after every attempt. Auth required;
  rate-limited (`RATE_LIMIT_AUTH_MAX`).
- Tests: `tests/http/ocr.routes.test.ts`,
  `tests/services/appliance-scan.service.test.ts`,
  `tests/docs/ocr.openapi.test.ts`, `tests/dependencies/tesseract.test.ts`.
- Frontend `src/app/(app)/scan.tsx`: `expo-camera` capture and
  `expo-image-picker` gallery pick with preview/retake. **No upload, no
  review form, no link to diagnosis yet** ("Use this photo" is a TODO).
  `src/components/home/ScanHero.tsx` is the Home entry point.

### Not decided

- Sticker OCR provider/approach is **not selected** in project files. Do not
  assume one. Options to evaluate with the user: reuse the existing local
  Tesseract pipeline vs. a vision-capable model already in the stack. Prefer
  reusing existing dependencies and the existing upload middleware.

### Requirements

- Extract brand, model number and other useful identifiers (e.g. serial,
  appliance type) when legible.
- Never invent values; return uncertain or missing fields explicitly (per-field
  status/candidates, similar to the error-code DTO).
- User can correct every field before diagnosis; symptoms are still required.
- Manual entry and OCR converge on the same diagnosis API; no parallel flow.
- Secure, validated upload; handle invalid type, oversized file, corrupt
  image, unreadable sticker and extraction failure with clear errors.
- Do not persist uploaded images unless a decision is made to do so.
- Preserve existing architecture; avoid new dependencies or redesign unless
  justified and approved.
- OCR is **not complete** until implemented, tested (extraction + error
  cases) and integrated into the diagnosis flow on the frontend.

### First steps for the next session

1. Read `AGENTS.md`, `PROJECT_PLAN.md`, this file; confirm branch/HEAD and that
   the Phase 2C + 2D checkpoint was committed (if not, ask the user).
2. Inspect `routes/ocr.routes.ts`, `middleware/upload.ts`,
   `services/appliance-scan.service.ts`, `types/ocr.dto.ts`,
   `validators/diagnosis.validator.ts`, `docs/openapi.ts`,
   `src/app/(app)/scan.tsx`, `src/app/(app)/appliances/new.tsx` and the
   Expo SDK 58 docs for `expo-camera` / `expo-image-picker` / upload.
3. Propose a short plan (endpoint shape, DTO, provider choice, frontend review
   screen, tests) and get user approval before implementing.

## 8. Backend completion sequence (after OCR)

1. Finish OCR implementation.
2. Test OCR extraction and error cases.
3. Integrate OCR with diagnosis.
4. Verify manual-entry and sticker-scan flows.
5. Freeze and document API contracts.
6. Run the backend locally in a test environment.
7. Real HTTP/API testing with `curl` and realistic sample data.
8. Test validation, error responses, safety cases, outcomes and confirmation.
9. Verify OpenAPI matches actual endpoints.
10. Fix genuine integration failures.
11. User approval for the final backend checkpoint.

No production DB operations or live external provider calls without explicit
authorisation. The microwave-context follow-up (§5) should be fixed before
step 11.

## 9. Git state and pending checkpoint

- Branch `feat/backend-setup`, HEAD `2852780`. Phase 2C + 2D is entirely in
  the working tree (tracked modifications + untracked new files).
- **Phase 2C + 2D files** (proposed checkpoint):
  - Modified: `fixit-backend/.env.example`, `fixit-backend/CONTEXT.md`,
    `src/config/env.schema.ts`, `src/docs/openapi.ts`,
    `src/services/ai/orchestrator.ts`, `src/services/ai/prompt.ts`,
    `src/services/ai/tool-definitions.ts`, `src/services/diagnosis.service.ts`,
    `src/services/groq.service.ts`, `src/services/parts.service.ts`,
    `src/services/research.service.ts`, `src/types/diagnosis.dto.ts`,
    `src/validators/ai.validator.ts`, `src/validators/research.validator.ts`,
    and tests `config/env`, `docs/openapi.contract`,
    `services/{ai-tool-schema, diagnosis.service, groq.service, orchestrator,
    parts.service, prompt, repair-resolution, research.service}`.
  - New: `src/services/ai/safety.ts`, `src/utils/manufacturerDomains.ts`,
    tests `http/diagnosis-turn.routes`, `services/{diagnosis-research,
    orchestrator-policy, safety}`, `utils/manufacturerDomains`,
    `validators/ai-context.validator`.
  - Docs: `CURRENT_STATUS.md`, `PROJECT_PLAN.md` (new at repo root).
  (Paths under `src/`/`tests/` are relative to `fixit-backend/`.)
- **Unrelated working-tree changes — preserve, do not include:**
  `.claude/settings.json`, `AGENTS.md`, `app.json`,
  `assets/images/fixit-auth-mark.png`, `assets/images/fixit-auth-wordmark.png`.

## 10. Workflow rules for every session

- Read `AGENTS.md`, `PROJECT_PLAN.md`, `CURRENT_STATUS.md` first.
- Small, controlled phases; prefer working end-to-end functionality over
  endless polishing.
- Sonnet may implement; Opus independently reviews important work. Do not
  restart completed reviews without a demonstrated reason.
- **Never stage or commit without explicit user approval.** Never use
  `git add .` / `git add -A`; stage explicit paths only. Never push, reset,
  amend or discard without approval.
- Never read real `.env` files or expose secrets.
- Never run migrations, seeds, `npm run test:db` or live provider calls without
  separate explicit authorisation.
- Preserve unrelated working-tree changes.
- Report actual results; never claim a test ran if it did not.
- Backend checks (from `fixit-backend/`): `npm test` (DB-free Vitest),
  `npm run typecheck`, `npm run typecheck:test`, `npm run build`. Frontend:
  `npx expo lint`, `npx tsc --noEmit`. Use `npx expo install` for Expo
  packages and read the SDK 58 versioned docs first.
- Update this file at each milestone by **replacing** stale content; keep it
  under 500 lines.
