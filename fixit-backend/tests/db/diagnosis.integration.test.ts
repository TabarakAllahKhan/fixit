import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import {
  ApplianceCategory,
  MessageRole,
  ReviewStatus,
  SafetyClass,
  SessionStatus,
  SourceKind,
  Verdict,
} from '../../src/generated/prisma/client.js';
import { createSession } from '../../src/services/session.service.js';
import { HttpError } from '../../src/utils/httpError.js';
import { createTestAppliance, createTestUser, deleteTestUsers, expectNoFields, successData } from './helpers.js';

// Database integration tests must never contact a real AI provider. The
// orchestrator, parts provider and error mapping are exercised with deterministic
// mocked interactions; live provider validation is a separate manual activity.
const { createInteractionMock } = vi.hoisted(() => ({
  createInteractionMock: vi.fn(),
}));

vi.mock('../../src/services/ai/provider.js', () => ({
  createAiInteraction: createInteractionMock,
}));

function toolCompletion(name: string, args: unknown, id = 'call-1') {
  const step = { type: 'function_call', id, name, arguments: args };
  return {
    calls: [{ id, name, arguments: args, step }],
    steps: [step],
    text: '',
  };
}

function mockFinalOutcome(
  outcome = 'NEEDS_CLARIFICATION',
  reply = 'Thanks. Can you tell me more about what happens during the cycle?',
) {
  createInteractionMock.mockResolvedValue(
    toolCompletion('submit_diagnosis_outcome', { reply, outcome }),
  );
}

beforeEach(() => {
  createInteractionMock.mockReset();
  mockFinalOutcome();
});

// Every fixture user is removed after each test, so the smoke suite still
// observes empty application tables when it runs later in this runner.
const createdUserIds: string[] = [];
const createdKnowledgeIds: string[] = [];
const createdRepairStepIds: string[] = [];
const createdKnowledgeSourceIds: string[] = [];

afterEach(async () => {
  await deleteTestUsers(createdUserIds.splice(0));

  const errorCodeIds = createdKnowledgeIds.splice(0);
  const repairStepIds = createdRepairStepIds.splice(0);
  const sourceIds = createdKnowledgeSourceIds.splice(0);
  if (errorCodeIds.length > 0) {
    await prisma.errorCodeRepairStep.deleteMany({ where: { errorCodeId: { in: errorCodeIds } } });
    await prisma.errorCode.deleteMany({ where: { id: { in: errorCodeIds } } });
  }
  if (repairStepIds.length > 0) {
    await prisma.repairStep.deleteMany({ where: { id: { in: repairStepIds } } });
  }
  if (sourceIds.length > 0) {
    await prisma.knowledgeSource.deleteMany({ where: { id: { in: sourceIds } } });
  }
});

