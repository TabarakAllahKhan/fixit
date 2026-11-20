import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewStatus, SafetyClass, SourceKind } from '../../src/generated/prisma/client.js';

const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    errorCode: {
      findMany: findManyMock,
      findUnique: findUniqueMock,
    },
  },
}));

import {
  extractCandidateCodes,
  getApprovedRepairSequence,
  searchErrorCodes,
} from '../../src/services/knowledge.service.js';

const source = {
  title: 'Service manual',
  url: 'https://example.invalid/manual',
  kind: SourceKind.MANUAL,
};

const context = {
  category: 'WASHING_MACHINE' as const,
  brand: 'TestBrand',
  modelScope: 'TOP_LOAD' as const,
};

beforeEach(() => {
  findManyMock.mockReset();
  findUniqueMock.mockReset();
});

describe('extractCandidateCodes', () => {
  it('extracts bounded code-like tokens without creating diagnoses', () => {
    expect(extractCandidateCodes(['Error FE on my washer', 'E1 and NF1 maybe'])).toEqual([
      'FE',
      'E1',
      'NF1',
    ]);
    expect(extractCandidateCodes(['THE AND FOR NOT'.split(' ').join(' ')])).toEqual([]);
  });
});

describe('searchErrorCodes', () => {
  it('retrieves only approved rows and marks exact-scope matches as trusted', async () => {
    findManyMock.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000001',
        code: 'FE',
        meaning: 'Drain issue',
        modelScope: 'TOP_LOAD',
        reviewStatus: ReviewStatus.APPROVED,
        source,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        code: 'E1',
        meaning: 'Unknown scope',
        modelScope: 'UNSPECIFIED',
        reviewStatus: ReviewStatus.APPROVED,
        source,
      },
    ]);

    const result = await searchErrorCodes(context, ['fe', 'E1'], false);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'WASHING_MACHINE',
          brand: 'TestBrand',
          code: { in: ['FE', 'E1'], mode: 'insensitive' },
          reviewStatus: { in: [ReviewStatus.APPROVED] },
        }),
      }),
    );
    expect(result.unverified).toBe(false);
    expect(result.errorCodes[0]).toMatchObject({ code: 'FE', trusted: true });
    expect(result.errorCodes[1]).toMatchObject({ code: 'E1', trusted: false });
    expect(result.errorCodes[1]?.reason).toMatch(/applicability is unspecified/i);
    expect(result.repairSteps).toEqual([]);
  });

  it('looks up mixed-case manufacturer codes case-insensitively', async () => {
    findManyMock.mockResolvedValue([]);

    await searchErrorCodes(context, ['dc'], false);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: { in: ['DC'], mode: 'insensitive' } }),
      }),
    );
  });

  it('labels development-only unreviewed knowledge as unverified', async () => {
    findManyMock.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000003',
        code: 'DE',
        meaning: 'Door issue',
        modelScope: 'TOP_LOAD',
        reviewStatus: ReviewStatus.UNREVIEWED,
        source,
      },
    ]);

    const result = await searchErrorCodes(context, ['DE'], true);

    expect(result.unverified).toBe(true);
    expect(result.errorCodes[0]?.trusted).toBe(false);
    expect(result.note).toMatch(/must not be treated as authoritative/i);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reviewStatus: { in: [ReviewStatus.APPROVED, ReviewStatus.UNREVIEWED] },
        }),
      }),
    );
  });

  it('does not query when no bounded codes are found', async () => {
    const result = await searchErrorCodes(context, [], false);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(result.errorCodes).toEqual([]);
  });
});

describe('getApprovedRepairSequence', () => {
  const errorCodeId = '00000000-0000-4000-8000-000000000001';

  function codeWithSteps(overrides: {
    reviewStatus?: ReviewStatus;
    modelScope?: string;
    stepStatus?: ReviewStatus;
    linkStatus?: ReviewStatus;
    safetyClass?: SafetyClass;
    empty?: boolean;
  } = {}) {
    return {
      id: errorCodeId,
      category: 'WASHING_MACHINE',
      brand: 'TestBrand',
      code: 'FE',
      meaning: 'Drain issue',
      modelScope: overrides.modelScope ?? 'TOP_LOAD',
      reviewStatus: overrides.reviewStatus ?? ReviewStatus.APPROVED,
      source,
      repairStepLinks: overrides.empty
        ? []
        : [
            {
              position: 1,
              reviewStatus: overrides.linkStatus ?? ReviewStatus.APPROVED,
              repairStep: {
                instruction: 'Clear the drain filter.',
                reviewStatus: overrides.stepStatus ?? ReviewStatus.APPROVED,
                safetyClass: overrides.safetyClass ?? SafetyClass.USER_SAFE,
                source,
              },
            },
          ],
    };
  }

  it('returns a complete approved user-safe sequence with a citation', async () => {
    findUniqueMock.mockResolvedValue(codeWithSteps());

    const result = await getApprovedRepairSequence(errorCodeId, context, false);

    expect(result.eligible).toBe(true);
    expect(result.errorCodeId).toBe(errorCodeId);
    expect(result.steps).toEqual([
      { position: 1, instruction: 'Clear the drain filter.', source: { title: source.title, url: source.url, sourceKind: 'MANUAL' } },
    ]);
    expect(result.citation?.title).toBe('Service manual');
  });

  it.each([
    ['unapproved code', { reviewStatus: ReviewStatus.UNREVIEWED }, /not approved/i],
    ['missing scope', { modelScope: 'UNSPECIFIED' }, /model scope/i],
    ['mismatched scope', { modelScope: 'FRONT_LOAD' }, /model scope/i],
    ['empty sequence', { empty: true }, /no approved repair sequence/i],
    ['unapproved link', { linkStatus: ReviewStatus.UNREVIEWED }, /not approved/i],
    ['unapproved step', { stepStatus: ReviewStatus.UNREVIEWED }, /unreviewed/i],
    ['technician-only step', { safetyClass: SafetyClass.TECHNICIAN_ONLY }, /technician-only/i],
  ])('rejects %s', async (_label, overrides, reason) => {
    findUniqueMock.mockResolvedValue(codeWithSteps(overrides));

    const result = await getApprovedRepairSequence(errorCodeId, context, true);

    expect(result.eligible).toBe(false);
    expect(result.steps).toEqual([]);
    expect(result.reason).toMatch(reason);
  });

  it('rejects a code from another appliance category or brand', async () => {
    findUniqueMock.mockResolvedValue({ ...codeWithSteps(), brand: 'OtherBrand' });

    const result = await getApprovedRepairSequence(errorCodeId, context, false);

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not applicable/i);
  });
});
