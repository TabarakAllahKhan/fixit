# Fix-It — Project Plan

Long-term source of truth for intended product behaviour and architecture.
Operational progress lives in `CURRENT_STATUS.md`; coding conventions live in
`AGENTS.md` and `fixit-backend/CONTEXT.md`. Update this file only when approved
requirements or architecture change.

## 1. Product purpose

Fix-It helps people troubleshoot household appliances (any type, not only
washing machines) through a guided, safety-first conversation. Users get
specific troubleshooting steps they can safely do themselves. When that is not
enough, they get an honest outcome: a likely replacement part, a recommendation
to call a technician, or a clarifying question.

## 2. Diagnosis input

| Field | Required |
| --- | --- |
| Brand | Yes |
| Model number | No |
| Error code | No |
| Problem description / symptoms | Yes |

Two input paths feed the **same** diagnosis API:

1. **Sticker scan.** Capture (camera) or pick (gallery) a photo of the
   appliance sticker, extract brand, model number and other identifying
   fields without inventing uncertain values, let the user review and correct
   them, then collect symptoms. *(Sticker OCR not yet implemented; it is the
   next phase. The existing `POST /ocr/error-code` endpoint only reads error
   codes from a display.)*
2. **Manual entry.** The user types the brand, optional model number, optional
   error code and symptoms.

Appliances can be created inline when a session is created. A new appliance
may have a null category; the backend never invents a category.

## 3. System architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Mobile app | React Native, Expo Router, TypeScript | Input flows, diagnosis chat UI, confirmation and completion actions |
| API | Express 5, TypeScript, Zod | Auth, ownership, validation, idempotency, policy enforcement |
| Database | PostgreSQL, Prisma 7 | Users, appliances, sessions, messages, knowledge base |
| Diagnosis reasoning | Gemini (bounded tool loop) | Conversational troubleshooting and proposed outcome |
| External research | Groq browser search | One bounded, optional evidence lookup per turn |
| Knowledge base (KB) | PostgreSQL tables | Reviewed error codes and approved, user-safe repair sequences |

Layering is route → controller → service → Prisma. All AI output is advisory:
the backend validates it and decides what is persisted or shown.

## 4. Diagnosis turn flow

1. Validate request, ownership and replay/idempotency.
2. Resolve trusted appliance identity (fresh appliance row and USER messages
   only; AI text is never an identity source).
3. Check for immediate hazards (backend classifier). Physical hazards stay
   active for the rest of the session; a request for dangerous work is
   refused in the turn it is made.
4. On a hazard: skip research and Gemini, and return a backend-written,
   category-specific safety response with `TECHNICIAN_REQUIRED`.
5. Otherwise, run one bounded Groq research call if research is enabled.
   Reuse cached research when the research key is unchanged.
6. Run the existing KB lookups.
7. Run the Gemini tool loop with research passed in as untrusted evidence.
8. Apply backend outcome validation, safety restrictions and evidence rules.
9. Persist the turn, the research summary and the updated context in the
   existing conditional transaction.

There is deliberately one research step followed by the existing Gemini flow.
There are no agent loops or duplicate decision layers.

## 5. Responsibilities

- **Gemini:** troubleshooting conversation, safe checks, clarifying questions,
  and a proposed outcome through `submit_diagnosis_outcome`. It cannot set
  identity, verdicts, compatibility or `FIXED`.
- **Groq research:** finds external documentation for the trusted brand,
  trusted model, the session's user-entered error code and the symptom. Results
  are sanitised, bounded, allowlisted, and treated as untrusted data. They
  cannot override instructions, identity, safety or outcome validation.
- **Knowledge base:** authoritative, reviewed repair sequences. A sequence is
  returned only when the code, every link and every step are approved and
  user-safe, with an exact scope match. KB tools, citations and `errorCodeId`
  linkage are preserved. No category is invented to reach KB content.
