import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplianceCategory, Prisma } from '../../src/generated/prisma/client.js';
import { applianceDtoSelect, toApplianceDto } from '../../src/types/appliance.dto.js';
import { HttpError } from '../../src/utils/httpError.js';
import type { CreateApplianceInput, UpdateApplianceInput } from '../../src/validators/appliance.validator.js';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    appliance: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    // Present so the deletion tests can prove these tables are never touched.
    diagnosisSession: {
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    message: {
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/config/prisma.js', () => ({ prisma }));

import {
  createAppliance,
  deleteAppliance,
  getApplianceById,
  listAppliances,
  updateAppliance,
} from '../../src/services/appliance.service.js';

const userId = '00000000-0000-4000-8000-0000000000a1';
const otherUserId = '00000000-0000-4000-8000-0000000000a2';
const applianceId = '00000000-0000-4000-8000-0000000000b1';
const foreignApplianceId = '00000000-0000-4000-8000-0000000000b2';
const createdAt = new Date('2026-11-20T00:00:00.000Z');
const updatedAt = new Date('2026-11-20T01:00:00.000Z');

const DTO_KEYS = ['id', 'brand', 'modelNumber', 'createdAt', 'updatedAt'];

// The mocked row deliberately carries the legacy category/nickname columns:
// raw Prisma records may contain them, but no DTO may expose them.
const applianceRecord = {
  id: applianceId,
  userId,
  category: ApplianceCategory.WASHING_MACHINE,
  brand: 'Bosch',
  modelNumber: 'WGG244Z0GB',
  nickname: 'Main washer',
  createdAt,
  updatedAt,
};

function applianceRow(overrides: Partial<typeof applianceRecord> = {}) {
  return { ...applianceRecord, ...overrides };
}

function recordNotFoundError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

async function expectNotFound(result: Promise<unknown>): Promise<void> {
  await expect(result).rejects.toBeInstanceOf(HttpError);
  await expect(result).rejects.toMatchObject({
    statusCode: 404,
    code: 'APPLIANCE_NOT_FOUND',
    message: 'Appliance not found',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  prisma.appliance.create.mockResolvedValue(applianceRow());
  prisma.appliance.findMany.mockResolvedValue([applianceRow()]);
  prisma.appliance.count.mockResolvedValue(1);
  prisma.appliance.findFirst.mockResolvedValue(applianceRow());
  prisma.appliance.update.mockResolvedValue(applianceRow({ brand: 'Updated Brand' }));
  prisma.appliance.delete.mockResolvedValue(applianceRow());
});

describe('createAppliance', () => {
  const input: CreateApplianceInput = {
    brand: 'Bosch',
    modelNumber: 'WGG244Z0GB',
  };

  it('assigns the authenticated userId and persists only validated input', async () => {
    const result = await createAppliance(userId, input);

    expect(prisma.appliance.create).toHaveBeenCalledTimes(1);
    expect(prisma.appliance.create).toHaveBeenCalledWith({
      data: {
        userId,
        brand: input.brand,
        modelNumber: input.modelNumber,
      },
      select: applianceDtoSelect,
    });
    expect(result).toEqual(toApplianceDto(applianceRecord));
    expect(Object.keys(result).sort()).toEqual([...DTO_KEYS].sort());
  });

  it('returns a public DTO with no userId or raw record data', async () => {
    prisma.appliance.create.mockResolvedValueOnce({
      ...applianceRow(),
      passwordHash: 'must-not-leak',
    });

    const result = await createAppliance(userId, input);

    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain(userId);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('never exposes the legacy category or nickname columns', async () => {
    const result = await createAppliance(userId, input);

    expect(result).not.toHaveProperty('category');
    expect(result).not.toHaveProperty('nickname');
    expect(JSON.stringify(result)).not.toContain('WASHING_MACHINE');
    expect(JSON.stringify(result)).not.toContain('Main washer');
  });

  it('ignores client-supplied id, userId, timestamps and legacy fields', async () => {
    const forged = {
      ...input,
      category: ApplianceCategory.REFRIGERATOR,
      nickname: 'Forged nickname',
      id: foreignApplianceId,
      userId: otherUserId,
      createdAt: new Date('1999-01-01T00:00:00.000Z'),
      updatedAt: new Date('1999-01-01T00:00:00.000Z'),
    } as unknown as CreateApplianceInput;

    await createAppliance(userId, forged);

    const { data } = prisma.appliance.create.mock.calls[0][0];
    expect(data.userId).toBe(userId);
    expect(Object.keys(data).sort()).toEqual(['brand', 'modelNumber', 'userId']);
  });

  it('normalizes an omitted modelNumber to null', async () => {
    await createAppliance(userId, { brand: 'LG' });

    expect(prisma.appliance.create).toHaveBeenCalledWith({
      data: { userId, brand: 'LG', modelNumber: null },
      select: applianceDtoSelect,
    });
  });

  it('propagates unexpected Prisma failures without wrapping them', async () => {
    const failure = new Error('database unavailable');
    prisma.appliance.create.mockRejectedValueOnce(failure);

    await expect(createAppliance(userId, input)).rejects.toBe(failure);
  });
});

describe('listAppliances', () => {
  it('filters by owner, orders stably and returns paginated DTO metadata', async () => {
    const result = await listAppliances(userId, { page: 2, limit: 5 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.appliance.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.appliance.findMany).toHaveBeenCalledWith({
      where: { userId },
      select: applianceDtoSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 5,
      take: 5,
    });
    expect(prisma.appliance.count).toHaveBeenCalledWith({ where: { userId } });
    expect(result).toEqual({
      items: [toApplianceDto(applianceRecord)],
      page: 2,
      limit: 5,
      total: 1,
      totalPages: 1,
    });
    expect(Object.keys(result.items[0]).sort()).toEqual([...DTO_KEYS].sort());
    expect(result.items[0]).not.toHaveProperty('category');
    expect(result.items[0]).not.toHaveProperty('nickname');
  });

  it('returns an empty page without errors', async () => {
    prisma.appliance.findMany.mockResolvedValueOnce([]);
    prisma.appliance.count.mockResolvedValueOnce(0);

    const result = await listAppliances(userId, { page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('never queries or returns another user\'s appliances', async () => {
    prisma.appliance.findMany.mockResolvedValueOnce([applianceRow({ userId: otherUserId })]);

    const result = await listAppliances(userId, { page: 1, limit: 20 });

    expect(prisma.appliance.findMany.mock.calls[0][0].where).toEqual({ userId });
    expect(JSON.stringify(result)).not.toContain(otherUserId);
    expect(result.items[0]).not.toHaveProperty('userId');
  });

  it('propagates unexpected Prisma failures without wrapping them', async () => {
    const failure = new Error('database unavailable');
    prisma.appliance.findMany.mockRejectedValueOnce(failure);

    await expect(listAppliances(userId, { page: 1, limit: 20 })).rejects.toBe(failure);
  });
});

describe('getApplianceById', () => {
  it('returns the owned appliance using an owner-scoped lookup', async () => {
    const result = await getApplianceById(userId, { id: applianceId });

    expect(prisma.appliance.findFirst).toHaveBeenCalledWith({
      where: { id: applianceId, userId },
      select: applianceDtoSelect,
    });
    expect(result).toEqual(toApplianceDto(applianceRecord));
    expect(Object.keys(result).sort()).toEqual([...DTO_KEYS].sort());
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('category');
    expect(result).not.toHaveProperty('nickname');
  });

  it('returns APPLIANCE_NOT_FOUND for a missing appliance', async () => {
    prisma.appliance.findFirst.mockResolvedValueOnce(null);

    await expectNotFound(getApplianceById(userId, { id: foreignApplianceId }));
    expect(prisma.appliance.findFirst).toHaveBeenCalledWith({
      where: { id: foreignApplianceId, userId },
      select: applianceDtoSelect,
    });
  });

  it('returns the same 404 for a foreign-owned appliance', async () => {
    prisma.appliance.findFirst.mockImplementationOnce(
      async ({ where }: { where: { id: string; userId: string } }) =>
        where.userId === applianceRecord.userId ? applianceRow() : null,
    );

    await expectNotFound(getApplianceById(otherUserId, { id: applianceId }));
    expect(prisma.appliance.findFirst).toHaveBeenCalledWith({
      where: { id: applianceId, userId: otherUserId },
      select: applianceDtoSelect,
    });
  });

  it('propagates unexpected Prisma failures without wrapping them', async () => {
    const failure = new Error('database unavailable');
    prisma.appliance.findFirst.mockRejectedValueOnce(failure);

    await expect(getApplianceById(userId, { id: applianceId })).rejects.toBe(failure);
  });
});

describe('updateAppliance', () => {
  it('updates an owned appliance through a conditional owner-scoped write', async () => {
    const result = await updateAppliance(userId, { id: applianceId }, { brand: 'Updated Brand' });

    expect(prisma.appliance.update).toHaveBeenCalledTimes(1);
    expect(prisma.appliance.update).toHaveBeenCalledWith({
      where: { id: applianceId, userId },
      data: { brand: 'Updated Brand' },
      select: applianceDtoSelect,
    });
    expect(result).toEqual(toApplianceDto(applianceRow({ brand: 'Updated Brand' })));
    expect(Object.keys(result).sort()).toEqual([...DTO_KEYS].sort());
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('category');
    expect(result).not.toHaveProperty('nickname');
  });

  it('leaves omitted fields out of the write so they remain unchanged', async () => {
    await updateAppliance(userId, { id: applianceId }, { modelNumber: 'Only this changes' });

    expect(prisma.appliance.update.mock.calls[0][0].data).toEqual({ modelNumber: 'Only this changes' });
  });

  it('sends explicit null so nullable fields can be cleared', async () => {
    await updateAppliance(userId, { id: applianceId }, { modelNumber: null });

    expect(prisma.appliance.update.mock.calls[0][0].data).toEqual({ modelNumber: null });
  });

  it('never lets server-managed or legacy fields reach Prisma', async () => {
    const forged = {
      brand: 'Updated Brand',
      category: ApplianceCategory.REFRIGERATOR,
      nickname: 'Forged nickname',
      id: foreignApplianceId,
      userId: otherUserId,
      createdAt: new Date('1999-01-01T00:00:00.000Z'),
      updatedAt: new Date('1999-01-01T00:00:00.000Z'),
    } as unknown as UpdateApplianceInput;

    await updateAppliance(userId, { id: applianceId }, forged);

    const call = prisma.appliance.update.mock.calls[0][0];
    expect(call.data).toEqual({ brand: 'Updated Brand' });
    expect(call.where).toEqual({ id: applianceId, userId });
  });

  it('returns APPLIANCE_NOT_FOUND when the appliance is missing', async () => {
    prisma.appliance.update.mockRejectedValueOnce(recordNotFoundError());

    await expectNotFound(updateAppliance(userId, { id: foreignApplianceId }, { brand: 'Nope' }));
  });

  it('returns the same 404 for a foreign-owned appliance and keeps the write scoped', async () => {
    prisma.appliance.update.mockImplementationOnce(
      async ({ where }: { where: { id: string; userId: string } }) => {
        if (where.id !== applianceRecord.id || where.userId !== applianceRecord.userId) {
          throw recordNotFoundError();
        }
        return applianceRow();
      },
    );

    await expectNotFound(updateAppliance(otherUserId, { id: applianceId }, { brand: 'Not mine' }));
    expect(prisma.appliance.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: applianceId, userId: otherUserId } }),
    );
  });

  it('propagates unexpected Prisma failures without wrapping them', async () => {
    const failure = new Error('database unavailable');
    prisma.appliance.update.mockRejectedValueOnce(failure);

    await expect(updateAppliance(userId, { id: applianceId }, { brand: 'X' })).rejects.toBe(failure);
  });
});

describe('deleteAppliance', () => {
  it('hard-deletes only the owned appliance row', async () => {
    await expect(deleteAppliance(userId, { id: applianceId })).resolves.toBeUndefined();

    expect(prisma.appliance.delete).toHaveBeenCalledTimes(1);
    expect(prisma.appliance.delete).toHaveBeenCalledWith({ where: { id: applianceId, userId } });
  });

  it('does not cascade manually to sessions, messages or other appliance rows', async () => {
    await deleteAppliance(userId, { id: applianceId });

    expect(prisma.appliance.update).not.toHaveBeenCalled();
    expect(prisma.appliance.updateMany).not.toHaveBeenCalled();
    expect(prisma.appliance.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.diagnosisSession.delete).not.toHaveBeenCalled();
    expect(prisma.diagnosisSession.deleteMany).not.toHaveBeenCalled();
    expect(prisma.diagnosisSession.update).not.toHaveBeenCalled();
    expect(prisma.diagnosisSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.message.delete).not.toHaveBeenCalled();
    expect(prisma.message.deleteMany).not.toHaveBeenCalled();
  });

  it('returns APPLIANCE_NOT_FOUND when the appliance is missing', async () => {
    prisma.appliance.delete.mockRejectedValueOnce(recordNotFoundError());

    await expectNotFound(deleteAppliance(userId, { id: foreignApplianceId }));
  });

  it('returns the same 404 for a foreign-owned appliance and keeps the delete scoped', async () => {
    prisma.appliance.delete.mockImplementationOnce(async ({ where }: { where: { id: string; userId: string } }) => {
      if (where.id !== applianceRecord.id || where.userId !== applianceRecord.userId) {
        throw recordNotFoundError();
      }
      return applianceRow();
    });

    await expectNotFound(deleteAppliance(otherUserId, { id: applianceId }));
    expect(prisma.appliance.delete).toHaveBeenCalledWith({ where: { id: applianceId, userId: otherUserId } });
  });

  it('propagates unexpected Prisma failures without wrapping them', async () => {
    const failure = new Error('database unavailable');
    prisma.appliance.delete.mockRejectedValueOnce(failure);

    await expect(deleteAppliance(userId, { id: applianceId })).rejects.toBe(failure);
  });
});
