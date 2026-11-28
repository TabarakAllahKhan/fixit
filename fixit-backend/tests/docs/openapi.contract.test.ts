import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/docs/openapi.js';
import { safetyCategorySchema } from '../../src/services/ai/safety.js';
import { troubleshootingDtoSchema } from '../../src/validators/ai.validator.js';
import {
  researchConfidenceSchema,
  researchSummarySchema,
  researchTrustSchema,
} from '../../src/validators/research.validator.js';
import {
  messageDtoSelect,
  sessionDtoSelect,
  toMessageDto,
  toPaginatedDto,
  toSessionDto,
} from '../../src/types/diagnosis.dto.js';
import {
  completeSessionSchema,
  confirmFixSchema,
  createSessionSchema,
  listMessagesQuerySchema,
  listSessionsQuerySchema,
  sendMessageSchema,
} from '../../src/validators/diagnosis.validator.js';

// The contract test reads the spec as JSON-like data so a missing nested key
// fails as an assertion instead of a TypeScript error.
type AnyRecord = Record<string, any>;
const spec = openApiSpec as unknown as AnyRecord;

function schema(name: string): AnyRecord {
  return spec.components.schemas[name];
}

function response(name: string): AnyRecord {
  return spec.components.responses[name];
}

function operation(path: string, method: string): AnyRecord {
  return spec.paths[path]?.[method];
}