async function owner(options: { modelNumber?: string | null } = {}) {
  const { user, accessToken } = await createTestUser();
  createdUserIds.push(user.id);
  const appliance = await createTestAppliance(user.id, options);
  return { user, accessToken, appliance };
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

function createSessionRequest(token: string, body: object) {
  return request(app).post('/diagnosis').set('Authorization', bearer(token)).send(body);
}

const SESSION_KEYS = [
  'id',
  'applianceId',
  'symptom',
  'errorCode',
  'status',
  'verdict',
  'createdAt',
  'updatedAt',
];
const MESSAGE_KEYS = ['id', 'sessionId', 'role', 'content', 'createdAt'];
const HIDDEN_SESSION_FIELDS = [
  'userId',
  'errorCodeId',
  'fixConfirmationChallengeId',
  'fixConfirmationIssuedAt',
  'fixConfirmationExpiresAt',
];

function expectMessageShape(item: Record<string, unknown>): void {
  const keys = Object.keys(item).sort();
  expect(keys).toEqual(expect.arrayContaining(MESSAGE_KEYS));
  expect(keys.every((key) => [...MESSAGE_KEYS, 'metadata'].includes(key))).toBe(true);
}

async function newSession(token: string, applianceId: string, symptom = 'Not draining') {
  const response = await createSessionRequest(token, { applianceId, symptom });
  expect(response.status).toBe(201);
  return successData(response.body);
}

describe('POST /diagnosis — creation, ownership and the initial message', () => {
  it('creates an OPEN session with one initial USER message and an explicit DTO', async () => {
    const { user, appliance, accessToken } = await owner();
    const response = await createSessionRequest(accessToken, {
      applianceId: appliance.id,
      symptom: 'Not draining',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    const data = successData(response.body);
    expect(Object.keys(data).sort()).toEqual([...SESSION_KEYS].sort());
    expectNoFields(data, HIDDEN_SESSION_FIELDS);
    expect(data).toMatchObject({
      applianceId: appliance.id,
      symptom: 'Not draining',
      errorCode: null,
      status: SessionStatus.OPEN,
      verdict: null,
    });
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');

    const stored = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: data.id as string } });
    expect(stored.userId).toBe(user.id);
    expect(stored.errorCode).toBeNull();
    expect(stored.errorCodeId).toBeNull();
    expect(stored.fixConfirmationChallengeId).toBeNull();
    expect(stored.fixConfirmationIssuedAt).toBeNull();
    expect(stored.fixConfirmationExpiresAt).toBeNull();
    expect(stored.context).toBeNull();

    const messages = await prisma.message.findMany({ where: { sessionId: stored.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: MessageRole.USER, content: 'Not draining' });
  });

  it('persists the user-entered error code as text and maps both clues into the initial message', async () => {
    const { appliance, accessToken } = await owner();
    const both = await createSessionRequest(accessToken, {
      applianceId: appliance.id,
      symptom: '  Not draining  ',
      errorCode: '  FE  ',
    });
    expect(both.status).toBe(201);
    const bothSession = successData(both.body);
    expect(bothSession).toMatchObject({ symptom: 'Not draining', errorCode: 'FE' });
    const bothMessages = await prisma.message.findMany({
      where: { sessionId: bothSession.id as string },
    });
    expect(bothMessages).toHaveLength(1);
    expect(bothMessages[0]?.content).toBe('Not draining\nFE');

    const stored = await prisma.diagnosisSession.findUniqueOrThrow({
      where: { id: bothSession.id as string },
    });
    expect(stored.symptom).toBe('Not draining');
    expect(stored.errorCode).toBe('FE');
    expect(stored.errorCodeId).toBeNull();
  });

  it('requires the symptom and rejects an error-code-only request', async () => {
    const { appliance, accessToken } = await owner();
    const response = await createSessionRequest(accessToken, {
      applianceId: appliance.id,
      errorCode: 'E1',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.diagnosisSession.count()).toBe(0);
  });

  it('creates and links a new owned appliance from inline brand/model input atomically', async () => {
    const { user, accessToken } = await owner();
    const response = await createSessionRequest(accessToken, {
      brand: '  InlineBrand  ',
      modelNumber: '  INLINE-1  ',
      symptom: '  Not draining  ',
      errorCode: 'FE',
      userId: '00000000-0000-7000-8000-0000000000ff',
      errorCodeId: '00000000-0000-7000-8000-0000000000ee',
    });

    expect(response.status).toBe(201);
    const data = successData(response.body);
    expect(Object.keys(data).sort()).toEqual([...SESSION_KEYS].sort());
    expect(data).toMatchObject({ symptom: 'Not draining', errorCode: 'FE' });
    expectNoFields(data, HIDDEN_SESSION_FIELDS);

    const stored = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: data.id as string } });
    expect(stored.userId).toBe(user.id);
    expect(stored.errorCodeId).toBeNull();
    const savedAppliance = await prisma.appliance.findUniqueOrThrow({
      where: { id: stored.applianceId as string },
    });
    expect(savedAppliance).toMatchObject({
      userId: user.id,
      brand: 'InlineBrand',
      modelNumber: 'INLINE-1',
      category: null,
      nickname: null,
    });
    const messages = await prisma.message.findMany({ where: { sessionId: stored.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: MessageRole.USER, content: 'Not draining\nFE' });
  });

  it('rejects both identification paths supplied together', async () => {
    const { appliance, accessToken } = await owner();
    const response = await createSessionRequest(accessToken, {
      applianceId: appliance.id,
      brand: 'OtherBrand',
      symptom: 'Not draining',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.appliance.count()).toBe(1);
    expect(await prisma.diagnosisSession.count()).toBe(0);
  });

  it('rejects a missing appliance and another user’s appliance identically', async () => {
    const { accessToken } = await owner();
    const other = await owner();
    const missingId = '00000000-0000-4000-8000-000000000099';

    for (const applianceId of [missingId, other.appliance.id]) {
      const response = await createSessionRequest(accessToken, { applianceId, symptom: 'Noisy spin' });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: { code: 'APPLIANCE_NOT_FOUND', message: 'Appliance not found' },
      });
    }

    expect(await prisma.diagnosisSession.count()).toBe(0);
  });

  it('accepts appliances with null, empty or unspecified model numbers unchanged', async () => {
    for (const modelNumber of [null, '', undefined]) {
      const { appliance, accessToken } = await owner({ modelNumber });
      expect(appliance.modelNumber).toBe(modelNumber ?? null);

      const response = await createSessionRequest(accessToken, {
        applianceId: appliance.id,
        symptom: 'Old appliance, no model sticker',
      });
      expect(response.status).toBe(201);
      const data = successData(response.body);

      const storedAppliance = await prisma.appliance.findUniqueOrThrow({ where: { id: appliance.id } });
      expect(storedAppliance.modelNumber).toBe(modelNumber ?? null);
      const storedSession = await prisma.diagnosisSession.findUniqueOrThrow({
        where: { id: data.id as string },
      });
      expect(storedSession.applianceId).toBe(appliance.id);
    }
  });

  it('rolls back session and message when the transaction fails mid-way', async () => {
    const { user, appliance } = await owner();
    await expect(
      createSession(user.id, {
        applianceId: appliance.id,
        modelNumber: null,
        errorCode: null,
        symptom: 'broken\u0000clue',
      }),
    ).rejects.toThrow();

    expect(await prisma.diagnosisSession.count({ where: { applianceId: appliance.id } })).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });
});

