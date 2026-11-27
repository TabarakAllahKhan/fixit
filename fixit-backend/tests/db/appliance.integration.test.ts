import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { ApplianceCategory, MessageRole, SessionStatus } from '../../src/generated/prisma/client.js';
import { resetRateLimits } from '../../src/middleware/rateLimit.js';
import {
  createAppliance,
  deleteAppliance,
  getApplianceById,
  listAppliances,
  updateAppliance,
} from '../../src/services/appliance.service.js';
import { createSession } from '../../src/services/session.service.js';
import type { ApplianceDto } from '../../src/types/appliance.dto.js';
import { HttpError } from '../../src/utils/httpError.js';
import { createTestUser, deleteTestUsers, disconnectTestPrisma, expectNoFields, successData } from './helpers.js';

// Every fixture user is registered here and removed in afterEach, so cleanup
// can only touch rows created by this file. The shared smoke suite still sees
// empty application tables regardless of file execution order.
const createdUserIds: string[] = [];

const APPLIANCE_DTO_KEYS = ['id', 'brand', 'modelNumber', 'createdAt', 'updatedAt'];
// Legacy columns still exist in the database but are not part of the API.
const HIDDEN_APPLIANCE_FIELDS = ['userId', 'category', 'nickname'];

beforeEach(() => {
  resetRateLimits();
});

afterEach(async () => {
  await deleteTestUsers(createdUserIds.splice(0));
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function newUser() {
  const { user, accessToken } = await createTestUser();
  createdUserIds.push(user.id);
  return { user, accessToken };
}

function expectApplianceDtoShape(value: object): void {
  expect(Object.keys(value).sort()).toEqual([...APPLIANCE_DTO_KEYS].sort());
  expectNoFields(value as Record<string, unknown>, HIDDEN_APPLIANCE_FIELDS);
}

async function expectApplianceNotFound(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.statusCode).toBe(404);
    expect(httpError.code).toBe('APPLIANCE_NOT_FOUND');
    expect(httpError.message).toBe('Appliance not found');
    return;
  }
  throw new Error('Expected APPLIANCE_NOT_FOUND to be thrown');
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

describe('appliance create and persistence', () => {
  it('creates without a category and stores the authenticated user id, defaults and a retrievable row', async () => {
    const { user } = await newUser();
    const forgedId = '00000000-0000-7000-8000-0000000000ff';
    const forgedUserId = '00000000-0000-7000-8000-0000000000ee';

    // A direct service call proves the server argument wins and client-shaped
    // fields cannot reach Prisma even when the validator is bypassed.
    const input = {
      brand: 'Bosch',
      category: ApplianceCategory.WASHING_MACHINE,
      nickname: 'Forged nickname',
      id: forgedId,
      userId: forgedUserId,
      createdAt: new Date('2001-01-01T00:00:00.000Z'),
      updatedAt: new Date('2001-01-01T00:00:00.000Z'),
    };
    const created = await createAppliance(user.id, input);

    expectApplianceDtoShape(created);
    expect(created.id).not.toBe(forgedId);
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created.brand).toBe('Bosch');
    expect(created.modelNumber).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const stored = await prisma.appliance.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.id).toBe(created.id);
    expect(stored.userId).toBe(user.id);
    expect(stored.category).toBeNull();
    expect(stored.modelNumber).toBeNull();
    expect(stored.nickname).toBeNull();
    expect(stored.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(stored.updatedAt.toISOString()).toBe(created.updatedAt.toISOString());

    const fetched = await getApplianceById(user.id, { id: created.id });
    expect(fetched).toEqual(created);
  });

  it('persists an explicit modelNumber without writing legacy columns', async () => {
    const { user } = await newUser();
    const created = await createAppliance(user.id, {
      brand: 'Samsung',
      modelNumber: 'RB37',
    });

    expectApplianceDtoShape(created);
    expect(created).toMatchObject({ brand: 'Samsung', modelNumber: 'RB37' });

    const stored = await prisma.appliance.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.userId).toBe(user.id);
    expect(stored.category).toBeNull();
    expect(stored.modelNumber).toBe('RB37');
    expect(stored.nickname).toBeNull();
  });

  it('keeps legacy category and nickname intact while omitting them from the DTO', async () => {
    const { user } = await newUser();
    const legacy = await prisma.appliance.create({
      data: {
        userId: user.id,
        category: ApplianceCategory.WASHING_MACHINE,
        brand: 'Legacy washer',
        modelNumber: 'W1',
        nickname: 'Main washer',
      },
    });

    const fetched = await getApplianceById(user.id, { id: legacy.id });
    expectApplianceDtoShape(fetched);
    expect(fetched).toMatchObject({ brand: 'Legacy washer', modelNumber: 'W1' });
    expect(JSON.stringify(fetched)).not.toContain('Main washer');

    const updated = await updateAppliance(user.id, { id: legacy.id }, { brand: 'Renamed washer' });
    expectApplianceDtoShape(updated);
    expect(updated.brand).toBe('Renamed washer');
    expect(updated.modelNumber).toBe('W1');

    const stored = await prisma.appliance.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(stored.category).toBe(ApplianceCategory.WASHING_MACHINE);
    expect(stored.nickname).toBe('Main washer');
    expect(stored.brand).toBe('Renamed washer');
    expect(stored.modelNumber).toBe('W1');
  });
});

