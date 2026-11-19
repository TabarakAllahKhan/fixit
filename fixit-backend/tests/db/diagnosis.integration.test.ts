import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MessageRole, SessionStatus } from '../../src/generated/prisma/client.js';
import { createSession } from '../../src/services/session.service.js';
import { createTestAppliance, createTestUser, deleteTestUsers, expectNoFields, successData } from './helpers.js';

// Every fixture user is removed after each test, so the Phase 4A smoke suite
// still observes empty application tables when it runs later in this runner.
const createdUserIds: string[] = [];

afterEach(async () => {
  await deleteTestUsers(createdUserIds.splice(0));
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

const SESSION_KEYS = ['id', 'applianceId', 'symptom', 'status', 'verdict', 'createdAt', 'updatedAt'];
const MESSAGE_KEYS = ['id', 'sessionId', 'role', 'content', 'createdAt'];
const HIDDEN_SESSION_FIELDS = [
  'userId',
  'errorCodeId',
  'fixConfirmationChallengeId',
  'fixConfirmationIssuedAt',
  'fixConfirmationExpiresAt',
];

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
      status: SessionStatus.OPEN,
      verdict: null,
    });
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');

    const stored = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: data.id as string } });
    expect(stored.userId).toBe(user.id);
    expect(stored.errorCodeId).toBeNull();
    expect(stored.fixConfirmationChallengeId).toBeNull();
    expect(stored.fixConfirmationIssuedAt).toBeNull();
    expect(stored.fixConfirmationExpiresAt).toBeNull();

    const messages = await prisma.message.findMany({ where: { sessionId: stored.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: MessageRole.USER, content: 'Not draining' });
  });

  it('maps both starting clues into the initial message without a knowledge lookup', async () => {
    const { appliance, accessToken } = await owner();
    const both = await createSessionRequest(accessToken, {
      applianceId: appliance.id,
      symptom: 'Not draining',
      errorCode: 'FE',
    });
    expect(both.status).toBe(201);
    const bothSession = successData(both.body);
    const bothMessages = await prisma.message.findMany({
      where: { sessionId: bothSession.id as string },
    });
    expect(bothMessages).toHaveLength(1);
    expect(bothMessages[0]?.content).toBe('Not draining\nFE');

    const codeOnly = await createSessionRequest(accessToken, {
      applianceId: appliance.id,
      errorCode: 'E1',
    });
    expect(codeOnly.status).toBe(201);
    const codeSession = successData(codeOnly.body);
    expect(codeSession.symptom).toBeNull();
    const codeMessages = await prisma.message.findMany({
      where: { sessionId: codeSession.id as string },
    });
    expect(codeMessages[0]?.content).toBe('E1');

    const sessions = await prisma.diagnosisSession.findMany({ where: { applianceId: appliance.id } });
    expect(sessions.every((session) => session.errorCodeId === null)).toBe(true);
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
    // PostgreSQL text cannot contain U+0000. Calling the service directly
    // bypasses Zod (which would reject this at the HTTP boundary), so the
    // insert fails only after the session row has been created in the tx.
    await expect(
      createSession(user.id, { applianceId: appliance.id, symptom: 'broken\u0000clue' }),
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

describe('messages — listing, sending and closed-session protection', () => {
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
    for (const item of pageOne.items as Array<Record<string, unknown>>) {
      expect(Object.keys(item).sort()).toEqual([...MESSAGE_KEYS].sort());
    }
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

  it('persists a USER message for an owned OPEN session', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', bearer(accessToken))
      .send({ content: 'I cleaned the filter' });

    expect(response.status).toBe(201);
    const data = successData(response.body);
    expect(Object.keys(data).sort()).toEqual([...MESSAGE_KEYS].sort());
    expect(data).toMatchObject({ sessionId, role: MessageRole.USER, content: 'I cleaned the filter' });

    const messages = await prisma.message.findMany({ where: { sessionId } });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: MessageRole.USER, content: 'I cleaned the filter' });
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
      .send({ content: 'Too late' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'SESSION_CLOSED', message: 'Diagnosis session is closed' },
    });
    expect(await prisma.message.count({ where: { sessionId } })).toBe(1);
  });

  it('does not insert when the session is closed concurrently with the conditional write', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;

    // Hold a row lock, then close the session before releasing it. A plain
    // ownership read still sees OPEN under READ COMMITTED, but the conditional
    // update in sendMessage must re-check after the lock wait and refuse.
    const closer = (async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "DiagnosisSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
        // pg_sleep returns `void`, which Prisma cannot deserialize; selecting
        // a constant from it keeps the delay without returning that column.
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
        .send({ content: 'Racing message' });
    } finally {
      await closer;
    }

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SESSION_CLOSED');
    expect(await prisma.message.count({ where: { sessionId } })).toBe(1);
  });

  it('keeps confirm and complete as explicit 501 placeholders', async () => {
    const { accessToken, appliance } = await owner();
    const created = await newSession(accessToken, appliance.id);
    const sessionId = created.id as string;

    for (const [path, body] of [
      ['confirm', { challengeId: 'server-issued-challenge' }],
      ['complete', { acknowledged: true }],
    ] as const) {
      const response = await request(app)
        .post(`/diagnosis/${sessionId}/${path}`)
        .set('Authorization', bearer(accessToken))
        .send(body);
      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
    }
  });
});
