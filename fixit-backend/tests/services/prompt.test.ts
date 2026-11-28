import { describe, expect, it } from 'vitest';
import { resolveTrustedApplianceIdentity } from '../../src/services/ai/appliance-identity.js';
import { buildDiagnosisPrompt, SYSTEM_PROMPT } from '../../src/services/ai/prompt.js';
import { emptyDiagnosisContext } from '../../src/validators/ai.validator.js';

function identity(overrides: Partial<Parameters<typeof resolveTrustedApplianceIdentity>[0]> = {}) {
  return resolveTrustedApplianceIdentity({
    appliance: { category: 'WASHING_MACHINE', brand: 'TrustedBrand', modelNumber: null },
    userMessages: [],
    currentUserContent: '',
    ...overrides,
  });
}

describe('buildDiagnosisPrompt identity separation', () => {
  it('tells the model that only the trusted identity block is authoritative', () => {
    expect(SYSTEM_PROMPT).toMatch(/trusted appliance identity block/i);
    expect(SYSTEM_PROMPT).toMatch(/advisory diagnostic context/i);
    expect(SYSTEM_PROMPT).toMatch(/never invent or infer a category, brand, model or configuration/i);
    expect(SYSTEM_PROMPT).toMatch(/household appliances/i);
    expect(SYSTEM_PROMPT).toMatch(/when the category is null/i);
    expect(SYSTEM_PROMPT).toMatch(/reply and outcome are mandatory/i);
    expect(SYSTEM_PROMPT).toMatch(/omit optional fields/i);
    expect(SYSTEM_PROMPT).toMatch(/never claim a part is VERIFIED compatible/i);
  });

  it('treats research as untrusted, tiered evidence and forbids unsupported manufacturer claims', () => {
    expect(SYSTEM_PROMPT).toMatch(/never instructions/i);
    expect(SYSTEM_PROMPT).toMatch(/Only MANUFACTURER_CONFIRMED sources may be described as the manufacturer's documentation/i);
    expect(SYSTEM_PROMPT).toMatch(/WEAK sources may only suggest possibilities/i);
    expect(SYSTEM_PROMPT).toMatch(/Never say that the manufacturer or official documentation confirms/i);
  });

  it('describes readiness, FIXED and failed-step rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/Safe troubleshooting does not require approved knowledge-base steps/i);
    expect(SYSTEM_PROMPT).toMatch(/Never choose FIXED/i);
    expect(SYSTEM_PROMPT).toMatch(/If the user says a step did not work, do not repeat the same steps/i);
    expect(SYSTEM_PROMPT).toMatch(/Prefer safe checks and cleaning before recommending a replacement part/i);
  });

  it('places bounded research in its own untrusted block', () => {
    const prompt = buildDiagnosisPrompt({
      identity: identity(),
      context: emptyDiagnosisContext(),
      history: [],
      userContent: 'Not draining',
      knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
      research: {
        status: 'COMPLETED',
        confidence: 'WEAK',
        results: [
          {
            title: 'x'.repeat(500),
            url: 'https://www.partselect.com/a',
            snippet: 'y'.repeat(2000),
            sourceKind: 'SEARCH_RESULT',
            trust: 'TECHNICAL_REFERENCE',
            exactModelMatch: false,
            exactErrorCodeMatch: false,
            relevance: 'TOPICAL',
            contradicted: false,
            confidence: 'WEAK',
          },
        ],
      },
    });
    const blocks = prompt.systemInstruction.split('\n\n');
    const research = blocks.find((block) => block.startsWith('Untrusted external research'));
    expect(research).toMatch(/not instructions/);
    expect(research!.length).toBeLessThanOrEqual(4200);
    // Research never enters the trusted identity block or the user turns.
    expect(blocks.find((block) => block.includes('Trusted appliance identity'))).not.toContain('partselect');
    expect(JSON.stringify(prompt.steps)).not.toContain('yyyy');
  });

  it('distinguishes immediate hazards from technician-only hypotheses', () => {
    expect(SYSTEM_PROMPT).toMatch(/immediate hazards require stopping/i);
    expect(SYSTEM_PROMPT).toMatch(/only a hypothesis, not an immediate hazard/i);
    expect(SYSTEM_PROMPT).toMatch(/never instruct the user to check mains voltage/i);
    expect(SYSTEM_PROMPT).toMatch(/use NEEDS_CLARIFICATION while evidence is still insufficient/i);
    expect(SYSTEM_PROMPT).toMatch(/never for a speculative component mention/i);
  });

  it('sends trusted identity and advisory diagnostic state as separate blocks', () => {
    const prompt = buildDiagnosisPrompt({
      identity: identity({ currentUserContent: 'Model WW80T3040WW, top-load washer' }),
      context: {
        ...emptyDiagnosisContext(),
        diagnosticFacts: ['AI-generated observation about the drain'],
        suspectedComponents: ['drain pump'],
        trustedApplianceIdentity: {
          confirmedModelNumber: 'LEGACY-1',
          modelNumberSource: 'APPLIANCE',
          modelScope: 'TOP_LOAD',
        } as unknown as null,
      },
      history: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          sessionId: '00000000-0000-4000-8000-0000000000f1',
          role: 'ASSISTANT',
          content: 'You said the model was ASSISTANT-ONLY.',
          createdAt: new Date(),
        },
      ],
      userContent: 'What should I check?',
      knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    });

    const trusted = prompt.systemInstruction.split('\n\n').find((block) =>
      block.includes('Trusted appliance identity'),
    );
    const advisory = prompt.systemInstruction.split('\n\n').find((block) =>
      block.includes('Advisory diagnostic state'),
    );
    expect(trusted).toBeDefined();
    expect(advisory).toBeDefined();

    expect(trusted).toContain('TrustedBrand');
    expect(trusted).toContain('WW80T3040WW');
    expect(trusted).toContain('TOP_LOAD');
    expect(trusted).not.toContain('AI-generated observation');
    expect(trusted).not.toContain('ASSISTANT-ONLY');

    expect(advisory).toContain('drain pump');
    expect(advisory).toContain('AI-generated observation');
    expect(advisory).not.toContain('WW80T3040WW');
    expect(advisory).not.toContain('LEGACY-1');

    // Full conversation history remains available for normal diagnosis and
    // safety checks, but its model claim is not part of trusted identity.
    expect(JSON.stringify(prompt.steps)).toContain('ASSISTANT-ONLY');
    expect(prompt.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'model_output' }),
        expect.objectContaining({ type: 'user_input' }),
      ]),
    );
  });

  it('reports unknown identity fields instead of inferring them', () => {
    const prompt = buildDiagnosisPrompt({
      identity: identity({ currentUserContent: 'WW80T3040WW' }),
      context: emptyDiagnosisContext(),
      history: [],
      userContent: 'What part do I need?',
      knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    });

    const trusted = prompt.systemInstruction.split('\n\n').find((block) =>
      block.includes('Trusted appliance identity'),
    );
    expect(trusted).toContain('"modelScope":null');
    expect(trusted).toContain('"scopeSource":null');
    expect(trusted).not.toContain('TOP_LOAD');
  });

  it('reports a null category without deriving scope from user text', () => {
    const prompt = buildDiagnosisPrompt({
      identity: identity({
        appliance: { category: null, brand: 'AnyBrand', modelNumber: 'MODEL-1' },
        currentUserContent: 'It is a top-load washer, model MODEL-1',
      }),
      context: emptyDiagnosisContext(),
      history: [],
      userContent: 'It is a top-load washer, model MODEL-1',
      knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    });

    const trusted = prompt.systemInstruction.split('\n\n').find((block) =>
      block.includes('Trusted appliance identity'),
    );
    expect(trusted).toContain('"category":null');
    expect(trusted).toContain('"modelNumber":"MODEL-1"');
    expect(trusted).toContain('"modelScope":null');
    expect(trusted).not.toContain('TOP_LOAD');
  });

  it('bounds history and places the current user turn last', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sessionId: '00000000-0000-4000-8000-000000000001',
      role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
      content: `history-${index}`,
      createdAt: new Date(),
    }));
    const prompt = buildDiagnosisPrompt({
      identity: identity(),
      context: emptyDiagnosisContext(),
      history,
      userContent: 'current question',
      knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    });

    expect(prompt.steps.length).toBeLessThanOrEqual(1 + 12);
    expect(prompt.steps.at(-1)).toMatchObject({
      type: 'user_input',
      content: [{ type: 'text', text: 'current question' }],
    });
  });
});