function responseText(op: AnyRecord, status: string): string {
  const entry = op.responses?.[status] ?? {};
  const ref = entry.$ref as string | undefined;
  const name = ref?.match(/^#\/components\/responses\/(.+)$/)?.[1];
  return JSON.stringify(name ? response(name) : entry);
}

const DIAGNOSIS_PATHS = {
  '/diagnosis': ['post', 'get'],
  '/diagnosis/{id}': ['get'],
  '/diagnosis/{id}/messages': ['get', 'post'],
  '/diagnosis/{id}/confirm': ['post'],
  '/diagnosis/{id}/complete': ['post'],
} as const;

describe('OpenAPI document shape', () => {
  it('is a valid OpenAPI 3 document with a JWT bearer scheme', () => {
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('FixIt API');
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('documents exactly the seven live diagnosis operations', () => {
    expect(Object.keys(spec.paths).filter((path) => path.startsWith('/diagnosis'))).toEqual(
      Object.keys(DIAGNOSIS_PATHS),
    );

    for (const [path, methods] of Object.entries(DIAGNOSIS_PATHS)) {
      expect(Object.keys(spec.paths[path]).sort()).toEqual([...methods].sort());
    }
  });

  it.each(Object.entries(DIAGNOSIS_PATHS).flatMap(([path, methods]) =>
    methods.map((method) => [path, method] as const),
  ))('requires bearer authorization for %s %s', (path, method) => {
    expect(operation(path, method).security).toEqual([{ bearerAuth: [] }]);
  });

  it('describes the backend-controlled AI workflow', () => {
    expect(JSON.stringify(spec)).not.toMatch(/NOT MOUNTED|NOT_IMPLEMENTED|not implemented/i);
    expect(spec.info.description).toMatch(/requestId/);
    expect(spec.info.description).toMatch(/approved knowledge/);
    expect(spec.tags.find((tag: AnyRecord) => tag.name === 'Diagnosis').description).toMatch(/confirm/);
  });

  it('documents liveness and readiness separately', () => {
    expect(operation('/health', 'get').responses['503']).toBeDefined();
    expect(operation('/health/live', 'get').responses['200']).toBeDefined();
    expect(operation('/health/live', 'get').responses['503']).toBeUndefined();
    expect(operation('/health/ready', 'get').responses['503']).toBeDefined();
    expect(schema('LivenessData').properties.status.enum).toEqual(['ok']);
  });
});

describe('request schemas match the validators', () => {
  it('documents the create-session body with its identification paths and required symptom', () => {
    const body = operation('/diagnosis', 'post').requestBody;
    expect(body.required).toBe(true);
    expect(body.content['application/json'].schema.$ref).toBe('#/components/schemas/CreateDiagnosisRequest');

    const create = schema('CreateDiagnosisRequest');
    expect(create.required).toEqual(['symptom']);
    expect(create.oneOf).toEqual([{ required: ['applianceId'] }, { required: ['brand'] }]);
    expect(create.properties.applianceId.format).toBe('uuid');
    expect(create.properties.brand.maxLength).toBe(120);
    expect(create.properties.modelNumber.maxLength).toBe(80);
    expect(create.properties.symptom.maxLength).toBe(2000);
    expect(create.properties.errorCode.maxLength).toBe(64);
    expect(create.description).toMatch(/exactly one identification path/i);
    expect(create.description).toMatch(/symptom is required/i);
    expect(create.description).toMatch(/no internal error-code id or client user id is accepted/i);

    expect(createSessionSchema.safeParse({ applianceId: 'not-a-uuid', symptom: 'x' }).success).toBe(false);
    expect(createSessionSchema.safeParse({ applianceId: crypto.randomUUID() }).success).toBe(false);
    expect(
      createSessionSchema.safeParse({ applianceId: crypto.randomUUID(), errorCode: 'FE' }).success,
    ).toBe(false);
    expect(createSessionSchema.safeParse({ brand: 'LG', symptom: 'Not draining' }).success).toBe(true);
    expect(
      createSessionSchema.safeParse({
        applianceId: crypto.randomUUID(),
        brand: 'LG',
        symptom: 'Not draining',
      }).success,
    ).toBe(false);
    expect(
      createSessionSchema.safeParse({
        brand: 'LG',
        symptom: 'Not draining',
        errorCodeId: '00000000-0000-7000-8000-0000000000ee',
        userId: '00000000-0000-7000-8000-0000000000ff',
      }),
    ).toEqual({
      success: true,
      data: { brand: 'LG', symptom: 'Not draining' },
    });
  });

  it('documents the idempotent message body', () => {
    const send = schema('SendMessageRequest');
    expect(send.required).toEqual(['requestId', 'content']);
    expect(send.properties.requestId.format).toBe('uuid');
    expect(send.properties.content.maxLength).toBe(4000);
    expect(send.description).toMatch(/replaying/i);

    const requestId = crypto.randomUUID();
    expect(sendMessageSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ requestId, content: 'I cleaned the filter' })).toEqual({
      success: true,
      data: { requestId, content: 'I cleaned the filter' },
    });
  });

  it('documents confirmation and completion bodies', () => {
    const confirm = schema('ConfirmFixRequest');
    expect(confirm.required).toEqual(['challengeId']);
    expect(confirm.properties.challengeId.maxLength).toBe(200);
    expect(confirm.description).toMatch(/single-use challenge/i);
    expect(confirmFixSchema.safeParse({ challengeId: '' }).success).toBe(false);

    const complete = schema('CompleteSessionRequest');
    expect(complete.required).toEqual(['acknowledged']);
    expect(complete.properties.acknowledged.enum).toEqual([true]);
    expect(completeSessionSchema.safeParse({ acknowledged: false }).success).toBe(false);
  });

  it('documents pagination defaults and bounds from the query validators', () => {
    const sessionListParams = operation('/diagnosis', 'get').parameters.map((p: AnyRecord) => p.$ref);
    expect(sessionListParams).toEqual([
      '#/components/parameters/PageParam',
      '#/components/parameters/LimitParam',
    ]);

    const messageListParams = operation('/diagnosis/{id}/messages', 'get').parameters.map(
      (p: AnyRecord) => p.$ref,
    );
    expect(messageListParams).toEqual([
      '#/components/parameters/SessionIdParam',
      '#/components/parameters/PageParam',
      '#/components/parameters/LimitParam',
    ]);

    const page = spec.components.parameters.PageParam.schema;
    const limit = spec.components.parameters.LimitParam.schema;
    expect(page).toMatchObject({ type: 'integer', minimum: 1, default: 1 });
    expect(limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 100, default: 20 });
    expect(listSessionsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listMessagesQuerySchema.parse({ page: '2', limit: '100' })).toEqual({ page: 2, limit: 100 });
  });
});