describe('GET /diagnosis and GET /diagnosis/:id — owner scoping', () => {
  it('lists only the caller’s sessions with stable pagination and ordering', async () => {
    const mine = await owner();
    const other = await owner();

    for (const symptom of ['first', 'second', 'third']) {
      await newSession(mine.accessToken, mine.appliance.id, symptom);
    }
    await newSession(other.accessToken, other.appliance.id, 'someone else');

    const firstPage = await request(app)
      .get('/diagnosis?page=1&limit=2')
      .set('Authorization', bearer(mine.accessToken));
    expect(firstPage.status).toBe(200);
    const pageOne = successData(firstPage.body);
    expect(Object.keys(pageOne).sort()).toEqual(['items', 'limit', 'page', 'total', 'totalPages']);
    expect(pageOne).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(pageOne.items).toHaveLength(2);
    for (const item of pageOne.items as Array<Record<string, unknown>>) {
      expect(Object.keys(item).sort()).toEqual([...SESSION_KEYS].sort());
      expectNoFields(item, HIDDEN_SESSION_FIELDS);
    }

    const expectedOrder = await prisma.diagnosisSession.findMany({
      where: { userId: mine.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect((pageOne.items as Array<{ id: string }>).map((item) => item.id)).toEqual(
      expectedOrder.slice(0, 2).map((session) => session.id),
    );

    const secondPage = await request(app)
      .get('/diagnosis?page=2&limit=2')
      .set('Authorization', bearer(mine.accessToken));
    const pageTwo = successData(secondPage.body);
    expect(pageTwo).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect((pageTwo.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      expectedOrder[2]?.id,
    ]);

    const otherList = await request(app)
      .get('/diagnosis')
      .set('Authorization', bearer(other.accessToken));
    expect(successData(otherList.body)).toMatchObject({ total: 1, totalPages: 1, page: 1, limit: 20 });
  });

  it('returns an identical 404 for nonexistent and non-owned sessions', async () => {
    const mine = await owner();
    const other = await owner();
    const created = await newSession(mine.accessToken, mine.appliance.id);

    const own = await request(app)
      .get(`/diagnosis/${created.id}`)
      .set('Authorization', bearer(mine.accessToken));
    expect(own.status).toBe(200);
    const data = successData(own.body);
    expect(Object.keys(data).sort()).toEqual([...SESSION_KEYS].sort());
    expectNoFields(data, HIDDEN_SESSION_FIELDS);

    const expectedError = {
      success: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'Diagnosis session not found' },
    };
    const missing = await request(app)
      .get(`/diagnosis/${other.appliance.id}`)
      .set('Authorization', bearer(mine.accessToken));
    const foreign = await request(app)
      .get(`/diagnosis/${created.id}`)
      .set('Authorization', bearer(other.accessToken));

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(expectedError);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(expectedError);
  });
});

describe('messages — listing, AI turns and closed-session protection', () => {
  it('lists messages chronologically with id tie-break and pagination', async () => {
    const mine = await owner();
    const other = await owner();
    const created = await newSession(mine.accessToken, mine.appliance.id, 'initial');
    const sessionId = created.id as string;

    const base = new Date(Date.now() + 10_000);
    const tieA = '00000000-0000-4000-8000-0000000000a1';
    const tieB = '00000000-0000-4000-8000-0000000000a2';
    await prisma.message.createMany({
      data: [
        { id: tieB, sessionId, role: MessageRole.USER, content: 'tie-b', createdAt: base },
        { id: tieA, sessionId, role: MessageRole.USER, content: 'tie-a', createdAt: base },
        {
          sessionId,
          role: MessageRole.USER,
          content: 'last',
          createdAt: new Date(base.getTime() + 1000),
        },
      ],
    });

    const first = await request(app)
      .get(`/diagnosis/${sessionId}/messages?page=1&limit=2`)
      .set('Authorization', bearer(mine.accessToken));
    expect(first.status).toBe(200);
    const pageOne = successData(first.body);
    expect(pageOne).toMatchObject({ page: 1, limit: 2, total: 4, totalPages: 2 });
    for (const item of pageOne.items as Array<Record<string, unknown>>) expectMessageShape(item);
    expect((pageOne.items as Array<{ content: string }>).map((item) => item.content)).toEqual([
      'initial',
      'tie-a',
    ]);

    const second = await request(app)
      .get(`/diagnosis/${sessionId}/messages?page=2&limit=2`)
      .set('Authorization', bearer(mine.accessToken));
    expect((successData(second.body).items as Array<{ content: string }>).map((item) => item.content)).toEqual([
      'tie-b',
      'last',
    ]);

    const foreign = await request(app)
      .get(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(other.accessToken));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('persists an atomic USER/ASSISTANT turn with validated metadata and context', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    const requestId = crypto.randomUUID();

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send({ requestId, content: 'It is a top-load washer with error FE' });

    expect(response.status).toBe(201);
    const data = successData(response.body);
    expect(Object.keys(data).sort()).toEqual(
      ['userMessage', 'assistantMessage', 'progress', 'knowledge', 'citations'].sort(),
    );
    expect(data.progress).toMatchObject({ status: 'OPEN', outcome: 'NEEDS_CLARIFICATION', verdict: null });
    expectMessageShape(data.userMessage as Record<string, unknown>);
    expectMessageShape(data.assistantMessage as Record<string, unknown>);
    expect((data.assistantMessage as Record<string, unknown>).metadata).toMatchObject({
      kind: 'ASSISTANT_TURN',
      requestId,
    });
    expect(createInteractionMock).toHaveBeenCalledTimes(1);

    const messages = await prisma.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    expect(messages).toHaveLength(3);
    expect(messages.slice(1).map((message) => message.role)).toEqual([
      MessageRole.USER,
      MessageRole.ASSISTANT,
    ]);
    for (const message of messages.slice(1)) expect(message.clientRequestId).toBe(requestId);
    expect(messages[2]?.metadata).toMatchObject({ kind: 'ASSISTANT_TURN', requestId });

    const storedSession = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(storedSession.context).toMatchObject({
      currentOutcome: 'NEEDS_CLARIFICATION',
      trustedApplianceIdentity: {
        version: 1,
        modelNumber: null,
        modelSource: null,
        modelScope: 'TOP_LOAD',
        scopeSource: 'USER_MESSAGE',
      },
    });
  });

  it('replays the same requestId without another provider call or duplicate messages', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    const requestId = crypto.randomUUID();
    const payload = { requestId, content: 'What should I check next?' };

    const first = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send(payload);
    const second = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(createInteractionMock).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { sessionId } })).toBe(3);
  });

  it('does not persist any part of a turn when the provider fails', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    createInteractionMock.mockRejectedValueOnce(
      new HttpError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'),
    );

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send({ requestId: crypto.randomUUID(), content: 'Provider should fail' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(await prisma.message.count({ where: { sessionId } })).toBe(1);
    const storedSession = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(storedSession.context).toBeNull();
  });

  it('does not persist a malformed provider response', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    createInteractionMock.mockResolvedValueOnce({ calls: [], text: '' });

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send({ requestId: crypto.randomUUID(), content: 'Malformed provider result' });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_INVALID_RESPONSE');
    expect(await prisma.message.count({ where: { sessionId } })).toBe(1);
  });

  it('rejects messages on a closed session', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    await prisma.diagnosisSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.COMPLETED },
    });

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send({ requestId: crypto.randomUUID(), content: 'Too late' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'SESSION_CLOSED', message: 'Diagnosis session is closed' },
    });
    expect(await prisma.message.count({ where: { sessionId } })).toBe(1);
    expect(createInteractionMock).not.toHaveBeenCalled();
  });

  it('does not insert when the session is closed concurrently with the conditional write', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;

    const closer = (async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "DiagnosisSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT 1 AS waited FROM pg_sleep(0.5)`;
        await tx.diagnosisSession.update({
          where: { id: sessionId },
          data: { status: SessionStatus.COMPLETED },
        });
      });
    })();

    await new Promise((resolve) => setTimeout(resolve, 100));
    let response;
    try {
      response = await request(app)
        .post(`/diagnosis/${sessionId}/messages`)
        .set('Authorization', bearer(accessToken))
        .send({ requestId: crypto.randomUUID(), content: 'Racing message' });
    } finally {
      await closer;
    }

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SESSION_CLOSED');
    expect(await prisma.message.count({ where: { sessionId } })).toBe(1);
  });
});

