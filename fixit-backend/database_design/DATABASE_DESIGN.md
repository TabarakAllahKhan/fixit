> **Update 2026-11-14:** email/password authentication is implemented. `User` has
> `email`, `username`, `passwordHash` and `updatedAt`, and a `RefreshToken` model stores
> hashed, rotating refresh tokens grouped by `familyId` for replay detection. Password
> change rehashes the password and revokes every active refresh token for the user. The
> anonymous-token discussion further down is kept as historical design context.
>
> **Update 2026-11-16 (Phase 1):** `Verdict` is now
> `FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED`; the migration renames
> `CALL_TECHNICIAN` to `TECHNICIAN_REQUIRED` in place and adds `UNRESOLVED`.
> `DiagnosisSession` now persists a server-managed, single-use `FIXED` confirmation
> challenge via `fixConfirmationChallengeId`, `fixConfirmationIssuedAt`, and
> `fixConfirmationExpiresAt`. The migration
> `20261116093023_verdict_pending_confirmation` was generated, reviewed, and applied to the
> development branch on 2026-11-16; `prisma migrate status` now reports the schema up to date.

erDiagram
    %% ============================================================
    %% Fixit database design (revised) - 8 models
    %% Relationship notation: ||  exactly one | |o  zero or one | o{  zero or many
    %% Nullable fields are marked "nullable" in the attribute comment.
    %% ============================================================
    %% Enums (stored as Postgres enums; values may be added by later migrations)
    %%   ApplianceCategory : WASHING_MACHINE, REFRIGERATOR
    %%   SourceKind        : MANUAL, MANUFACTURER_PAGE, OTHER, TEST_FIXTURE
    %%   ReviewStatus      : UNREVIEWED (default), APPROVED, REJECTED
    %%   SafetyClass       : USER_SAFE, TECHNICIAN_ONLY
    %%   Difficulty        : EASY, MODERATE, HARD
    %%   SessionStatus     : OPEN (default), COMPLETED, ABANDONED
    %%   Verdict           : FIXED, NEEDS_PART, TECHNICIAN_REQUIRED, UNRESOLVED
    %%   MessageRole       : USER, ASSISTANT

    %% ---------------- Relationships ----------------
    %% Deleting a User deletes their Appliances and DiagnosisSessions (cascade)
    User ||--o{ Appliance : owns
    User ||--o{ DiagnosisSession : starts
    User ||--o{ RefreshToken : authenticates
    %% Session.applianceId is optional; deleting an Appliance sets it to NULL
    Appliance |o--o{ DiagnosisSession : "is diagnosed in"
    %% Session.errorCodeId is optional; an ErrorCode in use cannot be deleted (restrict)
    ErrorCode |o--o{ DiagnosisSession : "is identified in"
    %% Deleting a DiagnosisSession deletes its Messages (cascade)
    DiagnosisSession ||--o{ Message : contains
    %% Source is required on every ErrorCode and RepairStep; a Source in use cannot be deleted (restrict)
    KnowledgeSource ||--o{ ErrorCode : documents
    KnowledgeSource ||--o{ RepairStep : documents
    %% ErrorCode and RepairStep are many-to-many through the join model ErrorCodeRepairStep (join rows cascade)
    ErrorCode ||--o{ ErrorCodeRepairStep : lists
    RepairStep ||--o{ ErrorCodeRepairStep : "is used by"

    %% ---------------- Models ----------------
    User {
        uuid id PK
        string email UK
        string username UK
        string passwordHash
        datetime createdAt
        datetime updatedAt
    }

    %% Opaque refresh tokens are stored as SHA-256 hashes, never plaintext.
    %% Every token created by one login/rotation chain shares a familyId.
    RefreshToken {
        uuid id PK
        uuid userId FK
        uuid familyId "shared across rotations"
        string tokenHash UK
        datetime expiresAt
        datetime revokedAt "nullable"
        datetime createdAt
    }

    Appliance {
        uuid id PK
        uuid userId FK
        ApplianceCategory category
        string brand
        string modelNumber "nullable"
        string nickname "nullable"
        datetime createdAt
        datetime updatedAt
    }

    KnowledgeSource {
        uuid id PK
        string title
        SourceKind kind
        string url "nullable"
        string edition "nullable"
        datetime capturedAt
        datetime createdAt
        datetime updatedAt
    }

    %% ErrorCode composite UNIQUE: (category, brand, code, modelScope); source is NOT part of the key
    ErrorCode {
        uuid id PK
        uuid sourceId FK
        ApplianceCategory category UK "unique together with brand, code, modelScope"
        string brand UK "unique together with category, code, modelScope"
        string code UK "unique together with category, brand, modelScope"
        string modelScope UK "required; UNSPECIFIED if unknown; part of unique key"
        string meaning
        ReviewStatus reviewStatus "default UNREVIEWED"
        datetime createdAt
        datetime updatedAt
    }

    RepairStep {
        uuid id PK
        uuid sourceId FK
        string instruction
        SafetyClass safetyClass
        Difficulty difficulty "nullable"
        ReviewStatus reviewStatus "default UNREVIEWED"
        datetime createdAt
        datetime updatedAt
    }

    %% ErrorCodeRepairStep composite PRIMARY KEY: (errorCodeId, repairStepId)
    %% ErrorCodeRepairStep composite UNIQUE: (errorCodeId, position) - one step per position within an error code
    ErrorCodeRepairStep {
        uuid errorCodeId PK, FK "composite PK with repairStepId"
        uuid repairStepId PK, FK "composite PK with errorCodeId"
        int position "unique within errorCodeId"
        ReviewStatus reviewStatus "default UNREVIEWED"
    }

    DiagnosisSession {
        uuid id PK
        uuid userId FK
        uuid applianceId FK "nullable"
        uuid errorCodeId FK "nullable"
        string symptom "nullable"
        SessionStatus status "default OPEN"
        Verdict verdict "nullable"
        string fixConfirmationChallengeId "nullable, server-managed"
        datetime fixConfirmationIssuedAt "nullable, server-managed"
        datetime fixConfirmationExpiresAt "nullable, server-managed"
        datetime createdAt
        datetime updatedAt
    }

    Message {
        uuid id PK
        uuid sessionId FK
        MessageRole role
        string content
        datetime createdAt
    }


1. UUID strategy

Yes, uuid(7) generates real UUID v7 in Prisma 7.10.1. @default(uuid(7)) is valid and has been since Prisma 5.18. The release notes say the only valid arguments are 4 and 7, with 4 as the default. A plain uuid() gives v4. My offline schema check accepted uuid(7). I couldn’t run the engine, so the generated values themselves are unverified until your first insert, which I’ll check (see below). 
github

Where the ID gets generated. Prisma’s uuid() is only generated when you create the row through Prisma Client. Postgres itself has no default for it. For us that means: 
prisma

Every insert made by our app gets an ID automatically.
An insert made another way, such as a SQL import or the Neon console, must supply its own ID. When we bulk-load knowledge data, we’d use a Prisma script, or have the SQL call gen_random_uuid() explicitly.
Prisma 8 renames this syntax, to @onCreate(uuid(7)), and its upgrade guide ships a script that rewrites schemas. We’re pinning 7.10.1, so that only matters if we upgrade. 
prisma

A correction to what I said earlier. I called v7 IDs hard to guess. They are, since most of the bits are random, but they embed the creation time, so an ID reveals when its row was made. That’s harmless for our tables. It’s also another reason IDs must never act as credentials, as in the token design in point 3.

Recommendation: keep @id @default(uuid(7)) @db.Uuid.

@db.Uuid makes Postgres store a native UUID instead of text.
v7 IDs sort by creation time, which keeps the primary-key index tidy and makes ID-based paging chronological. At MVP size that benefit is small, and it costs nothing extra.
If you’d rather have the plainest option, @default(uuid()) (v4) is equally reliable and has no timestamp in the ID. Either is a one-line change, and I’d call this a coin flip.

I’d verify it right after the first insert. The first character of the third group of the ID should be 7. If it’s 4, we switch to the fallback.

2. Resetting review status when approved records change

Confirmed as a design rule. It’s not implemented, and neither the Prisma schema nor the database enforces it by itself. Only one part is database-enforced: a new row starts as UNREVIEWED by default.

The rule:

What changes	What resets to UNREVIEWED
An ErrorCode’s category, brand, code, model scope, meaning or source	The code and its links
A RepairStep’s instruction, safety class, difficulty or source	The step and its links
A link’s position, or a link is added or removed	The link, and for a removed or added link, the code too
Only reviewStatus changes (an approval or rejection)	Nothing resets

I’m resetting the links too, because they were reviewed against the old wording. I’m also adding one new retrieval rule: an error code returns steps only if every one of its links is approved. Otherwise a missing middle step could leave the user with an incomplete procedure, such as steps 1 and 3.

Where to enforce it:

For the MVP, one knowledge-writing module in the backend. All writes to those three tables go through it, inside a transaction. A separate approve function is the only way to set APPROVED. Tests cover each row of the table above. This fits how the rest of your safety design works: enforcement in code.
Before real safety data and real users, I’d add a database trigger as a second layer, so the rule holds even for edits from the Neon console or an SQL import. Prisma’s docs say features it can’t represent, such as views, go into a migration as custom SQL. A trigger would work the same way, though I haven’t tested that. Triggers add complexity, so I’d wait until the module exists. 
prisma
A Prisma client extension is a third option. I wouldn’t rely on it by itself, because it only sees writes made through that one client.

Who is allowed to approve is still open in your context file. The rule only says approval is a separate, deliberate action.

3. Adding authentication (historical anonymous-user token discussion)

Implemented 2026-11-13 as email/password login with bcrypt hashes and a `RefreshToken`
table. The original notes about an additive token/Credential design are retained below.
The id remains an internal key and is never a credential.

A nullable accessTokenHash column on User. It’s the simplest, but it supports one device per user.
A separate Credential table with userId as a foreign key, plus tokenHash (unique), createdAt, lastUsedAt and revokedAt. This is the one I’d choose. It supports multiple devices, rotation and revocation, and it later holds an email or social login as one more credential on the same user, so account linking needs no redesign.

Either way, the existing tables and relationships stay as they are, because we only add a column or a table with a foreign key to User.id. No existing column changes, and nothing needs backfilling, since no User rows exist yet.

One ordering rule so we don’t strand data: the first endpoint that creates a User should ship together with token issuance. A user created before tokens exist would have no way to authenticate, so nobody could ever read their sessions back.

Final database design summary

The auth update adds one table (`RefreshToken`) and credentials on `User`; the original
three points above added rules and notes only.

Models (9)

Model	Purpose	Key points
User	Owner of data and login account	`email` and `username` unique (stored lowercase), `passwordHash` bcrypt only, timestamps.
RefreshToken	Rotatable login session / token family	`familyId` shared across rotations, `tokenHash` unique (SHA-256), `expiresAt`, optional `revokedAt`, cascades with user.
Appliance	A user’s saved machine	Category and brand required, model number optional. Deleting the user deletes it.
KnowledgeSource	Where a fact came from	Kind includes TEST_FIXTURE. Can’t be deleted while facts use it.
ErrorCode	What a code means	Unique on (category, brand, code, modelScope). modelScope required, UNSPECIFIED if unknown. Source required.
RepairStep	An approved action	Safety class USER_SAFE or TECHNICIAN_ONLY. Source required.
ErrorCodeRepairStep	Ordered steps per code	Composite key (errorCodeId, repairStepId). position unique per code. Own review status.
DiagnosisSession	One troubleshooting conversation	Appliance and error code optional. An error code in use can’t be deleted. Nullable server-managed `fixConfirmation*` fields hold the single-use FIXED confirmation challenge.
Message	A chat message	Belongs to a session and is deleted with it.

Cross-cutting decisions

IDs: native Postgres UUIDs, generated by Prisma as v7.
Review: new rows start UNREVIEWED. Edits reset review in the knowledge-writing module. Retrieval needs the code, every link and the step all approved, plus USER_SAFE.
Safety: retrieval filter, structured Groq output limited to candidate IDs, a re-check before responding, and instruction text taken from the database.
Test data: TEST_FIXTURE sources, a separate dev database, and seed guardrails. No mock data is added yet.
Identity: email/password authentication is implemented. Passwords are bcrypt hashes; access tokens are short-lived HS256 JWTs; refresh tokens are opaque, hashed at rest, rotated on every use, and grouped into families so replaying a used token revokes the whole chain. Password change revokes all active refresh tokens.
Verdicts: final verdicts are FIXED, NEEDS_PART, TECHNICIAN_REQUIRED and UNRESOLVED. FIXED requires a backend-validated, single-use confirmation challenge persisted on the session; the backend alone sets the verdict. Status and verdict remain separate.

Deliberately deferred: appliance model and family tables, a review record (who approved, from what source), diagnosis state tracking, steps for problems without error codes, email verification, password reset, rate limiting, push tokens, subscriptions and image storage. APPROVED is not trustworthy for safety until the review record exists.

Untested until you run it: client generation, migrations on Neon (including the shadow database), the generated client’s import path under our ESM setup, and the v7 check above.

If you approve the design, I’ll start with the install and configuration step (the pinned packages, prisma.config.ts, DIRECT_URL), then the schema file and first migration, then the connection test. Tell me if you want any of the choices changed first, such as plain uuid().