describe('appliance ownership isolation', () => {
  async function twoOwners() {
    const mine = await newUser();
    const other = await newUser();
    const mineAppliance = await createAppliance(mine.user.id, { brand: 'Mine' });
    const otherAppliance = await createAppliance(other.user.id, { brand: 'Theirs' });
    return { mine, other, mineAppliance, otherAppliance };
  }

  it('lists only the caller’s appliances with owner-scoped counts', async () => {
    const { mine, other, mineAppliance, otherAppliance } = await twoOwners();
    const secondMine = await createAppliance(mine.user.id, { brand: 'Mine too' });

    const mineList = await listAppliances(mine.user.id, { page: 1, limit: 20 });
    const otherList = await listAppliances(other.user.id, { page: 1, limit: 20 });

    expect(mineList).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(mineList.items.map((item) => item.id).sort()).toEqual([mineAppliance.id, secondMine.id].sort());
    expect(otherList).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(otherList.items.map((item) => item.id)).toEqual([otherAppliance.id]);
  });

  it('returns APPLIANCE_NOT_FOUND for a foreign get without revealing the row', async () => {
    const { mine, other, mineAppliance } = await twoOwners();
    await expectApplianceNotFound(() => getApplianceById(other.user.id, { id: mineAppliance.id }));
    expect(await getApplianceById(mine.user.id, { id: mineAppliance.id })).toBeDefined();
    expect(mine.user.id).not.toBe(other.user.id);
  });

  it('returns APPLIANCE_NOT_FOUND for foreign update and delete without changing either owner’s rows', async () => {
    const { mine, other, mineAppliance, otherAppliance } = await twoOwners();
    const mineBefore = await prisma.appliance.findUniqueOrThrow({ where: { id: mineAppliance.id } });
    const otherBefore = await prisma.appliance.findUniqueOrThrow({ where: { id: otherAppliance.id } });

    await expectApplianceNotFound(() =>
      updateAppliance(other.user.id, { id: mineAppliance.id }, { brand: 'Stolen' }),
    );
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: mineAppliance.id } })).toEqual(mineBefore);

    await expectApplianceNotFound(() => deleteAppliance(other.user.id, { id: mineAppliance.id }));
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: mineAppliance.id } })).toEqual(mineBefore);
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: otherAppliance.id } })).toEqual(otherBefore);
  });
});

