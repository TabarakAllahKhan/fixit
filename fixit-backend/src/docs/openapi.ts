export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FixIt API',
    version: '1.0.0',
    description:
      'HTTP API for the FixIt mobile app. Responses use a standard envelope: success `{ "success": true, "data": ... }`, errors `{ "success": false, "error": { "code", "message" } }`. Diagnosis endpoints are currently not mounted in the server (draft).',
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
      name: 'Diagnosis (draft)',
      description:
        'Planned diagnosis endpoints. Not mounted in app.ts and controller is currently a stub; requests would not be handled by the live API yet.',
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
    },
    responses: {
      ValidationError: {
        description: 'Validation error (request body/schema)',
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
        tags: ['Diagnosis (draft)'],
        summary: 'Create/start diagnosis (NOT MOUNTED)',
        description:
          'Draft only. This route is defined in src/routes/diagnosis.routes.ts but is not mounted in app.ts, and the controller is currently a stub. Do not rely on this endpoint until it is implemented and mounted.',
        deprecated: true,
        responses: {
          '501': {
            description: 'Not available in the current live API',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
                example: {
                  success: false,
                  error: { code: 'NOT_IMPLEMENTED', message: 'Diagnosis endpoint is not mounted yet' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
