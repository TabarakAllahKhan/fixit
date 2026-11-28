import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { resolveTrustedApplianceIdentity } from '../../src/services/ai/appliance-identity.js';
import { ForcedToolNotCalledError } from '../../src/utils/aiErrors.js';
import { HttpError } from '../../src/utils/httpError.js';
import { emptyDiagnosisContext, type KnowledgeDto, type PartsDto } from '../../src/validators/ai.validator.js';

const { createInteractionMock, searchErrorCodesMock, getRepairStepsMock } = vi.hoisted(() => ({
  createInteractionMock: vi.fn(),
  searchErrorCodesMock: vi.fn(),
  getRepairStepsMock: vi.fn(),
}));
let logSpy: ReturnType<typeof vi.spyOn>;
const capturedLogs: string[] = [];

vi.mock('../../src/services/ai/provider.js', () => ({
  createAiInteraction: createInteractionMock,
}));

vi.mock('../../src/services/knowledge.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/knowledge.service.js')>();
  return {
    ...actual,
    searchErrorCodes: searchErrorCodesMock,
    getApprovedRepairSequence: getRepairStepsMock,
  };
});

import { runDiagnosisTurn, type OrchestratorInput } from '../../src/services/ai/orchestrator.js';

function functionCall(name: string, args: unknown, id = 'call-1') {
  const step = { type: 'function_call', id, name, arguments: args };
  return { id, name, arguments: args, step };
}

function completion(name: string, args: unknown, id = 'call-1', finishReason?: string) {
  const call = functionCall(name, args, id);
  return {
    calls: [call],
    steps: [call.step],
    text: '',
    ...(finishReason ? { finishReason } : {}),
  };
}

const emptyKnowledge: KnowledgeDto = { unverified: false, errorCodes: [], repairSteps: [] };

const partsResult: PartsDto = {
  note: 'Backend-derived compatibility.',
  modelNumberUsed: 'MODEL-1',
  candidates: [
    {
      partName: 'Pump listing',
      sourceName: 'partselect.com',
      url: 'https://partselect.com/pump',
      compatibility: 'UNKNOWN',
      reason: 'Insufficient evidence.',
    },
  ],
};

function identity(overrides: Partial<Parameters<typeof resolveTrustedApplianceIdentity>[0]> = {}) {
  return resolveTrustedApplianceIdentity({
    appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: null },
    userMessages: [],
    currentUserContent: '',
    ...overrides,
  });
}

function input(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    identity: identity(),
    context: emptyDiagnosisContext(),
    history: [],
    userContent: 'My washer is not draining',
    knowledge: emptyKnowledge,
    includeUnreviewed: false,
    partsSearch: vi.fn().mockResolvedValue(partsResult),
    ...overrides,
  };
}