describe('appliance list ordering and pagination', () => {
  it('orders by createdAt DESC then id DESC and reports page boundaries and owner-scoped totals', async () => {
    const owner = await newUser();
    const other = await newUser();
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const day = 86_400_000;
    const created: ApplianceDto[] = [];

    for (let index = 0; index < 4; index += 1) {
      const appliance = await createAppliance(owner.user.id, { brand: `Brand-${index}` });
      // Fixed timestamps (including one deliberate tie) remove timing flakiness
      // while still exercising the real ordered query in the service.
      await prisma.appliance.update({
        where: { id: appliance.id },
        data: { createdAt: new Date(base + (index === 3 ? 2 * day : index === 0 ? 0 : day)) },
      });
      created.push(appliance);
    }
    await createAppliance(other.user.id, { brand: 'Not mine' });

    const [first, tiedA, tiedB, newest] = created;
    const tieOrder = [tiedA.id, tiedB.id].sort((left, right) => right.localeCompare(left));
    const expectedOrder = [newest.id, ...tieOrder, first.id];

    const all = await listAppliances(owner.user.id, { page: 1, limit: 20 });
    expect(all.items.map((item) => item.id)).toEqual(expectedOrder);
    expect(all).toMatchObject({ page: 1, limit: 20, total: 4, totalPages: 1 });

    const databaseOrder = await prisma.appliance.findMany({
      where: { userId: owner.user.id },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(databaseOrder.map((row) => row.id)).toEqual(expectedOrder);

    const pageOne = await listAppliances(owner.user.id, { page: 1, limit: 2 });
    expect(pageOne.items.map((item) => item.id)).toEqual(expectedOrder.slice(0, 2));
    expect(pageOne).toMatchObject({ page: 1, limit: 2, total: 4, totalPages: 2 });

    const pageTwo = await listAppliances(owner.user.id, { page: 2, limit: 2 });
    expect(pageTwo.items.map((item) => item.id)).toEqual(expectedOrder.slice(2));
    expect(pageTwo).toMatchObject({ page: 2, limit: 2, total: 4, totalPages: 2 });

    const pastLastPage = await listAppliances(owner.user.id, { page: 3, limit: 2 });
    expect(pastLastPage.items).toEqual([]);
    expect(pastLastPage).toMatchObject({ page: 3, limit: 2, total: 4, totalPages: 2 });

    const otherList = await listAppliances(other.user.id, { page: 1, limit: 20 });
    expect(otherList.total).toBe(1);
  });

  it('returns an empty owner-scoped page for a user with no appliances', async () => {
    const { user } = await newUser();
    const page = await listAppliances(user.id, { page: 1, limit: 20 });
    expect(page).toMatchObject({ page: 1, limit: 20, total: 0, totalPages: 0 });
    expect(page.items).toEqual([]);
  });
});

describe('appliance update behaviour', () => {
  it('preserves omitted fields and clears a nullable field on explicit null', async () => {
    const { user } = await newUser();
    const original = await createAppliance(user.id, {
      brand: 'LG',
      modelNumber: 'W1',
    });

    const partial = await updateAppliance(user.id, { id: original.id }, { brand: 'Samsung' });
    expect(partial).toMatchObject({ brand: 'Samsung', modelNumber: 'W1' });
    expect(partial.createdAt.toISOString()).toBe(original.createdAt.toISOString());
    expectApplianceDtoShape(partial);

    const afterPartial = await prisma.appliance.findUniqueOrThrow({ where: { id: original.id } });
    expect(afterPartial.brand).toBe('Samsung');
    expect(afterPartial.modelNumber).toBe('W1');

    const cleared = await updateAppliance(user.id, { id: original.id }, { modelNumber: null });
    expect(cleared).toMatchObject({ brand: 'Samsung', modelNumber: null });
    expectApplianceDtoShape(cleared);

    const afterClear = await prisma.appliance.findUniqueOrThrow({ where: { id: original.id } });
    expect(afterClear.brand).toBe('Samsung');
    expect(afterClear.modelNumber).toBeNull();
  });

  it('updates every editable field and advances the schema-managed updatedAt', async () => {
    const { user } = await newUser();
    const created = await createAppliance(user.id, {
      brand: 'Old brand',
      modelNumber: 'Old-model',
    });

    // Move updatedAt to a known old value so the assertion cannot depend on
    // two writes landing in the same clock tick.
    const oldUpdatedAt = new Date('2020-01-01T00:00:00.000Z');
    await prisma.$executeRaw`UPDATE "Appliance" SET "updatedAt" = ${oldUpdatedAt} WHERE "id" = ${created.id}::uuid`;
    const before = await prisma.appliance.findUniqueOrThrow({ where: { id: created.id } });
    expect(before.updatedAt.toISOString()).toBe(oldUpdatedAt.toISOString());

    const updated = await updateAppliance(user.id, { id: created.id }, {
      brand: 'New brand',
      modelNumber: 'New-model',
    });
    expect(updated).toMatchObject({ brand: 'New brand', modelNumber: 'New-model' });
    expectApplianceDtoShape(updated);

    const stored = await prisma.appliance.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({ brand: 'New brand', modelNumber: 'New-model' });
    expect(stored.category).toBeNull();
    expect(stored.nickname).toBeNull();
    expect(stored.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(stored.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
  });
});

describe('appliance delete and diagnosis relation safety', () => {
  it('nulls the session applianceId and keeps sessions and messages while deleting only the owned appliance', async () => {
    const mine = await newUser();
    const other = await newUser();

    const appliance = await createAppliance(mine.user.id, { brand: 'Drain master' });
    const session = await createSession(mine.user.id, {
      applianceId: appliance.id,
      modelNumber: null,
      errorCode: null,
      symptom: 'Not draining',
    });
    await prisma.message.create({
      data: { sessionId: session.id, role: MessageRole.ASSISTANT, content: 'Check the filter.' },
    });
    const messagesBefore = await prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { id: 'asc' },
    });
    expect(messagesBefore).toHaveLength(2);

    const otherAppliance = await createAppliance(other.user.id, { brand: 'Foreign fridge' });
    const otherSession = await createSession(other.user.id, {
      applianceId: otherAppliance.id,
      modelNumber: null,
      errorCode: null,
      symptom: 'Foreign symptom',
    });
    const otherMessagesBefore = await prisma.message.findMany({ where: { sessionId: otherSession.id } });
    expect(otherMessagesBefore).toHaveLength(1);

    // PostgreSQL reports SET NULL as 'n' in pg_constraint.confdeltype.
    const constraint = await prisma.$queryRaw<Array<{ onDelete: string }>>`
      SELECT c.confdeltype::text AS "onDelete"
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND t.relname = 'DiagnosisSession' AND a.attname = 'applianceId'
    `;
    expect(constraint).toHaveLength(1);
    expect(constraint[0]?.onDelete).toBe('n');

    await expect(deleteAppliance(mine.user.id, { id: appliance.id })).resolves.toBeUndefined();

    expect(await prisma.appliance.findUnique({ where: { id: appliance.id } })).toBeNull();
    await expectApplianceNotFound(() => getApplianceById(mine.user.id, { id: appliance.id }));

    const storedSession = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(storedSession).toMatchObject({
      id: session.id,
      userId: mine.user.id,
      applianceId: null,
      symptom: 'Not draining',
      status: SessionStatus.OPEN,
    });
    expect(storedSession.applianceId).toBeNull();

    const messagesAfter = await prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { id: 'asc' },
    });
    expect(messagesAfter).toEqual(messagesBefore);
    expect(messagesAfter.find((message) => message.role === MessageRole.ASSISTANT)?.content).toBe('Check the filter.');

    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: otherAppliance.id } })).toBeDefined();
    const storedOtherSession = await prisma.diagnosisSession.findUniqueOrThrow({ where: { id: otherSession.id } });
    expect(storedOtherSession.applianceId).toBe(otherAppliance.id);
    expect(await prisma.message.findMany({ where: { sessionId: otherSession.id } })).toEqual(otherMessagesBefore);
  });
});

