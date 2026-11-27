import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole } from '../../src/generated/prisma/client.js';
import { createSessionSchema } from '../../src/validators/diagnosis.validator.js';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    appliance: { findFirst: vi.fn(), create: vi.fn() },
    diagnosisSession: { create: vi.fn() },
    message: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/config/prisma.js', () => ({ prisma }));

import { createSession } from '../../src/services/session.service.js';

const userId = '00000000-0000-7000-8000-000000000000';
const applianceId = '00000000-0000-7000-8000-000000000001';
const sessionId = '00000000-0000-7000-8000-000000000002';

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    applianceId,
    symptom: 'Not draining',
    errorCode: 'FE',
    status: 'OPEN',
    verdict: null,
    createdAt: new Date('2026-11-27T00:00:00.000Z'),
    updatedAt: new Date('2026-11-27T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  prisma.appliance.findFirst.mockResolvedValue({ id: applianceId });
  prisma.appliance.create.mockResolvedValue({ id: applianceId });
  prisma.diagnosisSession.create.mockResolvedValue(sessionRow());
  prisma.message.create.mockResolvedValue({ id: '00000000-0000-7000-8000-000000000003' });
});

describe('createSession', () => {
  it('creates a session for an owned appliance with the persisted text error code', async () => {
    const input = createSessionSchema.parse({
      applianceId,
      symptom: '  Not draining  ',
      errorCode: '  FE  ',
    });

    await createSession(userId, input);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.appliance.findFirst).toHaveBeenCalledWith({
      where: { id: applianceId, userId },
      select: { id: true },
    });
    expect(prisma.appliance.create).not.toHaveBeenCalled();
    expect(prisma.diagnosisSession.create).toHaveBeenCalledWith({
      data: {
        userId,
        applianceId,
        symptom: 'Not draining',
        errorCode: 'FE',
      },
      select: expect.objectContaining({ errorCode: true }),
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        sessionId,
        role: MessageRole.USER,
        content: 'Not draining\nFE',
      },
    });
  });

  it('creates and links a new owned appliance for inline brand/model input', async () => {
    const input = createSessionSchema.parse({
      brand: '  LG  ',
      modelNumber: '  WW80T3040WW ',
      symptom: 'Not draining',
      errorCode: 'FE',
      // Client-supplied ownership and internal ids must never be trusted.
      userId: '00000000-0000-7000-8000-0000000000ff',
      errorCodeId: '00000000-0000-7000-8000-0000000000ee',
    });

    await createSession(userId, input);

    expect(prisma.appliance.findFirst).not.toHaveBeenCalled();
    expect(prisma.appliance.create).toHaveBeenCalledWith({
      data: { userId, brand: 'LG', modelNumber: 'WW80T3040WW' },
      select: { id: true },
    });
    expect(prisma.diagnosisSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId,
          applianceId,
          symptom: 'Not draining',
          errorCode: 'FE',
        },
      }),
    );
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it('stores a null error code when the optional clue is omitted', async () => {
    await createSession(userId, createSessionSchema.parse({ applianceId, symptom: 'Not draining' }));

    expect(prisma.diagnosisSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorCode: null }),
      }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'Not draining' }) }),
    );
  });

  it('rejects a foreign appliance without creating a session or message', async () => {
    prisma.appliance.findFirst.mockResolvedValue(null);
    const input = createSessionSchema.parse({ applianceId, symptom: 'Not draining' });

    await expect(createSession(userId, input)).rejects.toMatchObject({
      statusCode: 404,
      code: 'APPLIANCE_NOT_FOUND',
    });
    expect(prisma.diagnosisSession.create).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('propagates a failed initial message so the transaction cannot commit', async () => {
    prisma.message.create.mockRejectedValue(new Error('write failed'));
    const input = createSessionSchema.parse({ applianceId, symptom: 'Not draining' });

    await expect(createSession(userId, input)).rejects.toThrow('write failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