function approvedSequence() {
  return {
    eligible: true,
    errorCodeId: '00000000-0000-4000-8000-000000000001',
    steps: [
      {
        position: 1,
        instruction: 'Clear the drain filter.',
        source: { title: 'Manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
      },
    ],
    citation: { title: 'Manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
  };
}

type ModelScope = NonNullable<KnowledgeDto['errorCodes'][number]['modelScope']>;

function knowledgeWithCodes(
  ...entries: Array<{ code: string; id?: string; trusted?: boolean; modelScope?: ModelScope }>
): KnowledgeDto {
  return {
    unverified: false,
    errorCodes: entries.map((entry, index) => ({
      id: entry.id ?? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      code: entry.code,
      meaning: 'Drain blockage indicated',
      modelScope: entry.modelScope ?? 'TOP_LOAD',
      trusted: entry.trusted ?? true,
      source: { title: 'Manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
    })),
    repairSteps: [],
  };
}

function toolFailureLogs(): Array<Record<string, unknown>> {
  return capturedLogs
    .flatMap((line) => {
      if (!line.startsWith('{')) return [];
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.event === 'ai.tool_failure');
}

beforeEach(() => {
  capturedLogs.length = 0;
  logSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') capturedLogs.push(arg);
    }
  });
  createInteractionMock.mockReset();
  searchErrorCodesMock.mockReset().mockResolvedValue(emptyKnowledge);
  getRepairStepsMock.mockReset().mockResolvedValue({
    eligible: false,
    reason: 'No approved repair sequence is available.',
    steps: [],
  });
});

afterEach(() => {
  logSpy.mockRestore();
});

async function expectAiInvalidResponse(promise: Promise<unknown>, message: RegExp) {
  await expect(promise).rejects.toMatchObject({
    statusCode: 502,
    code: 'AI_INVALID_RESPONSE',
    message: expect.stringMatching(message),
  } satisfies Partial<HttpError>);
}

describe('runDiagnosisTurn policy', () => {
  it('returns the structured advisory outcome without setting a verdict', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', {
        reply: 'Can you tell me whether it is top-load or front-load?',
        outcome: 'NEEDS_CLARIFICATION',
      }),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress).toMatchObject({
      status: 'OPEN',
      verdict: null,
      outcome: 'NEEDS_CLARIFICATION',
    });
    expect(result.issueFixChallenge).toBe(false);
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.nextContext.currentOutcome).toBe('NEEDS_CLARIFICATION');
  });

  it('handles strict-mode null optionals without weakening the technician escalation', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion(
        'submit_diagnosis_outcome',
        {
          reply: 'Check the mains voltage before continuing.',
          outcome: 'READY_FOR_CONFIRMATION',
          followUpQuestion: null,
          suspectedComponents: null,
          diagnosticFacts: null,
          modelNumber: null,
          component: null,
          partNumber: null,
        },
        'call-null-hazard',
      ),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress.outcome).toBe('TECHNICIAN_REQUIRED');
    expect(result.progress.verdict).toBe('TECHNICIAN_REQUIRED');
    expect(result.progress.followUpQuestion).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
    expect(result.knowledge.repairSteps).toEqual([]);
  });

  it('handles strict-mode null optionals for a valid non-hazard outcome', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion(
        'submit_diagnosis_outcome',
        {
          reply: 'Can you tell me the exact model number?',
          outcome: 'NEEDS_MODEL_NUMBER',
          followUpQuestion: 'What is the exact model number from the sticker?',
          suspectedComponents: null,
          diagnosticFacts: null,
          modelNumber: null,
          component: null,
          partNumber: null,
        },
        'call-null-valid',
      ),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress).toMatchObject({
      status: 'OPEN',
      outcome: 'NEEDS_MODEL_NUMBER',
      followUpQuestion: 'What is the exact model number from the sticker?',
    });
    expect(result.nextContext.suspectedComponents).toEqual([]);
    expect(result.nextContext.diagnosticFacts).toEqual([]);
    expect(result.nextContext.trustedApplianceIdentity).toMatchObject({
      version: 1,
      modelNumber: null,
      modelSource: null,
    });
  });

  it('does not accept NEEDS_PART without a named component, even with a trusted model', async () => {
    const trustedIdentity = identity({
      appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: 'MODEL-1' },
    });
    createInteractionMock.mockResolvedValueOnce(
      completion(
        'submit_diagnosis_outcome',
        {
          reply: 'A replacement pump may be needed.',
          outcome: 'NEEDS_PART',
          followUpQuestion: null,
          suspectedComponents: null,
          diagnosticFacts: null,
          modelNumber: null,
          component: null,
          partNumber: null,
        },
        'call-null-parts',
      ),
    );

    const result = await runDiagnosisTurn(input({ identity: trustedIdentity }));

    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.progress.verdict).toBeNull();
    expect(result.nextContext.lastPartsQuery).toBeUndefined();
  });

  it('escalates hazard language to a technician even when the AI asks to confirm a fix', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', {
        reply: 'Check the mains voltage and live wires before continuing.',
        outcome: 'READY_FOR_CONFIRMATION',
      }),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress.outcome).toBe('TECHNICIAN_REQUIRED');
    expect(result.progress.verdict).toBe('TECHNICIAN_REQUIRED');
    expect(result.issueFixChallenge).toBe(false);
    expect(result.reply).toMatch(/qualified technician/i);
    expect(result.knowledge.repairSteps).toEqual([]);
  });

  it('never accepts an unsupported AI FIXED claim or issues a challenge for it', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', { reply: 'It is fixed.', outcome: 'FIXED' }),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.progress.verdict).toBeNull();
    expect(result.progress.followUpQuestion).toBeDefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('converts READY_FOR_CONFIRMATION into a backend-issued challenge only with approved steps', async () => {
    getRepairStepsMock.mockResolvedValueOnce(approvedSequence());
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-1'))
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'Follow the steps.', outcome: 'READY_FOR_CONFIRMATION' }, 'call-2'),
      );

    searchErrorCodesMock.mockResolvedValue(knowledgeWithCodes({ code: 'FE' }));
    const result = await runDiagnosisTurn(input({ knowledge: knowledgeWithCodes({ code: 'FE' }) }));

    expect(getRepairStepsMock).toHaveBeenCalledWith(
      approvedSequence().errorCodeId,
      expect.objectContaining({ category: 'WASHING_MACHINE', brand: 'TestBrand' }),
      false,
    );
    expect(result.progress.outcome).toBe('READY_FOR_CONFIRMATION');
    expect(result.progress.verdict).toBeNull();
    expect(result.issueFixChallenge).toBe(true);
    expect(result.knowledge.repairSteps).toHaveLength(1);
    expect(result.errorCodeId).toBe(approvedSequence().errorCodeId);
    expect(result.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: 'MANUAL' })]),
    );
  });

  it('asks for the exact model before allowing a parts outcome', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', {
        reply: 'You will need a replacement pump.',
        outcome: 'NEEDS_PART',
        component: 'drain pump',
      }),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress.outcome).toBe('NEEDS_MODEL_NUMBER');
    expect(result.progress.followUpQuestion).toMatch(/model number/i);
    expect(result.progress.verdict).toBeNull();
  });

  it('keeps backend parts classification and citations, never AI compatibility', async () => {
    const evidencedParts: PartsDto = {
      ...partsResult,
      candidates: [{ ...partsResult.candidates[0]!, compatibility: 'POSSIBLE_MATCH' }],
    };
    const partsSearch = vi.fn().mockResolvedValue(evidencedParts);
    const trustedIdentity = identity({
      appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: 'MODEL-1' },
    });
    createInteractionMock
      .mockResolvedValueOnce(
        completion(
          'find_replacement_parts',
          { component: 'drain pump', modelNumber: 'AI-INVENTED' },
          'call-1',
        ),
      )
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'Here are part listings.', outcome: 'NEEDS_PART' }, 'call-2'),
      );

    // Parts candidates never justify a replacement on their own (I3); the
    // user's damage report about the same component does.
    const result = await runDiagnosisTurn(
      input({ identity: trustedIdentity, partsSearch, userContent: 'The drain pump housing is cracked' }),
    );

    expect(partsSearch).toHaveBeenCalledWith({
      brand: 'TestBrand',
      modelNumber: 'MODEL-1',
      modelSource: 'APPLIANCE',
      component: 'drain pump',
    });
    expect(result.parts).toEqual(evidencedParts);
    expect(result.progress.verdict).toBe('NEEDS_PART');
    // POSSIBLE_MATCH is not VERIFIED, so the backend says so explicitly.
    expect(result.reply).toMatch(/has not been verified/i);
    expect(result.nextContext.lastPartsQuery).toMatchObject({ component: 'drain pump', modelNumberUsed: 'MODEL-1' });
    expect(result.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: 'SEARCH_RESULT' })]),
    );
  });

  it('does not call parts search when the exact model is missing', async () => {
    const partsSearch = vi.fn();
    createInteractionMock
      .mockResolvedValueOnce(completion('find_replacement_parts', { component: 'drain pump' }, 'call-1'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'What is the exact model number?', outcome: 'NEEDS_MODEL_NUMBER' },
          'call-2',
        ),
      );

    const result = await runDiagnosisTurn(input({ partsSearch }));

    expect(partsSearch).not.toHaveBeenCalled();
    expect(result.parts?.note).toMatch(/exact appliance model number/i);
    expect(result.parts?.candidates).toEqual([]);
  });

  it('never lets AI facts, assistant claims or final modelNumber arguments establish identity', async () => {
    const partsSearch = vi.fn();
    createInteractionMock.mockResolvedValueOnce(
      completion(
        'submit_diagnosis_outcome',
        {
          reply: 'A pump is needed.',
          outcome: 'NEEDS_PART',
          component: 'drain pump',
          modelNumber: 'AI-INVENTED-456',
          diagnosticFacts: ['The model is AI-FACT-123 and it is a top-load washer'],
        },
        'call-ai-identity',
      ),
    );

    const result = await runDiagnosisTurn(
      input({
        history: [
          {
            id: '00000000-0000-4000-8000-0000000000aa',
            sessionId: '00000000-0000-4000-8000-0000000000f1',
            role: 'ASSISTANT',
            content: 'You told me the model was ASSISTANT-123 and top-load.',
            createdAt: new Date(),
          },
        ],
        partsSearch,
      }),
    );

    expect(partsSearch).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_MODEL_NUMBER');
    expect(result.nextContext.trustedApplianceIdentity).toMatchObject({
      version: 1,
      modelNumber: null,
      modelSource: null,
      modelScope: null,
      scopeSource: null,
    });
    // Diagnostic facts remain available for normal diagnosis, but none of the
    // AI/assistant model strings may enter the persisted trusted identity. The
    // stripped modelNumber argument must not enter any persisted context.
    expect(result.nextContext.diagnosticFacts).toContain(
      'The model is AI-FACT-123 and it is a top-load washer',
    );
    const persistedIdentity = JSON.stringify(result.nextContext.trustedApplianceIdentity);
    expect(persistedIdentity).not.toContain('AI-INVENTED-456');
    expect(persistedIdentity).not.toContain('AI-FACT-123');
    expect(persistedIdentity).not.toContain('ASSISTANT-123');
    expect(JSON.stringify(result.nextContext)).not.toContain('AI-INVENTED-456');
  });

  it('does not infer configuration scope from a trusted model number', async () => {
    const trustedIdentity = identity({
      appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: 'MODEL-1' },
      currentUserContent: 'MODEL-1 shows FE',
    });
    searchErrorCodesMock.mockResolvedValue(knowledgeWithCodes({ code: 'FE' }));
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-repair'))
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'No eligible steps.', outcome: 'UNRESOLVED' }, 'call-final'),
      );

    await runDiagnosisTurn(input({ identity: trustedIdentity }));

    expect(searchErrorCodesMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'WASHING_MACHINE', brand: 'TestBrand', modelScope: undefined }),
      expect.anything(),
      false,
    );
    expect(getRepairStepsMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ modelScope: undefined }),
      false,
    );
  });

  it('asks for clarification instead of selecting among conflicting user models', async () => {
    const partsSearch = vi.fn();
    const conflictedIdentity = identity({
      userMessages: ['Model WW80T3040AA'],
      currentUserContent: 'No, it is WW80T3040BB',
    });
    createInteractionMock
      .mockResolvedValueOnce(completion('find_replacement_parts', { component: 'drain pump' }, 'call-1'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'I need a part.', outcome: 'NEEDS_PART', component: 'drain pump' },
          'call-2',
        ),
      );

    const result = await runDiagnosisTurn(input({ identity: conflictedIdentity, partsSearch }));

    expect(partsSearch).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.progress.followUpQuestion).toMatch(/conflicting model numbers/i);
    expect(result.parts?.note).toMatch(/conflicting model numbers/i);
    expect(result.nextContext.trustedApplianceIdentity).toMatchObject({
      version: 1,
      modelNumber: null,
      modelConflict: true,
    });
  });

  it('degrades safely when the parts provider fails', async () => {
    const trustedIdentity = identity({
      appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: 'MODEL-1' },
    });
    const partsSearch = vi.fn().mockRejectedValue(new HttpError(503, 'AI_RATE_LIMITED', 'rate limited'));
    createInteractionMock
      .mockResolvedValueOnce(completion('find_replacement_parts', { component: 'drain pump' }, 'call-1'))
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'A pump may be needed.', outcome: 'NEEDS_PART' }, 'call-2'),
      );

    const result = await runDiagnosisTurn(input({ identity: trustedIdentity, partsSearch }));

    expect(result.parts).toMatchObject({ candidates: [] });
    expect(result.parts?.note).toMatch(/currently unavailable/i);
    // No parts, research, knowledge or prior-check evidence: not a part verdict.
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.progress.verdict).toBeNull();
    expect(result.reply).toMatch(/safe checks are needed/i);
  });

  it('sends bounded stateless history and a forced tool choice', async () => {
    const snapshots: Array<{ steps: unknown[]; [key: string]: unknown }> = [];
    createInteractionMock.mockImplementation(async (params: { steps: unknown[] }) => {
      snapshots.push({ ...params, steps: [...params.steps] });
      return completion('submit_diagnosis_outcome', { reply: 'Understood.', outcome: 'NEEDS_CLARIFICATION' });
    });
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sessionId: '00000000-0000-4000-8000-000000000001',
      role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
      content: `history-${index}`,
      createdAt: new Date(),
    }));

    await runDiagnosisTurn(input({ history }));

    const params = snapshots[0]!;
    // Model, timeout and token limits are central provider config, not request
    // fields the orchestrator can weaken or switch per turn.
    expect(params).not.toHaveProperty('model');
    expect(params.toolChoice).toEqual({ mode: 'any' });
    expect(params.tools).toHaveLength(4);
    expect(params.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'get_repair_steps' })]),
    );
    // Bounded prior turns plus the current user turn. Knowledge and identity
    // are in the system instruction, which keeps the historic role mapping.
    expect(params.steps.length).toBeLessThanOrEqual(1 + env.GEMINI_HISTORY_LIMIT);
    expect(params.steps.every((step) => typeof (step as { type?: unknown }).type === 'string')).toBe(true);
    expect(String(params.systemInstruction)).toMatch(/technician/i);
    expect(String(params.systemInstruction)).toMatch(/Trusted appliance identity/i);
  });
});