describe('approved knowledge, confirmation and completion', () => {
  async function createApprovedKnowledge() {
    // A short, extractable manufacturer code. TestBrand is fixture-only, and
    // afterEach removes this row, so the category/brand/code/scope key stays
    // unique across repeated runs.
    const code = 'FE';
    const source = await prisma.knowledgeSource.create({
      data: {
        title: 'Test service manual',
        kind: SourceKind.TEST_FIXTURE,
        url: 'https://example.invalid/manual',
        edition: 'test',
        capturedAt: new Date(),
      },
    });
    const errorCode = await prisma.errorCode.create({
      data: {
        sourceId: source.id,
        category: ApplianceCategory.WASHING_MACHINE,
        brand: 'TestBrand',
        code,
        modelScope: 'TOP_LOAD',
        meaning: 'Drain blockage indicated',
        reviewStatus: ReviewStatus.APPROVED,
      },
    });
    const step = await prisma.repairStep.create({
      data: {
        sourceId: source.id,
        instruction: 'Remove the drain hose and clear the filter.',
        safetyClass: SafetyClass.USER_SAFE,
        reviewStatus: ReviewStatus.APPROVED,
      },
    });
    await prisma.errorCodeRepairStep.create({
      data: {
        errorCodeId: errorCode.id,
        repairStepId: step.id,
        position: 1,
        reviewStatus: ReviewStatus.APPROVED,
      },
    });
    createdKnowledgeIds.push(errorCode.id);
    createdRepairStepIds.push(step.id);
    createdKnowledgeSourceIds.push(source.id);
    return { errorCode, step, source };
  }

  it('returns only complete approved repair steps and issues a fix challenge', async () => {
    const knowledge = await createApprovedKnowledge();
    const { accessToken, appliance } = await owner({ modelNumber: 'TB-100' });
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    await prisma.diagnosisSession.update({
      where: { id: sessionId },
      data: {
        context: {
          trustedApplianceIdentity: {
            version: 1,
            modelNumber: 'TB-100',
            modelSource: 'APPLIANCE',
            modelScope: 'TOP_LOAD',
            scopeSource: 'USER_MESSAGE',
          },
          suspectedComponents: [],
          diagnosticFacts: [],
        },
      },
    });

    createInteractionMock
      .mockResolvedValueOnce(toolCompletion('get_repair_steps', { errorCode: knowledge.errorCode.code }, 'call-1'))
      .mockResolvedValueOnce(
        toolCompletion(
          'submit_diagnosis_outcome',
          { reply: 'The approved sequence is ready.', outcome: 'READY_FOR_CONFIRMATION' },
          'call-2',
        ),
      );

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send({ requestId: crypto.randomUUID(), content: `Error ${knowledge.errorCode.code} on my top-load washer` });

    expect(response.status).toBe(201);
    const data = successData(response.body);
    const progress = data.progress as Record<string, unknown>;
    expect(progress).toMatchObject({
      status: 'OPEN',
      outcome: 'READY_FOR_CONFIRMATION',
      verdict: null,
    });
    expect(typeof progress.fixChallenge).toBe('string');
    expect(data.knowledge).toMatchObject({ unverified: false });
    expect((data.knowledge as { repairSteps: unknown[] }).repairSteps).toHaveLength(1);
    expect(data.citations).toBeDefined();

    const storedSession = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(storedSession.errorCodeId).toBe(knowledge.errorCode.id);
    expect(storedSession.fixConfirmationChallengeId).toBe(
      createHash('sha256').update(progress.fixChallenge as string).digest('hex'),
    );
  });

  it('confirms a fix only with the issued single-use challenge', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;
    const challenge = 'backend-issued-challenge';
    await prisma.diagnosisSession.update({
      where: { id: sessionId },
      data: {
        fixConfirmationChallengeId: createHash('sha256').update(challenge).digest('hex'),
        fixConfirmationIssuedAt: new Date(),
        fixConfirmationExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const invalid = await request(app)
      .post(`/diagnosis/${sessionId}/confirm`)
      .set('Authorization', bearer(accessToken))
      .send({ challengeId: 'wrong-challenge' });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('INVALID_FIX_CONFIRMATION');

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/confirm`)
      .set('Authorization', bearer(accessToken))
      .send({ challengeId: challenge });
    expect(response.status).toBe(200);
    expect(successData(response.body)).toMatchObject({
      status: SessionStatus.COMPLETED,
      verdict: Verdict.FIXED,
    });

    const replay = await request(app)
      .post(`/diagnosis/${sessionId}/confirm`)
      .set('Authorization', bearer(accessToken))
      .send({ challengeId: challenge });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('SESSION_CLOSED');
  });

  it('completes only acknowledged sessions with a backend-set terminal verdict', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;

    const noVerdict = await request(app)
      .post(`/diagnosis/${sessionId}/complete`)
      .set('Authorization', bearer(accessToken))
      .send({ acknowledged: true });
    expect(noVerdict.status).toBe(409);
    expect(noVerdict.body.error.code).toBe('SESSION_NOT_COMPLETABLE');

    await prisma.diagnosisSession.update({
      where: { id: sessionId },
      data: { verdict: Verdict.NEEDS_PART },
    });
    const response = await request(app)
      .post(`/diagnosis/${sessionId}/complete`)
      .set('Authorization', bearer(accessToken))
      .send({ acknowledged: true });
    expect(response.status).toBe(200);
    expect(successData(response.body)).toMatchObject({
      status: SessionStatus.COMPLETED,
      verdict: Verdict.NEEDS_PART,
    });
  });
});
