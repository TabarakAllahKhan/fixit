export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FixIt API',
    version: '1.0.0',
    description:
      'HTTP API for the FixIt mobile app and backend diagnosis workflow. Responses use a standard envelope: success `{ "success": true, "data": ... }`, errors `{ "success": false, "error": { "code", "message" } }`. Diagnosis endpoints require a bearer access token. Send messages with a client-generated requestId to get an idempotent Groq-powered turn; approved knowledge, safety checks, parts evidence, verdicts and confirmation remain backend-controlled.',
  },
  servers: [
    {
      url: '/',
      description:
        'Current server. For local device/emulator testing use your LAN IP, e.g. http://<LAN-IP>:3000 (not localhost).',
    },
  ],
  tags: [
    { name: 'Health', description: 'Service health checks' },
    { name: 'Auth', description: 'Authentication and account endpoints' },
    {
      name: 'Diagnosis',
      description:
        'Owner-scoped diagnosis sessions and backend-controlled AI turns. Identity always comes from the access token, never from the request. Workflow: create a session, POST messages with unique requestId values, review returned knowledge/parts/progress, confirm a fix challenge or complete a terminal verdict.',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token JWT. Obtain via /auth/register, /auth/login, or /auth/refresh.',
      },
    },
    parameters: {
      SessionIdParam: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'UUID of the diagnosis session.',
        schema: { type: 'string', format: 'uuid' },
      },
      PageParam: {
        name: 'page',
        in: 'query',
        required: false,
        description: '1-based page number.',
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
      LimitParam: {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Page size. Values above 100 are rejected.',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Human readable error message' },
            },
          },
        },
      },
      HealthData: {
        type: 'object',
        required: ['status', 'database'],
        properties: {
          status: { type: 'string', enum: ['ok'] },
          database: { type: 'string', enum: ['connected'] },
        },
      },
      LivenessData: {
        type: 'object',
        additionalProperties: false,
        required: ['status'],
        properties: { status: { type: 'string', enum: ['ok'] } },
      },
      AuthTokens: {
        type: 'object',
        required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn'],
        properties: {
          accessToken: { type: 'string', description: 'JWT access token (HS256)' },
          refreshToken: { type: 'string', description: 'Opaque refresh token (rotate on use)' },
          tokenType: { type: 'string', enum: ['Bearer'] },
          expiresIn: { type: 'integer', description: 'Access token lifetime in seconds', example: 900 },
        },
      },
      PublicUser: {
        type: 'object',
        description: 'Public user fields returned by the API (never includes passwordHash).',
        additionalProperties: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          username: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthUserTokensData: {
        type: 'object',
        required: ['user', 'tokens'],
        properties: {
          user: { $ref: '#/components/schemas/PublicUser' },
          tokens: { $ref: '#/components/schemas/AuthTokens' },
        },
      },
      AuthTokensData: {
        type: 'object',
        required: ['tokens'],
        properties: {
          tokens: { $ref: '#/components/schemas/AuthTokens' },
        },
      },
      MeData: {
        type: 'object',
        required: ['user'],
        properties: {
          user: { $ref: '#/components/schemas/PublicUser' },
        },
      },
      MessageData: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['email', 'username', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 254,
            description: 'Trimmed and lowercased by the server.',
          },
          username: {
            type: 'string',
            minLength: 3,
            maxLength: 30,
            pattern: '^[a-z0-9._-]+$',
            description:
              'Trimmed and lowercased by the server. Allowed: letters, numbers, dots, underscores, hyphens.',
          },
          password: { type: 'string', minLength: 8, maxLength: 72 },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['password'],
        description: 'Provide either email or username (not both), plus password.',
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          username: { type: 'string', minLength: 3, maxLength: 30, pattern: '^[a-z0-9._-]+$' },
          password: { type: 'string', minLength: 1, maxLength: 72 },
        },
        oneOf: [{ required: ['email'] }, { required: ['username'] }],
      },
      RefreshTokenRequest: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', minLength: 1 },
        },
      },
      ChangePasswordRequest: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1, maxLength: 72 },
          newPassword: { type: 'string', minLength: 8, maxLength: 72 },
        },
      },
      SessionStatus: {
        type: 'string',
        enum: ['OPEN', 'COMPLETED', 'ABANDONED'],
        description: 'Server-controlled lifecycle state. New sessions start OPEN.',
      },
      Verdict: {
        type: 'string',
        enum: ['FIXED', 'NEEDS_PART', 'TECHNICIAN_REQUIRED', 'UNRESOLVED'],
        description: 'Backend-set verdict. Null until a terminal outcome is reached; never accepted from the client.',
      },
      MessageRole: {
        type: 'string',
        enum: ['USER', 'ASSISTANT'],
        description: 'A message turn persists one USER row and one ASSISTANT row with the same requestId.',
      },
      DiagnosisOutcome: {
        type: 'string',
        enum: [
          'NEEDS_CLARIFICATION',
          'NEEDS_MODEL_NUMBER',
          'READY_FOR_CONFIRMATION',
          'NEEDS_PART',
          'TECHNICIAN_REQUIRED',
          'UNRESOLVED',
          'FIXED',
        ],
        description: 'Advisory conversation outcome. Backend policy converts it to the persisted verdict and progress.',
      },
      ModelScope: {
        type: 'string',
        enum: ['UNSPECIFIED', 'TOP_LOAD', 'FRONT_LOAD', 'FRENCH_DOOR_BOTTOM_FREEZER'],
      },
      Compatibility: {
        type: 'string',
        enum: ['VERIFIED', 'POSSIBLE_MATCH', 'UNKNOWN'],
        description: 'Derived by backend evidence rules from controlled search results; never assigned by the AI.',
      },
      CitationDto: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'sourceKind'],
        properties: {
          title: { type: 'string', maxLength: 200 },
          url: { type: 'string', format: 'uri', nullable: true },
          sourceKind: {
            type: 'string',
            enum: ['MANUAL', 'MANUFACTURER_PAGE', 'OTHER', 'TEST_FIXTURE', 'SEARCH_RESULT'],
          },
        },
      },
      ErrorCodeKnowledgeDto: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'code', 'meaning', 'modelScope', 'trusted', 'source'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string', maxLength: 200 },
          meaning: { type: 'string', maxLength: 4000 },
          modelScope: { $ref: '#/components/schemas/ModelScope' },
          trusted: { type: 'boolean', description: 'True only for approved knowledge with confirmed exact scope.' },
          reason: { type: 'string', maxLength: 300 },
          source: { $ref: '#/components/schemas/CitationDto' },
        },
      },
      RepairStepKnowledgeDto: {
        type: 'object',
        additionalProperties: false,
        required: ['position', 'instruction', 'source'],
        properties: {
          position: { type: 'integer', minimum: 1 },
          instruction: { type: 'string', maxLength: 4000 },
          source: { $ref: '#/components/schemas/CitationDto' },
        },
      },
      KnowledgeDto: {
        type: 'object',
        additionalProperties: false,
        required: ['unverified', 'errorCodes', 'repairSteps'],
        properties: {
          unverified: { type: 'boolean' },
          errorCodes: { type: 'array', items: { $ref: '#/components/schemas/ErrorCodeKnowledgeDto' }, maxItems: 10 },
          repairSteps: { type: 'array', items: { $ref: '#/components/schemas/RepairStepKnowledgeDto' }, maxItems: 20 },
          note: { type: 'string', maxLength: 500 },
        },
        description:
          'repairSteps is empty unless a complete approved, user-safe, model-applicable sequence exists. Unreviewed knowledge is development-only.',
      },
      PartCandidateDto: {
        type: 'object',
        additionalProperties: false,
        required: ['partName', 'sourceName', 'url', 'compatibility', 'reason'],
        properties: {
          partName: { type: 'string', maxLength: 200 },
          sourceName: { type: 'string', maxLength: 200 },
          url: { type: 'string', format: 'uri' },
          compatibility: { $ref: '#/components/schemas/Compatibility' },
          reason: { type: 'string', maxLength: 300 },
          partNumber: { type: 'string', maxLength: 64 },
        },
      },
      PartsDto: {
        type: 'object',
        additionalProperties: false,
        required: ['note', 'candidates'],
        properties: {
          note: { type: 'string', maxLength: 500 },
          modelNumberUsed: { type: 'string', maxLength: 80 },
          candidates: { type: 'array', items: { $ref: '#/components/schemas/PartCandidateDto' }, maxItems: 10 },
        },
      },
      DiagnosisProgressDto: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'verdict', 'outcome'],
        properties: {
          status: { $ref: '#/components/schemas/SessionStatus' },
          verdict: { nullable: true, allOf: [{ $ref: '#/components/schemas/Verdict' }] },
          outcome: { $ref: '#/components/schemas/DiagnosisOutcome' },
          followUpQuestion: { type: 'string', maxLength: 1000 },
          fixChallenge: {
            type: 'string',
            description: 'Single-use challenge issued with READY_FOR_CONFIRMATION; submit to /confirm.',
          },
          fixChallengeExpiresAt: { type: 'string', format: 'date-time' },
        },
      },
      AssistantMessageMetadataDto: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'requestId', 'progress', 'citations'],
        properties: {
          kind: { type: 'string', enum: ['ASSISTANT_TURN'] },
          requestId: { type: 'string', format: 'uuid' },
          progress: { $ref: '#/components/schemas/DiagnosisProgressDto' },
          knowledge: { $ref: '#/components/schemas/KnowledgeDto' },
          parts: { $ref: '#/components/schemas/PartsDto' },
          citations: { type: 'array', items: { $ref: '#/components/schemas/CitationDto' }, maxItems: 20 },
        },
      },
      SessionDto: {
        type: 'object',
        additionalProperties: false,
        description: 'Ownership, error-code linkage and confirmation fields are never exposed.',
        required: ['id', 'applianceId', 'symptom', 'status', 'verdict', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          applianceId: { type: 'string', format: 'uuid', nullable: true },
          symptom: { type: 'string', nullable: true, maxLength: 2000 },
          status: { $ref: '#/components/schemas/SessionStatus' },
          verdict: { nullable: true, allOf: [{ $ref: '#/components/schemas/Verdict' }] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MessageDto: {
        type: 'object',
        additionalProperties: false,
        description: 'metadata is present on assistant messages produced by the AI diagnosis flow.',
        required: ['id', 'sessionId', 'role', 'content', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          sessionId: { type: 'string', format: 'uuid' },
          role: { $ref: '#/components/schemas/MessageRole' },
          content: { type: 'string', maxLength: 4000 },
          createdAt: { type: 'string', format: 'date-time' },
          metadata: { $ref: '#/components/schemas/AssistantMessageMetadataDto' },
        },
      },
      TurnDto: {
        type: 'object',
        additionalProperties: false,
        description: 'Atomic user/assistant message pair returned after a new turn or a replayed requestId.',
        required: ['userMessage', 'assistantMessage', 'progress', 'citations'],
        properties: {
          userMessage: { $ref: '#/components/schemas/MessageDto' },
          assistantMessage: { $ref: '#/components/schemas/MessageDto' },
          progress: { $ref: '#/components/schemas/DiagnosisProgressDto' },
          followUpQuestion: { type: 'string', maxLength: 1000 },
          knowledge: { $ref: '#/components/schemas/KnowledgeDto' },
          parts: { $ref: '#/components/schemas/PartsDto' },
          citations: { type: 'array', items: { $ref: '#/components/schemas/CitationDto' }, maxItems: 20 },
        },
      },
      PaginatedSessionDto: {
        type: 'object',
        additionalProperties: false,
        description: 'totalPages is 0 when there are no matching sessions.',
        required: ['items', 'page', 'limit', 'total', 'totalPages'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/SessionDto' } },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 1 },
          totalPages: { type: 'integer', example: 1 },
        },
      },
      PaginatedMessageDto: {
        type: 'object',
        additionalProperties: false,
        description: 'totalPages is 0 when there are no matching messages.',
        required: ['items', 'page', 'limit', 'total', 'totalPages'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/MessageDto' } },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 1 },
          totalPages: { type: 'integer', example: 1 },
        },
      },
      CreateDiagnosisRequest: {
        type: 'object',
        additionalProperties: false,
        description:
          'applianceId must reference an existing appliance owned by the caller. A model number is NOT required: older appliances may have none, and no model number is inferred. Provide at least one starting clue. An errorCode is a text clue only in this phase; no knowledge lookup is performed.',
        required: ['applianceId'],
        anyOf: [{ required: ['symptom'] }, { required: ['errorCode'] }],
        properties: {
          applianceId: { type: 'string', format: 'uuid' },
          symptom: { type: 'string', minLength: 1, maxLength: 2000, description: 'Trimmed by the server.' },
          errorCode: { type: 'string', minLength: 1, maxLength: 64, description: 'Trimmed by the server.' },
        },
        example: { applianceId: '00000000-0000-7000-8000-000000000001', symptom: 'Not draining' },
      },
      SendMessageRequest: {
        type: 'object',
        additionalProperties: false,
        description:
          'requestId is a client-generated UUID. Replaying the same requestId on the same session returns the stored turn; concurrent duplicates share one in-flight provider turn.',
        required: ['requestId', 'content'],
        properties: {
          requestId: { type: 'string', format: 'uuid' },
          content: { type: 'string', minLength: 1, maxLength: 4000, description: 'Trimmed by the server.' },
        },
        example: {
          requestId: '00000000-0000-4000-8000-0000000000a1',
          content: 'It is a top-load LG washer, error FE, and I cleaned the filter',
        },
      },
      ConfirmFixRequest: {
        type: 'object',
        additionalProperties: false,
        description:
          'Submit the single-use challenge returned in the assistant turn progress when outcome is READY_FOR_CONFIRMATION. No client-supplied verdict is accepted.',
        required: ['challengeId'],
        properties: {
          challengeId: { type: 'string', minLength: 1, maxLength: 200 },
        },
        example: { challengeId: '00000000-0000-4000-8000-0000000000b1' },
      },
      CompleteSessionRequest: {
        type: 'object',
        additionalProperties: false,
        description: 'Explicit acknowledgement is required. Only backend-set terminal verdicts can be completed.',
        required: ['acknowledged'],
        properties: {
          acknowledged: { type: 'boolean', enum: [true] },
        },
        example: { acknowledged: true },
      },
    },
    responses: {
      ValidationError: {
        description: 'Validation error (request body/query/params)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Authentication required or invalid/expired credentials/token',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            examples: {
              unauthorized: {
                value: { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
              },
              invalidCredentials: {
                value: {
                  success: false,
                  error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
                },
              },
              invalidRefresh: {
                value: {
                  success: false,
                  error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid refresh token' },
                },
              },
              refreshReuse: {
                value: {
                  success: false,
                  error: { code: 'REFRESH_TOKEN_REUSED', message: 'Refresh token reuse detected' },
                },
              },
            },
          },
        },
      },
      NotFound: {
        description: 'Route not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: { success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } },
          },
        },
      },
      Conflict: {
        description: 'Conflict (e.g. account/email/username already exists)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      InternalError: {
        description: 'Unexpected server error (details are not exposed)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
            },
          },
        },
      },
      DatabaseUnavailable: {
        description: 'Database connectivity check failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'DATABASE_UNAVAILABLE', message: 'DATABASE connection failed' },
            },
          },
        },
      },
      OriginNotAllowed: {
        description: 'Browser origin is not in CORS_ALLOWED_ORIGINS',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed' },
            },
          },
        },
      },
      RateLimited: {
        description: 'Too many requests; retry after the Retry-After interval',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later' },
            },
          },
        },
      },
      ApplianceNotAvailable: {
        description: 'The appliance linked to the diagnosis session is no longer available',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'APPLIANCE_NOT_AVAILABLE', message: 'Appliance context is no longer available' },
            },
          },
        },
      },
      SessionConflict: {
        description: 'The session changed while the provider turn was running; retry with a new requestId',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'SESSION_CONFLICT', message: 'Diagnosis session changed during this turn' },
            },
          },
        },
      },
      ApplianceNotFound: {
        description: 'Appliance does not exist or is not owned by the caller',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'APPLIANCE_NOT_FOUND', message: 'Appliance not found' },
            },
          },
        },
      },
      SessionNotFound: {
        description: 'Session does not exist or is not owned by the caller (same response for both)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'SESSION_NOT_FOUND', message: 'Diagnosis session not found' },
            },
          },
        },
      },
      SessionClosed: {
        description: 'Session is no longer OPEN; messages cannot be added',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'SESSION_CLOSED', message: 'Diagnosis session is closed' },
            },
          },
        },
      },
      AiTurnIncomplete: {
        description: 'A stored turn is missing one of its two messages or structured metadata',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'AI_TURN_INCOMPLETE', message: 'A stored turn is missing structured metadata' },
            },
          },
        },
      },
      InvalidFixConfirmation: {
        description: 'Fix challenge is unknown, already used, expired or the session was closed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'INVALID_FIX_CONFIRMATION', message: 'Fix confirmation challenge is invalid or expired' },
            },
          },
        },
      },
      SessionNotCompletable: {
        description: 'The session has no backend-set terminal verdict that can be completed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              success: false,
              error: { code: 'SESSION_NOT_COMPLETABLE', message: 'This session has no verdict that can be completed' },
            },
          },
        },
      },
      AiProviderError: {
        description: 'AI provider or controlled search failed, timed out or was misconfigured',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            examples: {
              timeout: {
                value: { success: false, error: { code: 'AI_TIMEOUT', message: 'AI provider timed out' } },
              },
              unavailable: {
                value: {
                  success: false,
                  error: { code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI provider is unavailable' },
                },
              },
              rateLimited: {
                value: {
                  success: false,
                  error: { code: 'AI_RATE_LIMITED', message: 'AI provider is rate limited' },
                },
              },
              notConfigured: {
                value: {
                  success: false,
                  error: { code: 'AI_NOT_CONFIGURED', message: 'AI provider is not configured' },
                },
              },
            },
          },
        },
      },
      AiInvalidResponse: {
        description:
          'AI returned malformed output, invalid tool arguments, repeated calls or exceeded tool limits, or the provider rejected the request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            examples: {
              invalidResponse: {
                value: {
                  success: false,
                  error: { code: 'AI_INVALID_RESPONSE', message: 'AI provider returned an invalid response' },
                },
              },
              providerRejected: {
                value: {
                  success: false,
                  error: { code: 'AI_PROVIDER_REJECTED', message: 'AI provider rejected the request' },
                },
              },
            },
          },
        },
      },
      SessionCreated: {
        description: 'Session created with its initial USER message',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/SessionDto' },
              },
            },
            example: {
              success: true,
              data: {
                id: '00000000-0000-7000-8000-000000000002',
                applianceId: '00000000-0000-7000-8000-000000000001',
                symptom: 'Not draining',
                status: 'OPEN',
                verdict: null,
                createdAt: '2026-11-17T00:00:00.000Z',
                updatedAt: '2026-11-17T00:00:00.000Z',
              },
            },
          },
        },
      },
      SessionListed: {
        description: 'Page of the caller’s sessions, newest first (createdAt DESC, id DESC)',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/PaginatedSessionDto' },
              },
            },
          },
        },
      },
      SessionFetched: {
        description: 'One session owned by the caller',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/SessionDto' },
              },
            },
          },
        },
      },
      MessageListed: {
        description: 'Page of messages, oldest first (createdAt ASC, id ASC)',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/PaginatedMessageDto' },
              },
            },
          },
        },
      },
      TurnCreated: {
        description: 'Persisted user/assistant turn with structured diagnosis progress',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/TurnDto' },
              },
            },
            example: {
              success: true,
              data: {
                userMessage: {
                  id: '00000000-0000-7000-8000-000000000003',
                  sessionId: '00000000-0000-7000-8000-000000000002',
                  role: 'USER',
                  content: 'It is a top-load LG washer, error FE',
                  createdAt: '2026-11-17T00:01:00.000Z',
                },
                assistantMessage: {
                  id: '00000000-0000-7000-8000-000000000004',
                  sessionId: '00000000-0000-7000-8000-000000000002',
                  role: 'ASSISTANT',
                  content: 'FE means a drain issue. The drain hose and pump filter are common checks.',
                  createdAt: '2026-11-17T00:01:00.000Z',
                  metadata: {
                    kind: 'ASSISTANT_TURN',
                    requestId: '00000000-0000-4000-8000-0000000000a1',
                    progress: {
                      status: 'OPEN',
                      verdict: null,
                      outcome: 'NEEDS_CLARIFICATION',
                      followUpQuestion: 'How old is the washer?',
                    },
                    knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
                    citations: [],
                  },
                },
                progress: {
                  status: 'OPEN',
                  verdict: null,
                  outcome: 'NEEDS_CLARIFICATION',
                  followUpQuestion: 'How old is the washer?',
                },
                followUpQuestion: 'How old is the washer?',
                knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
                citations: [],
              },
            },
          },
        },
      },
      SessionConfirmed: {
        description: 'Fix challenge accepted; session is COMPLETED with verdict FIXED',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/SessionDto' },
              },
            },
          },
        },
      },
      SessionCompleted: {
        description: 'Acknowledged terminal verdict; session is COMPLETED',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/SessionDto' },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Checks database connectivity with a simple query.',
        responses: {
          '200': {
            description: 'Service healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/HealthData' },
                  },
                },
                example: { success: true, data: { status: 'ok', database: 'connected' } },
              },
            },
          },
          '503': { $ref: '#/components/responses/DatabaseUnavailable' },
        },
      },
    },
    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness check',
        description: 'Returns immediately without touching the database. Use for process restarts.',
        responses: {
          '200': {
            description: 'Process is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/LivenessData' },
                  },
                },
                example: { success: true, data: { status: 'ok' } },
              },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness check',
        description: 'Checks database connectivity with a bounded query timeout.',
        responses: {
          '200': {
            description: 'Service is ready',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/HealthData' },
                  },
                },
                example: { success: true, data: { status: 'ok', database: 'connected' } },
              },
            },
          },
          '503': { $ref: '#/components/responses/DatabaseUnavailable' },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'User created and tokens issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/AuthUserTokensData' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '409': { $ref: '#/components/responses/Conflict' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email or username',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated, tokens issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/AuthUserTokensData' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate refresh token and issue new tokens',
        description:
          'Rotates the refresh token within the same family. Reuse of a revoked/rotated token revokes the family and returns 401 REFRESH_TOKEN_REUSED.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'New tokens issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/AuthTokensData' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout (revoke refresh token)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Logged out',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/MessageData' },
                  },
                },
                example: { success: true, data: { message: 'Logged out' } },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password (revokes all active refresh tokens)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Password changed; user must sign in again',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/MessageData' },
                  },
                },
                example: {
                  success: true,
                  data: { message: 'Password changed. Please sign in again.' },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: { $ref: '#/components/schemas/MeData' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/diagnosis': {
      post: {
        tags: ['Diagnosis'],
        summary: 'Create a diagnosis session',
        description:
          'Verifies that applianceId belongs to the authenticated user, then creates the OPEN session and its initial USER message atomically. The initial message contains the supplied symptom and/or errorCode (newline-separated when both are given). An appliance without a model number is accepted. No AI or knowledge lookup occurs.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateDiagnosisRequest' } },
          },
        },
        responses: {
          '201': { $ref: '#/components/responses/SessionCreated' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/ApplianceNotFound' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      get: {
        tags: ['Diagnosis'],
        summary: 'List the caller’s diagnosis sessions',
        description: 'Only sessions owned by the authenticated user. Ordered by createdAt DESC, id DESC.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
        ],
        responses: {
          '200': { $ref: '#/components/responses/SessionListed' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/diagnosis/{id}': {
      get: {
        tags: ['Diagnosis'],
        summary: 'Get one diagnosis session',
        description:
          'Returns a session only when it is owned by the authenticated user. Nonexistent and non-owned ids return the same 404 SESSION_NOT_FOUND.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        responses: {
          '200': { $ref: '#/components/responses/SessionFetched' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SessionNotFound' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/diagnosis/{id}/messages': {
      get: {
        tags: ['Diagnosis'],
        summary: 'List messages in a session',
        description:
          'Requires session ownership. Messages are ordered chronologically (createdAt ASC, id ASC) and paginated with the same contract as session listing.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/SessionIdParam' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
        ],
        responses: {
          '200': { $ref: '#/components/responses/MessageListed' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SessionNotFound' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      post: {
        tags: ['Diagnosis'],
        summary: 'Send a message and receive an idempotent AI diagnosis turn',
        description:
          'Requires session ownership and an OPEN session. The backend loads bounded history and approved knowledge, runs a bounded Groq tool loop, then atomically persists the USER and ASSISTANT messages plus structured metadata. Replaying a committed requestId returns the stored turn without a provider call; concurrent duplicates share one in-flight turn. This endpoint is rate limited per user. Provider failures leave no partial turn. The AI never sets verdicts, repair-step eligibility, part compatibility or confirmation state.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } },
          },
        },
        responses: {
          '201': { $ref: '#/components/responses/TurnCreated' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SessionNotFound' },
          '409': {
            description: 'Session closed, appliance unavailable, incomplete stored turn or stale snapshot',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
                examples: {
                  closed: {
                    value: { success: false, error: { code: 'SESSION_CLOSED', message: 'Diagnosis session is closed' } },
                  },
                  appliance: {
                    value: {
                      success: false,
                      error: { code: 'APPLIANCE_NOT_AVAILABLE', message: 'Appliance context is no longer available' },
                    },
                  },
                  incomplete: {
                    value: {
                      success: false,
                      error: { code: 'AI_TURN_INCOMPLETE', message: 'A stored turn is missing structured metadata' },
                    },
                  },
                  conflict: {
                    value: {
                      success: false,
                      error: { code: 'SESSION_CONFLICT', message: 'Diagnosis session changed during this turn' },
                    },
                  },
                },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '502': { $ref: '#/components/responses/AiInvalidResponse' },
          '503': { $ref: '#/components/responses/AiProviderError' },
          '504': { $ref: '#/components/responses/AiProviderError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/diagnosis/{id}/confirm': {
      post: {
        tags: ['Diagnosis'],
        summary: 'Confirm a FIXED diagnosis with the issued challenge',
        description:
          'Submit the single-use challenge from progress.fixChallenge. The backend validates ownership, expiry and persisted state atomically, then sets COMPLETED/FIXED. The client never supplies a verdict.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ConfirmFixRequest' } },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionConfirmed' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SessionNotFound' },
          '409': { $ref: '#/components/responses/InvalidFixConfirmation' },
        },
      },
    },
    '/diagnosis/{id}/complete': {
      post: {
        tags: ['Diagnosis'],
        summary: 'Complete a session with an acknowledged terminal verdict',
        description:
          'Requires acknowledged=true and an existing backend-set verdict of NEEDS_PART, TECHNICIAN_REQUIRED or UNRESOLVED. Client-supplied verdicts are not accepted; the response is the updated SessionDto.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CompleteSessionRequest' } },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionCompleted' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SessionNotFound' },
          '409': { $ref: '#/components/responses/SessionNotCompletable' },
        },
      },
    },
  },
} as const;