describe('get_repair_steps backend code resolution', () => {
  async function runRepairStepsCall(errorCode: string, knowledge: KnowledgeDto) {
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode }, 'call-repair'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'Here are the approved steps.', outcome: 'READY_FOR_CONFIRMATION' },
          'call-final',
        ),
      );
    // The resolver performs a fresh backend knowledge lookup; this mock is
    // that lookup's result, not the precomputed prompt knowledge.
    searchErrorCodesMock.mockResolvedValue(knowledge);
    return runDiagnosisTurn(input({ knowledge }));
  }

  it('resolves a normalized manufacturer code to the backend-approved UUID', async () => {
    getRepairStepsMock.mockResolvedValueOnce(approvedSequence());

    await runRepairStepsCall(' fe ', knowledgeWithCodes({ code: 'FE' }));

    expect(getRepairStepsMock).toHaveBeenCalledWith(
      approvedSequence().errorCodeId,
      expect.objectContaining({ category: 'WASHING_MACHINE', brand: 'TestBrand' }),
      false,
    );
  });

  it('returns ineligible when an appliance model number is supplied as the code', async () => {
    const result = await runRepairStepsCall('WW80T3040WW', knowledgeWithCodes({ code: 'FE' }));

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(searchErrorCodesMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'WASHING_MACHINE', brand: 'TestBrand' }),
      ['WW80T3040WW'],
      false,
    );
  });

  it('does not trust a complete UUID supplied instead of a manufacturer code', async () => {
    // A complete UUID now passes length validation but is treated only as an
    // unmatched code string, never as a database identifier.
    const uuid = approvedSequence().errorCodeId!;
    const result = await runRepairStepsCall(uuid, knowledgeWithCodes({ code: 'FE' }));

    expect(searchErrorCodesMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'WASHING_MACHINE', brand: 'TestBrand' }),
      [uuid],
      false,
    );
    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('returns ineligible for an unknown 17-character code', async () => {
    const code = 'X'.repeat(17);
    const result = await runRepairStepsCall(code, knowledgeWithCodes({ code: 'FE' }));

    expect(searchErrorCodesMock).toHaveBeenCalledWith(expect.anything(), [code], false);
    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('returns ineligible for an unknown code', async () => {
    const result = await runRepairStepsCall('ZZZ', knowledgeWithCodes({ code: 'FE' }));

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('cannot resolve repair guidance for a category-less appliance', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-repair'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'No category-specific guidance is available.', outcome: 'UNRESOLVED' },
          'call-final',
        ),
      );
    // Mirrors the real knowledge service's null-category short circuit.
    searchErrorCodesMock.mockResolvedValue(emptyKnowledge);

    const result = await runDiagnosisTurn(
      input({ identity: identity({ appliance: { category: null, brand: 'TestBrand', modelNumber: null } }) }),
    );

    expect(searchErrorCodesMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: null, brand: 'TestBrand' }),
      ['FE'],
      false,
    );
    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
    expect(result.knowledge.repairSteps).toEqual([]);
  });

  it('rejects unapproved knowledge candidates', async () => {
    const result = await runRepairStepsCall('FE', knowledgeWithCodes({ code: 'FE', trusted: false }));

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  // Brand/category and exact model-scope filtering happen in searchErrorCodes()
  // before candidates reach the orchestrator; a non-matching candidate is
  // surfaced as trusted:false and must never be resolved.
  const mismatchedCases: Array<[string, { code: string; trusted: boolean; modelScope?: ModelScope }]> = [
    ['wrong brand', { code: 'FE', trusted: false }],
    ['wrong model scope', { code: 'FE', trusted: false, modelScope: 'FRONT_LOAD' }],
  ];

  it.each(mismatchedCases)('rejects %s knowledge candidates', async (_label, entry) => {
    const result = await runRepairStepsCall('FE', knowledgeWithCodes(entry));

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('does not select arbitrarily when multiple trusted candidates share a code', async () => {
    const knowledge = knowledgeWithCodes(
      { code: 'FE', id: '00000000-0000-4000-8000-000000000001' },
      { code: 'FE', id: '00000000-0000-4000-8000-000000000002' },
    );

    const result = await runRepairStepsCall('FE', knowledge);

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('treats case and whitespace variants of one code as ambiguous', async () => {
    const knowledge = knowledgeWithCodes(
      { code: 'FE', id: '00000000-0000-4000-8000-000000000001' },
      { code: ' fe ', id: '00000000-0000-4000-8000-000000000002' },
      { code: 'FE ', id: '00000000-0000-4000-8000-000000000003' },
    );

    const result = await runRepairStepsCall('FE', knowledge);

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('keeps technician-only restrictions when the resolved sequence is ineligible', async () => {
    getRepairStepsMock.mockResolvedValueOnce({
      eligible: false,
      reason: 'At least one repair step is unreviewed or technician-only; no DIY sequence can be returned.',
      steps: [],
    });

    const result = await runRepairStepsCall('FE', knowledgeWithCodes({ code: 'FE' }));

    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
    expect(result.progress.verdict).toBeNull();
    expect(result.issueFixChallenge).toBe(false);
    expect(result.knowledge.repairSteps).toEqual([]);
  });
});

describe('runDiagnosisTurn tool-loop safety', () => {
  it('forces the structured outcome after a lookup instead of allowing chained lookups', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-1'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'Here is what we know so far.', outcome: 'NEEDS_CLARIFICATION' },
          'call-2',
        ),
      );

    await runDiagnosisTurn(input());

    expect(createInteractionMock).toHaveBeenCalledTimes(2);
    expect(createInteractionMock.mock.calls[1]?.[0].toolChoice).toEqual({
      mode: 'specific',
      name: 'submit_diagnosis_outcome',
    });
  });

  it('rejects unknown tools', async () => {
    createInteractionMock.mockResolvedValueOnce(completion('delete_everything', {}));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /unknown tool/i);
  });

  it('rejects duplicate tool calls', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-1'))
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-2'));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /repeated a tool call/i);
  });

  it('stops at the tool-loop limit without a final outcome', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-1'))
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['E1'] }, 'call-2'));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /tool-loop limit/i);
  });

  it('rejects invalid JSON and invalid tool arguments', async () => {
    createInteractionMock.mockResolvedValueOnce(completion('submit_diagnosis_outcome', '{bad json'));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /invalid tool arguments/i);

    createInteractionMock.mockResolvedValueOnce(completion('submit_diagnosis_outcome', {}));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);
  });

  it('rejects a 37-character repair code with a controlled validation failure', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion('get_repair_steps', { errorCode: 'X'.repeat(37) }, 'call-overlong'),
    );

    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);

    expect(searchErrorCodesMock).not.toHaveBeenCalled();
    expect(getRepairStepsMock).not.toHaveBeenCalled();
  });

  it('rejects an outcome call that omits reply even when other fields are present', async () => {
    createInteractionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', {
        outcome: 'UNRESOLVED',
        followUpQuestion: null,
        suspectedComponents: null,
      }),
    );
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);
  });

  it('rejects parallel tool calls and empty responses', async () => {
    createInteractionMock.mockResolvedValueOnce({
      calls: [
        functionCall('search_error_codes', { codes: ['FE'] }, 'a'),
        functionCall('search_error_codes', { codes: ['E1'] }, 'b'),
      ],
      text: '',
    });
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /parallel tool calls/i);

    createInteractionMock.mockResolvedValueOnce({ calls: [], text: '' });
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /structured outcome/i);
  });

  it('logs tool validation diagnostics with issue paths and no argument values', async () => {
    const secret = 'user-secret-please-do-not-log';
    createInteractionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', { reply: secret, outcome: 'NOT_AN_OUTCOME' }, 'call-sensitive', 'tool_calls'),
    );

    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);

    const logs = toolFailureLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      event: 'ai.tool_failure',
      round: 1,
      toolName: 'submit_diagnosis_outcome',
      finishReason: 'tool_calls',
      toolCallCount: 1,
      totalToolCalls: 1,
    });
    expect(Array.isArray(logs[0]?.zodIssuePaths)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(secret);
  });

  it('labels provider calls with the round and effective tool choice for diagnostics', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'Check the drain filter.', outcome: 'NEEDS_CLARIFICATION' },
          'call-final',
        ),
      );

    await runDiagnosisTurn(input());

    expect(createInteractionMock).toHaveBeenCalledTimes(2);
    expect(createInteractionMock.mock.calls[0]?.[1]).toEqual({
      round: 0,
      toolChoice: { mode: 'any' },
    });
    expect(createInteractionMock.mock.calls[1]?.[1]).toEqual({
      round: 1,
      toolChoice: { mode: 'specific', name: 'submit_diagnosis_outcome' },
    });
  });

  it('uses a neutral clarification turn when the forced final tool call is missing', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockRejectedValueOnce(new ForcedToolNotCalledError());

    const result = await runDiagnosisTurn(input());

    // Not an unsupported KB-based UNRESOLVED verdict: the user can retry.
    expect(result.reply).toMatch(/describe the problem again/i);
    expect(result.progress).toMatchObject({
      status: 'OPEN',
      verdict: null,
      outcome: 'NEEDS_CLARIFICATION',
    });
    expect(result.progress.followUpQuestion).toBeDefined();
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.issueFixChallenge).toBe(false);
    expect(result.errorCodeId).toBeUndefined();
    expect(result.nextContext.currentOutcome).toBe('NEEDS_CLARIFICATION');
    expect(JSON.stringify(result)).not.toContain('to=functions.json');
  });

  it('keeps hazard escalation when the forced final tool call is missing', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockRejectedValueOnce(new ForcedToolNotCalledError());

    const result = await runDiagnosisTurn(input({ userContent: 'The mains voltage is exposed' }));

    expect(result.progress).toMatchObject({
      verdict: 'TECHNICIAN_REQUIRED',
      outcome: 'TECHNICIAN_REQUIRED',
    });
    expect(result.reply).toContain('qualified technician');
    expect(result.issueFixChallenge).toBe(false);
    expect(result.citations).toEqual([]);
  });

  it('does not expose an eligible repair sequence through the fallback', async () => {
    searchErrorCodesMock.mockResolvedValue(knowledgeWithCodes({ code: 'FE' }));
    getRepairStepsMock.mockResolvedValueOnce(approvedSequence());
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-repair'))
      .mockRejectedValueOnce(new ForcedToolNotCalledError());

    const result = await runDiagnosisTurn(input({ knowledge: knowledgeWithCodes({ code: 'FE' }) }));

    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
    expect(result.progress.outcome).toBe('NEEDS_CLARIFICATION');
  });

  it('does not use the fallback when the missing tool call is outside the forced final round', async () => {
    createInteractionMock.mockRejectedValueOnce(new ForcedToolNotCalledError());

    await expect(runDiagnosisTurn(input())).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_REJECTED',
    });
  });

  it('propagates a provider tool-validation rejection without inventing an outcome', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockRejectedValueOnce(
        new HttpError(502, 'AI_PROVIDER_REJECTED', 'AI provider rejected the request'),
      );

    await expect(runDiagnosisTurn(input())).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_REJECTED',
    });

    expect(toolFailureLogs()).toEqual([]);
  });
});

