import { describe, expect, it } from 'vitest';
import {
  parseAssistantMetadata,
  parseDiagnosisContext,
  submitDiagnosisOutcomeSchema,
} from '../../src/validators/ai.validator.js';

const identity = {
  version: 1,
  modelNumber: 'USER-MODEL-1',
  modelSource: 'USER_MESSAGE',
  modelScope: null,
  scopeSource: null,
};

describe('diagnosis context resilience', () => {
  it.each([
    ['research', { version: 2, key: 'x', result: {} }],
    ['research', 'not-an-object'],
    ['providedTroubleshooting', [42, null]],
  ])('drops a corrupt optional %s section without resetting trusted identity', (key, value) => {
    const parsed = parseDiagnosisContext({
      trustedApplianceIdentity: identity,
      suspectedComponents: ['drain pump'],
      diagnosticFacts: ['Water remains in the tub'],
      [key]: value,
    });

    expect(parsed.trustedApplianceIdentity).toEqual(identity);
    expect(parsed.suspectedComponents).toEqual(['drain pump']);
    expect(parsed).not.toHaveProperty(key, value);
    expect((parsed as Record<string, unknown>)[key]).toBeUndefined();
  });

  it('keeps valid research, safety and troubleshooting sections', () => {
    const research = {
      version: 1,
      key: 'a'.repeat(64),
      researchedAt: '2026-11-28T00:00:00.000Z',
      result: { status: 'NO_EVIDENCE', confidence: 'INSUFFICIENT', results: [] },
    };
    const parsed = parseDiagnosisContext({
      suspectedComponents: [],
      diagnosticFacts: [],
      research,
      safety: { activeCategories: ['GAS'] },
      providedTroubleshooting: ['Rinse the filter.'],
    });

    expect(parsed.research).toEqual(research);
    expect(parsed.safety).toEqual({ activeCategories: ['GAS'] });
    expect(parsed.providedTroubleshooting).toEqual(['Rinse the filter.']);
  });
});

describe('persisted safety state fails closed (I5)', () => {
  const base = { trustedApplianceIdentity: identity, suspectedComponents: [], diagnosticFacts: [] };

  it.each([
    ['unknown category', { activeCategories: ['NOT_A_CATEGORY'] }],
    ['renamed category (schema drift)', { activeCategories: ['SMOKE'] }],
    ['empty list', { activeCategories: [] }],
    ['wrong shape', { categories: ['GAS'] }],
    ['string', 'GAS'],
    ['number', 42],
    ['array', ['GAS']],
  ])('keeps a restriction for corrupt safety state: %s', (_label, safety) => {
    const parsed = parseDiagnosisContext({ ...base, safety });

    expect(parsed.safety?.activeCategories).toContain('UNVERIFIED_HAZARD');
    // Trusted identity is still preserved.
    expect(parsed.trustedApplianceIdentity).toEqual(identity);
  });

  it('keeps every recognisable category from partially drifted state', () => {
    const parsed = parseDiagnosisContext({ ...base, safety: { activeCategories: ['GAS', 'NEW_CATEGORY', 'ELECTRICAL'] } });

    expect(parsed.safety).toEqual({ activeCategories: ['GAS', 'ELECTRICAL', 'UNVERIFIED_HAZARD'] });
  });

  it('salvages safety even when the rest of the context is unusable', () => {
    const parsed = parseDiagnosisContext({ suspectedComponents: 'corrupt', safety: { activeCategories: ['WATER_ELECTRICAL'] } });

    expect(parsed.safety).toEqual({ activeCategories: ['WATER_ELECTRICAL'] });
    expect(parsed.suspectedComponents).toEqual([]);
  });

  it('marks unreadable safety as unverified when the whole context is corrupt', () => {
    const parsed = parseDiagnosisContext({ diagnosticFacts: 7, safety: { activeCategories: 'GAS' } });

    expect(parsed.safety).toEqual({ activeCategories: ['UNVERIFIED_HAZARD'] });
  });

  it.each([
    ['string', 'corrupt'],
    ['empty string', ''],
    ['JSON string', '{"safety":{"activeCategories":["GAS"]}}'],
    ['array', [{ safety: { activeCategories: ['GAS'] } }]],
    ['empty array', []],
    ['number', 7],
    ['boolean', true],
  ])('fails closed when the whole context is not an object (%s)', (_label, value) => {
    const parsed = parseDiagnosisContext(value);

    expect(parsed.safety).toEqual({ activeCategories: ['UNVERIFIED_HAZARD'] });
    expect(parsed.suspectedComponents).toEqual([]);
    expect(parsed.diagnosticFacts).toEqual([]);
  });

  it('still treats a null or missing context as a fresh session', () => {
    expect(parseDiagnosisContext(null).safety).toBeUndefined();
    expect(parseDiagnosisContext(undefined).safety).toBeUndefined();
  });

  it.each([undefined, null])('treats an absent safety section (%s) as no active hazard', (safety) => {
    expect(parseDiagnosisContext({ ...base, safety }).safety).toBeUndefined();
    expect(parseDiagnosisContext({ suspectedComponents: 'corrupt', safety }).safety).toBeUndefined();
  });

  it('leaves valid safety context unchanged', () => {
    expect(parseDiagnosisContext({ ...base, safety: { activeCategories: ['FIRE_SMOKE', 'ELECTRICAL'] } }).safety).toEqual({
      activeCategories: ['FIRE_SMOKE', 'ELECTRICAL'],
    });
  });
});