describe('appliance HTTP routes with the real database', () => {
  it('runs create, list, get, update and delete through the authenticated routes', async () => {
    const { user, accessToken } = await newUser();
    const auth = bearer(accessToken);
    const forgedId = '00000000-0000-7000-8000-0000000000bb';

    const createResponse = await request(app)
      .post('/appliances')
      .set('Authorization', auth)
      .send({
        brand: '  Bosch  ',
        modelNumber: '',
        category: ApplianceCategory.WASHING_MACHINE,
        nickname: '  Main washer  ',
        id: forgedId,
        userId: '00000000-0000-7000-8000-0000000000aa',
        createdAt: '2001-01-01T00:00:00.000Z',
      });
    expect(createResponse.status).toBe(201);
    const created = successData(createResponse.body);
    expectApplianceDtoShape(created);
    expect(created).toMatchObject({ brand: 'Bosch', modelNumber: null });
    expect(created.id).not.toBe(forgedId);

    const stored = await prisma.appliance.findUniqueOrThrow({ where: { id: created.id as string } });
    expect(stored.userId).toBe(user.id);
    expect(stored.category).toBeNull();
    expect(stored.nickname).toBeNull();

    const listResponse = await request(app)
      .get('/appliances?page=1&limit=10')
      .set('Authorization', auth);
    expect(listResponse.status).toBe(200);
    const page = successData(listResponse.body);
    expect(page).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect((page.items as Array<{ id: string }>).map((item) => item.id)).toEqual([created.id]);

    const getResponse = await request(app)
      .get(`/appliances/${created.id}`)
      .set('Authorization', auth);
    expect(getResponse.status).toBe(200);
    expect(successData(getResponse.body)).toEqual(created);

    const patchResponse = await request(app)
      .patch(`/appliances/${created.id}`)
      .set('Authorization', auth)
      .send({
        brand: '  Samsung  ',
        category: ApplianceCategory.REFRIGERATOR,
        nickname: 'Laundry',
        userId: 'forged-user-id',
        id: forgedId,
        createdAt: '2001-01-01T00:00:00.000Z',
      });
    expect(patchResponse.status).toBe(200);
    const patchedDto = successData(patchResponse.body);
    expectApplianceDtoShape(patchedDto);
    expect(patchedDto).toMatchObject({ brand: 'Samsung', modelNumber: null });
    const patched = await prisma.appliance.findUniqueOrThrow({ where: { id: created.id as string } });
    expect(patched.brand).toBe('Samsung');
    expect(patched.category).toBeNull();
    expect(patched.nickname).toBeNull();

    const deleteResponse = await request(app)
      .delete(`/appliances/${created.id}`)
      .set('Authorization', auth);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ success: true, data: { message: 'Appliance deleted' } });
    expect(await prisma.appliance.findUnique({ where: { id: created.id as string } })).toBeNull();

    const afterDelete = await request(app)
      .get(`/appliances/${created.id}`)
      .set('Authorization', auth);
    expect(afterDelete.status).toBe(404);
    expect(afterDelete.body).toEqual({
      success: false,
      error: { code: 'APPLIANCE_NOT_FOUND', message: 'Appliance not found' },
    });
  });

  it('returns one identical 404 for foreign-owned get, patch and delete with a real database', async () => {
    const mine = await newUser();
    const other = await newUser();
    const owned = await createAppliance(other.user.id, { brand: 'Original brand' });
    const auth = bearer(mine.accessToken);
    const expectedError = {
      success: false,
      error: { code: 'APPLIANCE_NOT_FOUND', message: 'Appliance not found' },
    };

    const responses = [
      await request(app).get(`/appliances/${owned.id}`).set('Authorization', auth),
      await request(app)
        .patch(`/appliances/${owned.id}`)
        .set('Authorization', auth)
        .send({ brand: 'Stolen brand' }),
      await request(app).delete(`/appliances/${owned.id}`).set('Authorization', auth),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(expectedError);
    }

    const unchanged = await prisma.appliance.findUniqueOrThrow({ where: { id: owned.id } });
    expect(unchanged.brand).toBe('Original brand');
    expect(unchanged.userId).toBe(other.user.id);
  });
});