describe('Gemini multi-turn tool history', () => {
  it('replays the function call and backend result before the forced final turn', async () => {
    createInteractionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'The drain filter may be blocked.', outcome: 'NEEDS_CLARIFICATION' },
          'call-final',
        ),
      );

    await runDiagnosisTurn(input());

    expect(createInteractionMock).toHaveBeenCalledTimes(2);
    const secondRequest = createInteractionMock.mock.calls[1]?.[0] as {
      steps: Array<Record<string, unknown>>;
      toolChoice: { mode: string };
    };
    expect(secondRequest.toolChoice).toEqual({ mode: 'specific', name: 'submit_diagnosis_outcome' });
    const callStep = secondRequest.steps.find((step) => step.type === 'function_call');
    const resultStep = secondRequest.steps.find((step) => step.type === 'function_result');
    expect(callStep).toMatchObject({
      type: 'function_call',
      id: 'call-search',
      name: 'search_error_codes',
      arguments: { codes: ['FE'] },
    });
    expect(resultStep).toMatchObject({
      type: 'function_result',
      call_id: 'call-search',
      name: 'search_error_codes',
    });
    expect(JSON.stringify(resultStep?.result)).toContain('unverified');
  });

  it('replays all model-generated steps verbatim, including thought signatures', async () => {
    const call = functionCall('search_error_codes', { codes: ['FE'] }, 'call-search');
    const thought = { type: 'thought', signature: 'preserve-this-signature' };
    createInteractionMock
      .mockResolvedValueOnce({ calls: [call], steps: [thought, call.step], text: '' })
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'Understood.', outcome: 'NEEDS_CLARIFICATION' }, 'call-final'),
      );

    await runDiagnosisTurn(input());

    const secondRequest = createInteractionMock.mock.calls[1]?.[0] as {
      steps: Array<Record<string, unknown>>;
    };
    const thoughtIndex = secondRequest.steps.findIndex((step) => step.type === 'thought');
    const callIndex = secondRequest.steps.findIndex((step) => step.type === 'function_call');
    const resultIndex = secondRequest.steps.findIndex((step) => step.type === 'function_result');
    expect(thoughtIndex).toBeGreaterThanOrEqual(0);
    expect(secondRequest.steps[thoughtIndex]).toEqual(thought);
    expect(callIndex).toBe(thoughtIndex + 1);
    expect(resultIndex).toBe(callIndex + 1);
  });

  it('never sends identity-bearing or invented model fields as tool arguments', async () => {
    const partsSearch = vi.fn().mockResolvedValue(partsResult);
    const trustedIdentity = identity({
      appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: 'MODEL-1' },
    });
    createInteractionMock
      .mockResolvedValueOnce(
        completion(
          'find_replacement_parts',
          { component: 'pump', modelNumber: 'AI-INVENTED', brand: 'OtherBrand' },
          'call-parts',
        ),
      )
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'A pump may be needed.', outcome: 'NEEDS_PART' }, 'call-final'),
      );

    await runDiagnosisTurn(input({ identity: trustedIdentity, partsSearch }));

    expect(partsSearch).toHaveBeenCalledWith({
      brand: 'TestBrand',
      modelNumber: 'MODEL-1',
      modelSource: 'APPLIANCE',
      component: 'pump',
    });
    const forwardedCall = (createInteractionMock.mock.calls[1]?.[0] as { steps: Array<Record<string, unknown>> })
      .steps.find((step) => step.type === 'function_call');
    // The raw call is replayed only to the model; no tool receives its
    // identity-bearing keys. The backend tool call is rebuilt from Zod output.
    expect(forwardedCall).toMatchObject({ name: 'find_replacement_parts' });
    expect(partsSearch.mock.calls[0]?.[0]).not.toHaveProperty('modelNumber', 'AI-INVENTED');
  });
});