describe('assistant metadata compatibility', () => {
  const base = {
    kind: 'ASSISTANT_TURN',
    requestId: '00000000-0000-4000-8000-0000000000a1',
    progress: { status: 'OPEN', verdict: null, outcome: 'NEEDS_CLARIFICATION' },
    citations: [],
  };

  it('still parses metadata stored before Phase 2C', () => {
    expect(parseAssistantMetadata(base)).toMatchObject(base);
  });

  it('parses troubleshooting, research summary, safety and tiered citations', () => {
    const metadata = {
      ...base,
      troubleshooting: { steps: ['Rinse the filter.'], evidence: 'WEAK' },
      research: { status: 'COMPLETED', confidence: 'WEAK', reused: false, sources: [] },
      safety: { categories: ['WATER_ELECTRICAL'] },
      citations: [
        { title: 'Guide', url: 'https://www.lg.com/a', sourceKind: 'MANUFACTURER_PAGE', confidence: 'WEAK' },
      ],
    };
    expect(parseAssistantMetadata(metadata)).toEqual(metadata);
  });

  it('rejects an unknown evidence tier or empty troubleshooting list', () => {
    expect(
      parseAssistantMetadata({ ...base, troubleshooting: { steps: [], evidence: 'WEAK' } }),
    ).toBeNull();
    expect(
      parseAssistantMetadata({
        ...base,
        citations: [{ title: 'x', sourceKind: 'SEARCH_RESULT', confidence: 'VERIFIED_BY_AI' }],
      }),
    ).toBeNull();
  });
});

describe('submit_diagnosis_outcome troubleshootingSteps bounds', () => {
  it('accepts up to 8 bounded steps and treats null as absent', () => {
    expect(
      submitDiagnosisOutcomeSchema.safeParse({ reply: 'x', outcome: 'NEEDS_CLARIFICATION', troubleshootingSteps: null })
        .success,
    ).toBe(true);
    expect(
      submitDiagnosisOutcomeSchema.safeParse({
        reply: 'x',
        outcome: 'READY_FOR_CONFIRMATION',
        troubleshootingSteps: Array.from({ length: 9 }, () => 'Rinse the filter.'),
      }).success,
    ).toBe(false);
    expect(
      submitDiagnosisOutcomeSchema.safeParse({
        reply: 'x',
        outcome: 'READY_FOR_CONFIRMATION',
        troubleshootingSteps: ['x'.repeat(501)],
      }).success,
    ).toBe(false);
  });
});
