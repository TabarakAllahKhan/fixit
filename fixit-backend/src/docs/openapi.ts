export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FixIt API',
    version: '1.0.0',
    description:
      'HTTP API for the FixIt mobile app. Responses use a standard envelope: success `{ "success": true, "data": ... }`, errors `{ "success": false, "error": { "code", "message" } }`. Diagnosis endpoints are mounted and require a bearer access token. This phase stores and retrieves conversations only: no AI replies, diagnosis, verdicts or repair advice are generated.',
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
        'Owner-scoped diagnosis sessions and messages. Identity always comes from the access token, never from the request. Sessions remain OPEN in this phase; confirm/complete are documented placeholders.',
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
        description: 'Null until a later phase determines a verdict; never accepted from the client.',
      },
      MessageRole: {
        type: 'string',
        enum: ['USER', 'ASSISTANT'],
        description: 'Only USER messages are written in this phase.',
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
        required: ['id', 'sessionId', 'role', 'content', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          sessionId: { type: 'string', format: 'uuid' },
          role: { $ref: '#/components/schemas/MessageRole' },
          content: { type: 'string', maxLength: 4000 },
          createdAt: { type: 'string', format: 'date-time' },
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
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 4000, description: 'Trimmed by the server.' },
        },
        example: { content: 'I cleaned the filter' },
      },
      ConfirmFixRequest: {
        type: 'object',
        additionalProperties: false,
        description: 'Placeholder for a later phase. No client-supplied verdict is accepted.',
        required: ['challengeId'],
        properties: {
          challengeId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
      CompleteSessionRequest: {
        type: 'object',
        additionalProperties: false,
        description: 'Placeholder for a later phase.',
        required: ['acknowledged'],
        properties: {
          acknowledged: { type: 'boolean', enum: [true] },
        },
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
      NotImplemented: {
        description: 'Reserved for a later phase',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            examples: {
              confirm: {
                value: {
                  success: false,
                  error: { code: 'NOT_IMPLEMENTED', message: 'Fix confirmation is not implemented yet' },
                },
              },
              complete: {
                value: {
                  success: false,
                  error: { code: 'NOT_IMPLEMENTED', message: 'Session completion is not implemented yet' },
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
      MessageSent: {
        description: 'Persisted USER message',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: '#/components/schemas/MessageDto' },
              },
            },
            example: {
              success: true,
              data: {
                id: '00000000-0000-7000-8000-000000000003',
                sessionId: '00000000-0000-7000-8000-000000000002',
                role: 'USER',
                content: 'I cleaned the filter',
                createdAt: '2026-11-17T00:01:00.000Z',
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
          '401': { $ref: '#/components/responses/Unauthorized' },
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
        summary: 'Send a USER message',
        description:
          'Requires session ownership and an OPEN session. A conditional database write ensures a session closed concurrently cannot receive a message. No assistant reply is generated in this phase.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } },
          },
        },
        responses: {
          '201': { $ref: '#/components/responses/MessageSent' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/SessionNotFound' },
          '409': { $ref: '#/components/responses/SessionClosed' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/diagnosis/{id}/confirm': {
      post: {
        tags: ['Diagnosis'],
        summary: 'Confirm a FIXED diagnosis (not implemented)',
        description:
          'Reserved for a later phase. The server will issue and validate the challenge against persisted state; the client never supplies a verdict.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ConfirmFixRequest' } },
          },
        },
        responses: {
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '501': { $ref: '#/components/responses/NotImplemented' },
        },
      },
    },
    '/diagnosis/{id}/complete': {
      post: {
        tags: ['Diagnosis'],
        summary: 'Complete a session (not implemented)',
        description: 'Reserved for a later phase. Requires explicit acknowledgement when implemented.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/SessionIdParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CompleteSessionRequest' } },
          },
        },
        responses: {
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '501': { $ref: '#/components/responses/NotImplemented' },
        },
      },
    },
  },
} as const;