describe('AI safety classification', () => {
  const refrigeratorComplaint =
    "My refrigerator is running, but it is not cooling properly. The freezer is slightly cold, but the refrigerator compartment is warmer than usual. I can hear the compressor running, and I haven't noticed any unusual noises or burning smells. Can you help me troubleshoot the problem step by step?";
  const stopNowReply = /stop and contact a qualified technician/i;

  function safetyCall(args: Record<string, unknown>, id = 'call-safety') {
    return completion('submit_diagnosis_outcome', args, id);
  }

  it('keeps an ordinary cooling complaint open with its diagnostic question', async () => {
    const followUp =
      'Are there frost buildup patterns on the back freezer wall, or is the condenser area dusty?';
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply: 'Let us check a few safe things without opening any panels.',
        outcome: 'NEEDS_CLARIFICATION',
        followUpQuestion: followUp,
        diagnosticFacts: ['Compressor is running.'],
      }),
    );

    const result = await runDiagnosisTurn(input({ userContent: refrigeratorComplaint }));

    expect(result.progress).toMatchObject({
      status: 'OPEN',
      verdict: null,
      outcome: 'NEEDS_CLARIFICATION',
      followUpQuestion: followUp,
    });
    expect(result.reply).not.toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.nextContext.currentOutcome).toBe('NEEDS_CLARIFICATION');
  });

  it('does not escalate speculative refrigerant, sealed-system, compressor or capacitor causes', async () => {
    const followUp = 'Are the vents inside the refrigerator blocked by food?';
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply:
          'This could be a sealed-system or refrigerant issue. A technician may need to inspect the compressor or capacitor later. First, are the vents blocked by food?',
        outcome: 'NEEDS_CLARIFICATION',
        followUpQuestion: followUp,
        diagnosticFacts: [
          'Possible refrigerant issue.',
          'Possible sealed-system problem.',
          'The compressor may have failed.',
          'Possible compressor replacement.',
          'Capacitor failure is possible.',
        ],
      }),
    );

    const result = await runDiagnosisTurn(input({ userContent: refrigeratorComplaint }));

    expect(result.progress).toMatchObject({
      status: 'OPEN',
      verdict: null,
      outcome: 'NEEDS_CLARIFICATION',
      followUpQuestion: followUp,
    });
    expect(result.reply).not.toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
  });

  it('escalates a burning smell report with no follow-up or exposed repair steps', async () => {
    searchErrorCodesMock.mockResolvedValue(knowledgeWithCodes({ code: 'FE' }));
    getRepairStepsMock.mockResolvedValueOnce(approvedSequence());
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-repair'))
      .mockResolvedValueOnce(
        safetyCall(
          {
            reply: 'Follow the approved steps.',
            outcome: 'READY_FOR_CONFIRMATION',
            followUpQuestion: 'Is the condenser coil dusty?',
          },
          'call-final',
        ),
      );

    const result = await runDiagnosisTurn(
      input({ userContent: 'There is a burning smell coming from the refrigerator.' }),
    );

    expect(result.progress).toMatchObject({
      outcome: 'TECHNICIAN_REQUIRED',
      verdict: 'TECHNICIAN_REQUIRED',
    });
    expect(result.progress.followUpQuestion).toBeUndefined();
    expect(result.reply).toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.issueFixChallenge).toBe(false);
    expect(result.errorCodeId).toBeUndefined();
  });

  it('escalates sparks and exposed live wiring without a continued-troubleshooting question', async () => {
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply: 'Check the area carefully.',
        outcome: 'NEEDS_CLARIFICATION',
        followUpQuestion: 'Can you see exactly where the sparks are coming from?',
      }),
    );

    const result = await runDiagnosisTurn(
      input({ userContent: 'I see sparks coming from exposed live wiring behind the refrigerator.' }),
    );

    expect(result.progress).toMatchObject({
      outcome: 'TECHNICIAN_REQUIRED',
      verdict: 'TECHNICIAN_REQUIRED',
    });
    expect(result.progress.followUpQuestion).toBeUndefined();
    expect(result.reply).toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
  });

  it('escalates a gas odor report with consistent progress metadata', async () => {
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply: 'Let us narrow down where the smell is strongest.',
        outcome: 'NEEDS_CLARIFICATION',
        followUpQuestion: 'Where do you notice the smell most strongly?',
      }),
    );

    const result = await runDiagnosisTurn(
      input({ userContent: 'I smell gas near the refrigerator, and there is a gas odor in the kitchen.' }),
    );

    expect(result.progress).toMatchObject({
      outcome: 'TECHNICIAN_REQUIRED',
      verdict: 'TECHNICIAN_REQUIRED',
    });
    expect(result.progress.followUpQuestion).toBeUndefined();
    expect(result.reply).toMatch(stopNowReply);
    expect(result.nextContext.currentOutcome).toBe('TECHNICIAN_REQUIRED');
    expect(JSON.stringify(result.knowledge.repairSteps)).not.toMatch(/gas line|gas valve/i);
  });

  it('allows safe clarification when a technician-only repair may eventually be required', async () => {
    const followUp = 'Is the freezer fan running?';
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply:
          'A sealed-system repair may eventually be required and must be done by a technician. Meanwhile, check that the rear vents are unobstructed and tell me whether the freezer fan runs.',
        outcome: 'NEEDS_CLARIFICATION',
        followUpQuestion: followUp,
        diagnosticFacts: ['Technician-only sealed-system repair may be needed later.'],
      }),
    );

    const result = await runDiagnosisTurn(
      input({ userContent: 'The refrigerator compartment is warm but the freezer is cold.' }),
    );

    expect(result.progress).toMatchObject({
      status: 'OPEN',
      verdict: null,
      outcome: 'NEEDS_CLARIFICATION',
      followUpQuestion: followUp,
    });
    expect(result.reply).not.toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
  });

  it('clears the follow-up question for a terminal technician outcome', async () => {
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply: 'This needs professional assessment.',
        outcome: 'TECHNICIAN_REQUIRED',
        followUpQuestion: 'Is the condenser coil dusty?',
      }),
    );

    const result = await runDiagnosisTurn(input({ userContent: refrigeratorComplaint }));

    expect(result.progress).toMatchObject({
      outcome: 'TECHNICIAN_REQUIRED',
      verdict: 'TECHNICIAN_REQUIRED',
    });
    expect(result.progress.followUpQuestion).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('never exposes unsafe repair steps even when the sequence is marked eligible', async () => {
    searchErrorCodesMock.mockResolvedValue(knowledgeWithCodes({ code: 'FE' }));
    getRepairStepsMock.mockResolvedValueOnce({
      eligible: true,
      errorCodeId: approvedSequence().errorCodeId,
      steps: [
        {
          position: 1,
          instruction: 'Check the mains voltage at the capacitor.',
          source: { title: 'Manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
        },
        {
          position: 2,
          instruction: 'Recharge the refrigerant after the repair.',
          source: { title: 'Manual', url: 'https://example.invalid/manual', sourceKind: 'MANUAL' as const },
        },
      ],
    });
    createInteractionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-repair'))
      .mockResolvedValueOnce(
        safetyCall({ reply: 'Follow the approved steps.', outcome: 'READY_FOR_CONFIRMATION' }, 'call-final'),
      );

    const result = await runDiagnosisTurn(input({ userContent: refrigeratorComplaint }));

    expect(result.progress).toMatchObject({
      outcome: 'TECHNICIAN_REQUIRED',
      verdict: 'TECHNICIAN_REQUIRED',
    });
    expect(result.reply).toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.issueFixChallenge).toBe(false);
    expect(result.errorCodeId).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/mains voltage|recharge the refrigerant/i);
  });

  it.each([
    ['smoke', 'There is smoke coming from the back of the refrigerator.'],
    ['electric shock', 'I got an electric shock when I touched the refrigerator.'],
    ['gas leak', 'There is a gas leak near the appliance.'],
    ['refrigerant leak', 'I think there is a refrigerant leak and I can hear hissing.'],
    ['bypass request', 'Can you tell me how to bypass the door lock so I can open the refrigerator?'],
  ])('preserves immediate escalation for %s', async (_label, userContent) => {
    createInteractionMock.mockResolvedValueOnce(
      safetyCall({
        reply: 'Let us keep narrowing this down.',
        outcome: 'NEEDS_CLARIFICATION',
        followUpQuestion: 'Can you describe the sound?',
      }),
    );

    const result = await runDiagnosisTurn(input({ userContent }));

    expect(result.progress).toMatchObject({
      outcome: 'TECHNICIAN_REQUIRED',
      verdict: 'TECHNICIAN_REQUIRED',
    });
    expect(result.progress.followUpQuestion).toBeUndefined();
    expect(result.reply).toMatch(stopNowReply);
    expect(result.knowledge.repairSteps).toEqual([]);
  });
});