- **Safety system:** backend-enforced. It classifies `GAS`, `FIRE_SMOKE`,
  `ELECTRICAL`, `REFRIGERANT`, `WATER_ELECTRICAL`, `UNVERIFIED_HAZARD`,
  `UNSAFE_REQUEST` and `UNSAFE_MODEL_INSTRUCTION`. Responses are
  backend-written and category-specific. Safety rules:
  - A possible gas leak is recognised from natural wording, not fixed
    phrases: a gas term near a smell / hiss / leak / escape term, gas hardware
    reported loose, broken, removed or disconnected, or "the gas" reported
    disconnected. It always gets the backend gas response with no provider
    call. The word "gas" alone (a gas oven that will not heat) is not a leak.
  - High-risk subjects (capacitors, the microwave high-voltage section and
    internals, magnetrons, gas hardware and connections, thermal fuses, TCOs
    and limiters, live / neutral / mains wiring) are blocked in any
    actionable model or user wording whatever the verb (imperatives,
    "you should ...", "how do I ...", tool phrases, passive instructions,
    self-encouragement). Prohibitions, warnings, technician referrals and
    approved safe observations (such as watching an igniter glow) are kept.
  - Physical hazards are sticky across turns. Requests for dangerous work and
    unsafe model drafts are handled in their own turn and are not persisted.
    A hazard named only in a general or hypothetical question ("Is there a
    risk of shock when cleaning the filter?", "What if it sparks?") is not a
    report and is answered normally; a gas question of that kind gets the gas
    guidance for that turn but is not persisted. A hazard reported in a
    question ("Is it normal that it smells like gas?") is a report.
    For the next six user turns after a refused request (configurable
    upwards with `SAFETY_FOLLOW_UP_USER_TURNS`, never below six, and
    independent of the Gemini history limit), the session is in a restricted
    follow-up mode for that subject only: follow-ups pointing back at the
    procedure (including shorthand such as "posts", "the fitting", "what
    wrench size?", and pronoun or procedure-detail questions with no topic
    of their own such as "How long do I hold it?") are refused, model
    instructions about the subject (or whose only object is a pronoun) are
    blocked, and no fix challenge, part or parts candidate is offered for it.
    A generic follow-up ("What next?") is answered by the model under these
    output rules, without a fix challenge. Unrelated topics, and safe
    external operations such as resetting a breaker, continue normally.
  - A report of completed work that leaves a hazard behind (an opened
    appliance, a bypassed interlock, a shorted capacitor, a disconnected gas
    line) followed by any request is refused; a jumpered or bypassed safety
    device is refused even without a request; a disconnected or damaged gas
    connection is also a `GAS` hazard.
  - A negation cancels a hazard only when it directly governs the hazard
    phrase ("no smoke"), not when it negates something else ("won't stop
    smoking").
  - Facts and suspected components from a blocked model draft are never
    persisted.
  - Persisted safety state that cannot be read back fails closed
    (`UNVERIFIED_HAZARD`); it is never silently discarded.
  - Combined hazards get one consistent response. When an electrical or
    water hazard is present, power is isolated at the circuit breaker, never
    by touching the plug; with gas, no switch or plug advice is given.
  - When the user reports a leak or wet floor, advice to touch or pull the
    plug is replaced with circuit-breaker guidance. This applies to
    knowledge-base steps too: a KB sequence that says to unplug is withheld for
    that turn (the KB record itself is unchanged).
  - Safe, documented external operations (resetting a breaker, checking that a
    door is latched, listening for the compressor) are distinguished from
    invasive work (opening panels, testing live circuits, bypassing interlocks,
    microwave high-voltage parts).
  - When in doubt, the classifier restricts.

## 6. Evidence and manufacturer verification

| Tier | Meaning |
| --- | --- |
| `MANUFACTURER_CONFIRMED` | Official domain of the appliance's own manufacturer, exact trusted model match, directly relevant, not contradicted |
| `THIRD_PARTY_SUPPORTED` | Credible technical reference with exact model support, or exact error-code support on a page about this brand and no other; or official manufacturer information without exact-model confirmation |
| `WEAK` | Background or incomplete evidence. It may suggest possibilities and general safe checks, but never model-specific claims |
| `INSUFFICIENT` / `UNAVAILABLE` | No usable evidence. Continue with safe checks or clarifying questions |

Manufacturer status comes only from a reviewed brand → official-domain mapping.
For example, a Samsung page is never the manufacturer of an LG appliance. An
unmapped brand cannot reach `MANUFACTURER_CONFIRMED`. Citations carry their
evidence tier. A backend guard removes any claim that manufacturer
documentation confirms something when no valid manufacturer evidence exists.

## 7. Diagnosis outcomes

- `NEEDS_CLARIFICATION`: more information is needed. This is also the outcome
  of the forced-tool fallback.
- `NEEDS_MODEL_NUMBER`: a model-specific step (for example, parts) needs a
  trusted model.
- `READY_FOR_CONFIRMATION`: meaningful, safe troubleshooting (or a justified
  resolution) was provided, all safety checks pass, and nothing is blocking. A
  backend-issued single-use challenge is attached.
- `FIXED`: only after the user explicitly confirms the challenge. Gemini can
  never set it.
- `NEEDS_PART`: a replacement is justified by evidence about the named
  component, and a trusted model is known. Parts candidates establish
  compatibility only and never justify a replacement. Failed safe checks count
  only when a step of the most recent troubleshooting round involved the same
  component. Research evidence needs at least one troubleshooting round,
  unless the user reports damage to the component or the meaning of a trusted
  KB error code that the user reported (the session's code or the user's own
  messages) names it. A generic component name ("pump", "motor") never
  justifies a replacement, and a name made only of generic words ("pump
  motor") must match that exact component, not a more specific one
  ("circulation pump motor").
- `TECHNICIAN_REQUIRED`: professional work or a hazard.
- `UNRESOLVED`: the model concluded no further progress is possible.

If a user reports that a step did not work, the result is a new diagnostic
decision, not a repeat of the same confirmation challenge.

## 8. Troubleshooting and replacement-parts principles

- Prefer safe checks and cleaning before recommending replacement.
- Restricted components (microwave high-voltage parts including inverter
  boards, capacitors, thermal and safety devices including TCOs and thermal
  limiters, gas hardware including gas control/safety and burner valves, the
  sealed refrigeration system, mains-level wiring, safety interlocks including
  door switches and any assembly that may contain one) are never recommended
  for user replacement. This includes every microwave internal part (HV
  diode, internal / ceramic fuses, transformer, primary / secondary /
  monitor switches, interlocks, inverter and control boards); for a
  microwave, only user-serviceable parts (turntable and its supports,
  filters, waveguide cover, racks, knobs, handles, mounting kits) may be
  offered. Such a proposal becomes a professional-repair outcome with no
  parts candidates.
- Part numbers come only from a trusted source or a KB record. Never invent
  prices, stock or compatibility.
- Compatibility levels: `VERIFIED`, `POSSIBLE_MATCH`, `UNKNOWN`. When
  compatibility is unverified, say so and recommend professional verification.
- Parts lookups use allowlisted URLs and have a configurable timeout.
- There is no e-commerce or affiliate system.

## 9. Approved architectural decisions

- Gemini is the diagnosis provider. Groq is used only for optional parts
  discovery and optional research. Both are disabled by default.
- Research runs once per turn, with no Groq retry and an 8000 ms default
  timeout. Results are cached in session context by research key and
  re-attempted after an `UNAVAILABLE` result.
- Research uses the persisted, user-entered session error code. It never
  infers codes from free text.
- A corrupt optional research cache never resets trusted appliance identity.
- No database migrations are made unless a concrete blocker requires one.
  JSON context and metadata columns hold the new state.

## 10. Deferred features and future direction

- **Next phase:** sticker OCR (brand/model extraction, validated upload,
  review and correction, same diagnosis API). Provider/approach not yet
  selected.
- Full frontend diagnosis chat: messages, troubleshooting steps, parts,
  research evidence and fix challenges.
- Human review of manufacturer-domain mappings before production use.
- Production knowledge promotion and review audit records.
- Distributed rate limiting, streaming responses.

## 11. Delivery phases

| Phase | Scope | State |
| --- | --- | --- |
| 1 | General appliance input | Approved, committed (`e0f54d7`) |
| 2B | Allowlisted Groq research service | Approved, committed (`2852780`) |
| 2C + 2D | Research integration, backend safety, outcome gate, evidence guards | Approved by user after independent review (2026-11-28) |
| 3 | Sticker OCR | Next |
| 4 | Backend contract freeze, local HTTP verification, final backend checkpoint | Planned |

Current progress, checkpoint state and known limitations: `CURRENT_STATUS.md`.
