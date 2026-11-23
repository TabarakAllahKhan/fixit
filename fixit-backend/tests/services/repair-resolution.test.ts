import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewStatus, SourceKind } from '../../src/generated/prisma/client.js';
import { resolveTrustedApplianceIdentity } from '../../src/services/ai/appliance-identity.js';
import { emptyDiagnosisContext, type DiagnosisContextDto } from '../../src/validators/ai.validator.js';

const { findManyMock, createInteractionMock, getApprovedRepairSequenceMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  createInteractionMock: vi.fn(),
  getApprovedRepairSequenceMock: vi.fn(),
}));

vi.mock('../../src/config/prisma.js', () => ({
  prisma: { errorCode: { findMany: findManyMock } },
}));

vi.mock('../../src/services/ai/provider.js', () => ({
  createAiInteraction: createInteractionMock,
}));

// Keep the real searchErrorCodes() so resolution is exercised against actual
// backend candidates. Only the sequence lookup is stubbed with deterministic
// approved data.
vi.mock('../../src/services/knowledge.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/knowledge.service.js')>();
  return { ...actual, getApprovedRepairSequence: getApprovedRepairSequenceMock };
});

import { runDiagnosisTurn, type OrchestratorInput } from '../../src/services/ai/orchestrator.js';

type Row = {
  id: string;
  category: 'WASHING_MACHINE' | 'REFRIGERATOR';
  brand: string;
  code: string;
  meaning: string;
  modelScope: string;
  reviewStatus: ReviewStatus;
  source: { title: string; url: string | null; kind: string };
};

let rows: Row[] = [];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    category: overrides.category ?? 'WASHING_MACHINE',
    brand: overrides.brand ?? 'TestBrand',
    code: overrides.code ?? 'FE',
    meaning: 'Drain blockage indicated',
    modelScope: overrides.modelScope ?? 'TOP_LOAD',
    reviewStatus: overrides.reviewStatus ?? ReviewStatus.APPROVED,
    source: {
      title: 'Service manual',
      url: 'https://example.invalid/manual',
      kind: SourceKind.MANUAL,
    },
  };
}

const approvedSequence = {
  eligible: true,
  errorCodeId: '00000000-0000-4000-8000-000000000001',
  steps: [
    {
      position: 1,
      instruction: 'Clear the drain filter.',
      source: { title: 'Service manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
    },
  ],
  citation: { title: 'Service manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
};

function completion(name: string, args: unknown, id: string) {
  const step = { type: 'function_call', id, name, arguments: args };
  return {
    calls: [{ id, name, arguments: args, step }],
    steps: [step],
    text: '',
    finishReason: 'completed',
  };
}

function input(context: DiagnosisContextDto = emptyDiagnosisContext()): OrchestratorInput {
  const trustedIdentity = resolveTrustedApplianceIdentity({
    appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: null },
    userMessages: [],
    currentUserContent: 'top-load washer',
  });
  expect(trustedIdentity.modelScope).toBe('TOP_LOAD');
  return {
    identity: trustedIdentity,
    context,
    history: [],
    userContent: 'The washer shows an error',
    knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    includeUnreviewed: false,
    partsSearch: vi.fn(),
  };
}

async function callRepairSteps(errorCode: string, context?: DiagnosisContextDto) {
  createInteractionMock
    .mockResolvedValueOnce(completion('get_repair_steps', { errorCode }, 'call-repair'))
    .mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', { reply: 'Follow the steps.', outcome: 'READY_FOR_CONFIRMATION' }, 'call-final'),
    );
  return runDiagnosisTurn(input(context));
}

beforeEach(() => {
  rows = [];
  createInteractionMock.mockReset();
  getApprovedRepairSequenceMock
    .mockReset()
    .mockResolvedValue({ eligible: false, reason: 'No approved repair sequence is available.', steps: [] });
  findManyMock.mockReset().mockImplementation(async (args: {
    where: {
      category: string;
      brand: string;
      code: { in: string[] };
      reviewStatus: { in: ReviewStatus[] };
    };
  }) => {
    const { where } = args;
    return rows.filter(
      (candidate) =>
        candidate.category === where.category &&
        candidate.brand === where.brand &&
        where.code.in.some(
          (code) => code.trim().toLowerCase() === candidate.code.trim().toLowerCase(),
        ) &&
        where.reviewStatus.in.includes(candidate.reviewStatus),
    );
  });
});

describe('get_repair_steps resolution through real backend knowledge search', () => {
  it('resolves a searched code to the backend-derived UUID', async () => {
    const knowledge = row({ code: 'FE' });
    rows = [knowledge];
    getApprovedRepairSequenceMock.mockResolvedValueOnce(approvedSequence);

    const result = await callRepairSteps('FE');

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'WASHING_MACHINE',
          brand: 'TestBrand',
          code: { in: ['FE'], mode: 'insensitive' },
        }),
      }),
    );
    expect(getApprovedRepairSequenceMock).toHaveBeenCalledWith(
      knowledge.id,
      expect.objectContaining({ category: 'WASHING_MACHINE', brand: 'TestBrand', modelScope: 'TOP_LOAD' }),
      false,
    );
    expect(result.errorCodeId).toBe(knowledge.id);
    expect(result.progress.outcome).toBe('READY_FOR_CONFIRMATION');
    expect(result.issueFixChallenge).toBe(true);
  });

  it('resolves a mixed-case stored code from normalized input', async () => {
    const knowledge = row({ code: 'dC' });
    rows = [knowledge];
    getApprovedRepairSequenceMock.mockResolvedValueOnce(approvedSequence);

    const result = await callRepairSteps('DC');

    expect(getApprovedRepairSequenceMock).toHaveBeenCalledWith(knowledge.id, expect.anything(), false);
    expect(result.errorCodeId).toBe(knowledge.id);
  });

  it('rejects a wrong-brand candidate returned by no backend search', async () => {
    rows = [row({ brand: 'OtherBrand' })];

    const result = await callRepairSteps('FE');

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ brand: 'TestBrand' }) }),
    );
    expect(getApprovedRepairSequenceMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.issueFixChallenge).toBe(false);
  });

  it('rejects a wrong-model-scope candidate', async () => {
    rows = [row({ modelScope: 'FRONT_LOAD' })];

    const result = await callRepairSteps('FE');

    expect(getApprovedRepairSequenceMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.issueFixChallenge).toBe(false);
  });

  it('rejects an unapproved candidate', async () => {
    rows = [row({ reviewStatus: ReviewStatus.UNREVIEWED })];

    const result = await callRepairSteps('FE');

    expect(getApprovedRepairSequenceMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.issueFixChallenge).toBe(false);
  });

  it('does not select arbitrarily when normalized candidates are ambiguous', async () => {
    rows = [
      row({ code: 'FE', id: '00000000-0000-4000-8000-000000000001' }),
      row({ code: ' fe ', id: '00000000-0000-4000-8000-000000000002' }),
    ];

    const result = await callRepairSteps('FE');

    expect(getApprovedRepairSequenceMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.issueFixChallenge).toBe(false);
  });

  it('returns ineligible for an unknown code without a sequence lookup', async () => {
    rows = [];

    const result = await callRepairSteps('ZZ');

    expect(getApprovedRepairSequenceMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });
});
