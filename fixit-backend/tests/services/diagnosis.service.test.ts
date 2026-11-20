import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, Prisma, SessionStatus, Verdict } from '../../src/generated/prisma/client.js';
import { HttpError } from '../../src/utils/httpError.js';

const {
  prisma,
  runDiagnosisTurnMock,
  searchErrorCodesMock,
  searchReplacementPartsMock,
} = vi.hoisted(() => ({
  prisma: {
    diagnosisSession: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  runDiagnosisTurnMock: vi.fn(),
  searchErrorCodesMock: vi.fn(),
  searchReplacementPartsMock: vi.fn(),
}));

vi.mock('../../src/config/prisma.js', () => ({ prisma }));
vi.mock('../../src/services/ai/orchestrator.js', () => ({ runDiagnosisTurn: runDiagnosisTurnMock }));
vi.mock('../../src/services/parts.service.js', () => ({
  searchReplacementParts: searchReplacementPartsMock,
}));
vi.mock('../../src/services/knowledge.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/knowledge.service.js')>();
  return { ...actual, searchErrorCodes: searchErrorCodesMock };
});

import {
  completeSession,
  confirmFix,
  sendMessage,
} from '../../src/services/diagnosis.service.js';

const sessionId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-0000000000a1';

function openSession(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    status: SessionStatus.OPEN,
    context: null,
    appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: null },
    ...overrides,
  };
}

function userRow() {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    sessionId,
    role: MessageRole.USER,
    content: 'Why is it not draining?',
    createdAt: new Date('2026-11-19T00:00:00.000Z'),
    metadata: null,
  };
}

function assistantRow() {
  return {
    id: '00000000-0000-4000-8000-0000000000b2',
    sessionId,
    role: MessageRole.ASSISTANT,
    content: 'Let us narrow down the drain issue.',
    createdAt: new Date('2026-11-19T00:00:01.000Z'),
    metadata: {
      kind: 'ASSISTANT_TURN',
      requestId,
      progress: { status: 'OPEN', verdict: null, outcome: 'NEEDS_CLARIFICATION' },
      knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
      citations: [],
    },
  };
}

function orchestratorResult() {
  return {
    reply: 'Let us narrow down the drain issue.',
    progress: { status: 'OPEN' as const, verdict: null, outcome: 'NEEDS_CLARIFICATION' as const },
    knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    citations: [],
    nextContext: {
      suspectedComponents: [],
      diagnosticFacts: [],
      currentOutcome: 'NEEDS_CLARIFICATION' as const,
    },
    issueFixChallenge: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) =>
    callback(prisma),
  );
  prisma.diagnosisSession.findFirst.mockResolvedValue(openSession());
  prisma.diagnosisSession.updateMany.mockResolvedValue({ count: 1 });
  prisma.diagnosisSession.update.mockResolvedValue({});
  prisma.diagnosisSession.findUniqueOrThrow.mockResolvedValue({
    id: sessionId,
    applianceId: '00000000-0000-4000-8000-0000000000c1',
    symptom: 'Not draining',
    status: SessionStatus.OPEN,
    verdict: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  prisma.message.findMany.mockResolvedValue([]);
  prisma.message.findFirst.mockResolvedValue(null);
  prisma.message.create.mockImplementation(async ({ data }: { data: { role: MessageRole } }) =>
    data.role === MessageRole.ASSISTANT ? assistantRow() : userRow(),
  );
  searchErrorCodesMock.mockResolvedValue({ unverified: false, errorCodes: [], repairSteps: [] });
  searchReplacementPartsMock.mockResolvedValue({ note: 'disabled', candidates: [] });
  runDiagnosisTurnMock.mockResolvedValue(orchestratorResult());
});