describe('response schemas match the DTO mappers', () => {
  const rawSession = {
    id: '00000000-0000-7000-8000-000000000002',
    applianceId: '00000000-0000-7000-8000-000000000001',
    symptom: 'Not draining',
    errorCode: 'FE',
    status: 'OPEN' as const,
    verdict: null,
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
    updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    userId: 'secret-user-id',
    errorCodeId: null,
    fixConfirmationChallengeId: null,
    fixConfirmationIssuedAt: null,
    fixConfirmationExpiresAt: null,
  };

  const rawMessage = {
    id: '00000000-0000-7000-8000-000000000003',
    sessionId: rawSession.id,
    role: 'USER' as const,
    content: 'I cleaned the filter',
    createdAt: new Date('2026-11-17T00:01:00.000Z'),
    metadata: null,
  };

  it('documents exactly the session fields the mapper returns', () => {
    const mapped = toSessionDto(rawSession);
    expect(Object.keys(sessionDtoSelect).sort()).toEqual(Object.keys(mapped).sort());
    expect(Object.keys(schema('SessionDto').properties).sort()).toEqual(Object.keys(mapped).sort());
    expect(schema('SessionDto').required.sort()).toEqual(Object.keys(mapped).sort());
    expect(schema('SessionDto').additionalProperties).toBe(false);

    const serialized = JSON.stringify(mapped);
    for (const hidden of ['userId', 'errorCodeId', 'fixConfirmation']) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it('documents the public user fields actually returned by auth endpoints', () => {
    expect(Object.keys(schema('PublicUser').properties).sort()).toEqual(
      ['id', 'email', 'username', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('does not claim an auth response that the endpoint never returns', () => {
    expect(operation('/auth/logout', 'post').responses['401']).toBeUndefined();
    expect(operation('/auth/logout', 'post').responses['429']).toBeDefined();
  });

  it('documents exactly the message fields the mapper returns, with optional metadata', () => {
    const mapped = toMessageDto(rawMessage);
    expect(Object.keys(messageDtoSelect).sort()).toEqual(Object.keys(schema('MessageDto').properties).sort());
    expect(schema('MessageDto').required.sort()).toEqual(Object.keys(mapped).sort());
    expect(schema('MessageDto').properties.metadata.$ref).toBe(
      '#/components/schemas/AssistantMessageMetadataDto',
    );
    expect(schema('MessageDto').required).not.toContain('metadata');
    expect(schema('MessageDto').additionalProperties).toBe(false);
  });

  it('documents the backend-controlled structured turn schemas', () => {
    expect(schema('DiagnosisOutcome').enum).toEqual([
      'NEEDS_CLARIFICATION',
      'NEEDS_MODEL_NUMBER',
      'READY_FOR_CONFIRMATION',
      'NEEDS_PART',
      'TECHNICIAN_REQUIRED',
      'UNRESOLVED',
      'FIXED',
    ]);
    expect(schema('Compatibility').enum).toEqual(['VERIFIED', 'POSSIBLE_MATCH', 'UNKNOWN']);
    expect(schema('ModelScope').enum).toEqual([
      'UNSPECIFIED',
      'TOP_LOAD',
      'FRONT_LOAD',
      'FRENCH_DOOR_BOTTOM_FREEZER',
    ]);

    const turn = schema('TurnDto');
    expect(turn.required).toEqual(['userMessage', 'assistantMessage', 'progress', 'citations']);
    expect(turn.properties.userMessage.$ref).toBe('#/components/schemas/MessageDto');
    expect(turn.properties.progress.$ref).toBe('#/components/schemas/DiagnosisProgressDto');
    expect(turn.properties.knowledge.$ref).toBe('#/components/schemas/KnowledgeDto');
    expect(turn.properties.parts.$ref).toBe('#/components/schemas/PartsDto');

    const metadata = schema('AssistantMessageMetadataDto');
    expect(metadata.required).toEqual(['kind', 'requestId', 'progress', 'citations']);
    expect(metadata.properties.kind.enum).toEqual(['ASSISTANT_TURN']);

    const progress = schema('DiagnosisProgressDto');
    expect(progress.properties.fixChallenge).toBeDefined();
    expect(progress.properties.fixChallengeExpiresAt).toBeDefined();

    const knowledge = schema('KnowledgeDto');
    expect(knowledge.description).toMatch(/complete approved/i);
    expect(knowledge.properties.repairSteps.items.$ref).toBe('#/components/schemas/RepairStepKnowledgeDto');

    const parts = schema('PartsDto');
    expect(parts.properties.candidates.items.$ref).toBe('#/components/schemas/PartCandidateDto');
    expect(schema('PartCandidateDto').properties.compatibility.$ref).toBe(
      '#/components/schemas/Compatibility',
    );
  });

  it('documents Phase 2C/2D troubleshooting, research, safety and citation tiers', () => {
    for (const name of ['TurnDto', 'AssistantMessageMetadataDto']) {
      const properties = schema(name).properties;
      expect(properties.troubleshooting.$ref).toBe('#/components/schemas/TroubleshootingDto');
      expect(properties.research.$ref).toBe('#/components/schemas/ResearchSummaryDto');
      expect(properties.safety.$ref).toBe('#/components/schemas/SafetyDto');
      // Optional additions: older stored turns remain valid.
      expect(schema(name).required).not.toContain('troubleshooting');
      expect(schema(name).required).not.toContain('research');
      expect(schema(name).required).not.toContain('safety');
    }

    expect(schema('ResearchConfidence').enum).toEqual(researchConfidenceSchema.options);
    expect(schema('ResearchSummarySourceDto').properties.trust.enum).toEqual(researchTrustSchema.options);
    expect(schema('SafetyCategory').enum).toEqual(safetyCategorySchema.options);
    expect(Object.keys(schema('ResearchSummaryDto').properties).sort()).toEqual(
      Object.keys(researchSummarySchema.shape).sort(),
    );
    expect(Object.keys(schema('TroubleshootingDto').properties).sort()).toEqual(
      Object.keys(troubleshootingDtoSchema.shape).sort(),
    );
    expect(schema('TroubleshootingDto').description).toMatch(/not approved knowledge/i);
    expect(schema('CitationDto').properties.confidence.allOf[0].$ref).toBe(
      '#/components/schemas/ResearchConfidence',
    );
    expect(schema('ResearchConfidence').description).toMatch(/own official domain/i);
    expect(schema('DiagnosisProgressDto').properties.fixChallenge.description).toMatch(/FIXED is never set/i);
  });

  it('documents the shared pagination envelope', () => {
    const page = toPaginatedDto([toMessageDto(rawMessage)], 3, 2, 1);
    const keys = Object.keys(page).sort();
    for (const name of ['PaginatedSessionDto', 'PaginatedMessageDto']) {
      expect(Object.keys(schema(name).properties).sort()).toEqual(keys);
      expect(schema(name).required.sort()).toEqual(keys);
    }
    expect(toPaginatedDto([], 0, 1, 20).totalPages).toBe(0);
  });
});

describe('status codes and error responses match service behaviour', () => {
  it('documents success, validation and auth codes on implemented operations', () => {
    const expected: Record<string, Record<string, string[]>> = {
      '/diagnosis': {
        post: ['201', '400', '401', '404', '500'],
        get: ['200', '400', '401', '500'],
      },
      '/diagnosis/{id}': { get: ['200', '400', '401', '404', '500'] },
      '/diagnosis/{id}/messages': {
        get: ['200', '400', '401', '404', '500'],
        post: ['201', '400', '401', '404', '409', '429', '500', '502', '503', '504'],
      },
      '/diagnosis/{id}/confirm': {
        post: ['200', '400', '401', '404', '409'],
      },
      '/diagnosis/{id}/complete': {
        post: ['200', '400', '401', '404', '409'],
      },
    };

    for (const [path, methods] of Object.entries(expected)) {
      for (const [method, statuses] of Object.entries(methods)) {
        expect(Object.keys(operation(path, method).responses).sort()).toEqual([...statuses].sort());
      }
    }
  });

  it('uses named error responses with the exact service error codes', () => {
    expect(response('ApplianceNotFound')).toBeDefined();
    expect(response('SessionNotFound')).toBeDefined();
    expect(response('SessionClosed')).toBeDefined();
    expect(response('AiTurnIncomplete')).toBeDefined();
    expect(response('InvalidFixConfirmation')).toBeDefined();
    expect(response('SessionNotCompletable')).toBeDefined();
    expect(response('AiProviderError')).toBeDefined();
    expect(response('AiInvalidResponse')).toBeDefined();

    expect(responseText(operation('/diagnosis', 'post'), '404')).toContain('APPLIANCE_NOT_FOUND');
    expect(responseText(operation('/diagnosis/{id}', 'get'), '404')).toContain('SESSION_NOT_FOUND');
    expect(responseText(operation('/diagnosis/{id}/messages', 'get'), '404')).toContain('SESSION_NOT_FOUND');
    expect(responseText(operation('/diagnosis/{id}/messages', 'post'), '409')).toContain('SESSION_CLOSED');
    const invalidResponseText = responseText(operation('/diagnosis/{id}/messages', 'post'), '502');
    expect(invalidResponseText).toContain('AI_INVALID_RESPONSE');
    expect(invalidResponseText).toContain('AI_PROVIDER_REJECTED');
    expect(responseText(operation('/diagnosis/{id}/messages', 'post'), '503')).toContain('AI_TIMEOUT');
    expect(responseText(operation('/diagnosis/{id}/confirm', 'post'), '409')).toContain(
      'INVALID_FIX_CONFIRMATION',
    );
    expect(responseText(operation('/diagnosis/{id}/complete', 'post'), '409')).toContain(
      'SESSION_NOT_COMPLETABLE',
    );
  });

  it('documents live confirmation and completion success responses', () => {
    for (const path of ['/diagnosis/{id}/confirm', '/diagnosis/{id}/complete']) {
      const op = operation(path, 'post');
      expect(op.summary).not.toMatch(/not implemented/i);
      expect(op.responses['200']).toBeDefined();
      expect(op.responses['501']).toBeUndefined();
      expect(op.requestBody.required).toBe(true);
      expect(op.parameters).toEqual([{ $ref: '#/components/parameters/SessionIdParam' }]);
    }

    expect(responseText(operation('/diagnosis/{id}/confirm', 'post'), '200')).toContain('SessionDto');
    expect(responseText(operation('/diagnosis/{id}/complete', 'post'), '200')).toContain('SessionDto');
    expect(responseText(operation('/diagnosis/{id}/messages', 'post'), '201')).toContain('TurnDto');
  });

  it('keeps every $ref resolvable for Swagger UI Try it out', () => {
    const refs: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          if (key === '$ref' && typeof nested === 'string') refs.push(nested);
          else collect(nested);
        }
      }
    };
    collect(spec);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const [, group, name] = ref.match(/^#\/components\/(\w+)\/(.+)$/) ?? [];
      expect(group).toBeDefined();
      expect(spec.components[group]?.[name]).toBeDefined();
    }
  });
});