describe('sendMessage reliability', () => {
  it('returns the stored turn for a replayed request without provider work or writes', async () => {
    prisma.message.findFirst.mockImplementation(async ({ where }: { where: { role: MessageRole } }) =>
      where.role === MessageRole.USER ? userRow() : assistantRow(),
    );

    const result = await sendMessage('user-1', { id: sessionId }, {
      requestId,
      content: 'Why is it not draining?',
    });

    expect(result.assistantMessage.id).toBe(assistantRow().id);
    expect(runDiagnosisTurnMock).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('does not persist a partial turn when the provider fails', async () => {
    runDiagnosisTurnMock.mockRejectedValueOnce(
      new HttpError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'),
    );

    await expect(
      sendMessage('user-1', { id: sessionId }, { requestId, content: 'Provider fails' }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });

    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.diagnosisSession.update).not.toHaveBeenCalled();
  });

  it('shares one in-flight provider turn for concurrent duplicate requests', async () => {
    let resolveTurn: (value: ReturnType<typeof orchestratorResult>) => void = () => undefined;
    const pending = new Promise<ReturnType<typeof orchestratorResult>>((resolve) => {
      resolveTurn = resolve;
    });
    runDiagnosisTurnMock.mockReturnValueOnce(pending);

    const first = sendMessage('user-1', { id: sessionId }, { requestId, content: 'Concurrent duplicate' });
    const second = sendMessage('user-1', { id: sessionId }, { requestId, content: 'Concurrent duplicate' });
    resolveTurn(orchestratorResult());

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(runDiagnosisTurnMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale concurrent turn without overwriting session context', async () => {
    prisma.diagnosisSession.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.diagnosisSession.findUnique.mockResolvedValueOnce({ status: SessionStatus.OPEN });

    await expect(
      sendMessage('user-1', { id: sessionId }, { requestId, content: 'Stale snapshot' }),
    ).rejects.toMatchObject({ code: 'SESSION_CONFLICT' });

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('recovers from a uniqueness race by returning the winning turn', async () => {
    let storedTurnAvailable = false;
    prisma.message.findFirst.mockImplementation(async ({ where }: { where: { role: MessageRole } }) => {
      if (!storedTurnAvailable) return null;
      return where.role === MessageRole.USER ? userRow() : assistantRow();
    });
    prisma.message.create
      .mockImplementationOnce(async () => {
        storedTurnAvailable = true;
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });
      })
      .mockImplementationOnce(async () => userRow())
      .mockImplementationOnce(async () => assistantRow());

    const result = await sendMessage('user-1', { id: sessionId }, {
      requestId,
      content: 'Concurrent duplicate',
    });

    expect(runDiagnosisTurnMock).toHaveBeenCalledTimes(1);
    expect(result.assistantMessage.id).toBe(assistantRow().id);
  });

  it('keeps Groq outside the persistence transaction', async () => {
    let providerCalledInsideTransaction = false;
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) => {
      providerCalledInsideTransaction = true;
      try {
        return await callback(prisma);
      } finally {
        providerCalledInsideTransaction = false;
      }
    });
    runDiagnosisTurnMock.mockImplementation(async () => {
      expect(providerCalledInsideTransaction).toBe(false);
      return orchestratorResult();
    });

    await sendMessage('user-1', { id: sessionId }, { requestId, content: 'No long transaction' });

    expect(runDiagnosisTurnMock).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('confirmFix and completeSession', () => {
  it('confirms only the issued challenge and sets FIXED atomically', async () => {
    const challenge = 'server-issued-challenge';
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      openSession({
        fixConfirmationChallengeId: createHash('sha256').update(challenge).digest('hex'),
        fixConfirmationIssuedAt: new Date(),
        fixConfirmationExpiresAt: new Date(Date.now() + 60_000),
      }),
    );

    await expect(
      confirmFix('user-1', { id: sessionId }, { challengeId: 'wrong' }),
    ).rejects.toMatchObject({ code: 'INVALID_FIX_CONFIRMATION' });
    expect(prisma.diagnosisSession.updateMany).not.toHaveBeenCalled();

    const result = await confirmFix('user-1', { id: sessionId }, { challengeId: challenge });
    expect(result.status).toBe(SessionStatus.OPEN);
    expect(prisma.diagnosisSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SessionStatus.COMPLETED,
          verdict: Verdict.FIXED,
          fixConfirmationChallengeId: null,
        }),
      }),
    );
  });

  it('completes only a session with a backend-set terminal verdict', async () => {
    prisma.diagnosisSession.findFirst.mockResolvedValue(openSession({ verdict: null }));

    await expect(
      completeSession('user-1', { id: sessionId }, { acknowledged: true }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_COMPLETABLE' });

    prisma.diagnosisSession.findFirst.mockResolvedValue(
      openSession({ verdict: Verdict.TECHNICIAN_REQUIRED }),
    );
    await completeSession('user-1', { id: sessionId }, { acknowledged: true });

    expect(prisma.diagnosisSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: SessionStatus.COMPLETED },
      }),
    );
  });
});
