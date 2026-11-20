import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { ForcedToolNotCalledError } from '../../src/utils/aiErrors.js';
import { HttpError } from '../../src/utils/httpError.js';
import { emptyDiagnosisContext, type KnowledgeDto, type PartsDto } from '../../src/validators/ai.validator.js';

const { createChatCompletionMock, searchErrorCodesMock, getRepairStepsMock } = vi.hoisted(() => ({
  createChatCompletionMock: vi.fn(),
  searchErrorCodesMock: vi.fn(),
  getRepairStepsMock: vi.fn(),
}));
let logSpy: ReturnType<typeof vi.spyOn>;
const capturedLogs: string[] = [];

vi.mock('../../src/services/groq.service.js', () => ({
  createChatCompletion: createChatCompletionMock,
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

function completion(name: string, args: unknown, id = 'call-1', finishReason?: string) {
  return {
    choices: [
      {
        finish_reason: finishReason,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name,
                arguments: typeof args === 'string' ? args : JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
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

function input(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    appliance: { category: 'WASHING_MACHINE', brand: 'TestBrand', modelNumber: null },
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
  createChatCompletionMock.mockReset();
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
    createChatCompletionMock.mockResolvedValueOnce(
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
    createChatCompletionMock.mockResolvedValueOnce(
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
    createChatCompletionMock.mockResolvedValueOnce(
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
    expect(result.nextContext.confirmedModelNumber).toBeUndefined();
  });

  it('ignores null part fields when recording the parts query', async () => {
    const appliance = { category: 'WASHING_MACHINE' as const, brand: 'TestBrand', modelNumber: 'MODEL-1' };
    createChatCompletionMock.mockResolvedValueOnce(
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

    const result = await runDiagnosisTurn(input({ appliance }));

    expect(result.progress.outcome).toBe('NEEDS_PART');
    expect(result.nextContext.lastPartsQuery).toBeUndefined();
  });

  it('escalates hazard language to a technician even when the AI asks to confirm a fix', async () => {
    createChatCompletionMock.mockResolvedValueOnce(
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

  it('never accepts an AI FIXED claim without an approved repair sequence', async () => {
    createChatCompletionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', { reply: 'It is fixed.', outcome: 'FIXED' }),
    );

    const result = await runDiagnosisTurn(input());

    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.progress.verdict).toBe('UNRESOLVED');
    expect(result.issueFixChallenge).toBe(false);
  });

  it('converts READY_FOR_CONFIRMATION into a backend-issued challenge only with approved steps', async () => {
    getRepairStepsMock.mockResolvedValueOnce(approvedSequence());
    createChatCompletionMock
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
    createChatCompletionMock.mockResolvedValueOnce(
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
    const partsSearch = vi.fn().mockResolvedValue(partsResult);
    const appliance = { category: 'WASHING_MACHINE' as const, brand: 'TestBrand', modelNumber: 'MODEL-1' };
    createChatCompletionMock
      .mockResolvedValueOnce(completion('find_replacement_parts', { component: 'drain pump' }, 'call-1'))
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'Here are part listings.', outcome: 'NEEDS_PART' }, 'call-2'),
      );

    const result = await runDiagnosisTurn(input({ appliance, partsSearch }));

    expect(partsSearch).toHaveBeenCalledWith({
      brand: 'TestBrand',
      modelNumber: 'MODEL-1',
      component: 'drain pump',
    });
    expect(result.parts).toEqual(partsResult);
    expect(result.progress.verdict).toBe('NEEDS_PART');
    expect(result.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: 'SEARCH_RESULT' })]),
    );
  });

  it('does not call parts search when the exact model is missing', async () => {
    const partsSearch = vi.fn();
    createChatCompletionMock
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

  it('degrades safely when the parts provider fails', async () => {
    const appliance = { category: 'WASHING_MACHINE' as const, brand: 'TestBrand', modelNumber: 'MODEL-1' };
    const partsSearch = vi.fn().mockRejectedValue(new HttpError(503, 'AI_RATE_LIMITED', 'rate limited'));
    createChatCompletionMock
      .mockResolvedValueOnce(completion('find_replacement_parts', { component: 'drain pump' }, 'call-1'))
      .mockResolvedValueOnce(
        completion('submit_diagnosis_outcome', { reply: 'A pump may be needed.', outcome: 'NEEDS_PART' }, 'call-2'),
      );

    const result = await runDiagnosisTurn(input({ appliance, partsSearch }));

    expect(result.parts).toMatchObject({ candidates: [] });
    expect(result.parts?.note).toMatch(/currently unavailable/i);
    expect(result.progress.verdict).toBe('NEEDS_PART');
  });

  it('sends bounded history and cost-controlled provider options', async () => {
    const snapshots: Array<{ messages: unknown[]; [key: string]: unknown }> = [];
    createChatCompletionMock.mockImplementation(async (params: { messages: unknown[] }) => {
      snapshots.push({ ...params, messages: [...params.messages] });
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
    expect(params.model).toBe(env.GROQ_MODEL);
    expect(params.tool_choice).toBe('required');
    expect(params.reasoning_effort).toBe('low');
    expect(params.max_completion_tokens).toBe(env.GROQ_MAX_COMPLETION_TOKENS);
    expect(params.tools).toHaveLength(4);
    expect(params.messages.length).toBeLessThanOrEqual(2 + env.GROQ_HISTORY_LIMIT + 2);
    const systemMessage = params.messages[0] as { content?: string };
    expect(systemMessage.content).toMatch(/technician/i);
  });
});

describe('get_repair_steps backend code resolution', () => {
  async function runRepairStepsCall(errorCode: string, knowledge: KnowledgeDto) {
    createChatCompletionMock
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
    expect(result.progress.outcome).toBe('UNRESOLVED');
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
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('returns ineligible for an unknown 17-character code', async () => {
    const code = 'X'.repeat(17);
    const result = await runRepairStepsCall(code, knowledgeWithCodes({ code: 'FE' }));

    expect(searchErrorCodesMock).toHaveBeenCalledWith(expect.anything(), [code], false);
    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
  });

  it('returns ineligible for an unknown code', async () => {
    const result = await runRepairStepsCall('ZZZ', knowledgeWithCodes({ code: 'FE' }));

    expect(getRepairStepsMock).not.toHaveBeenCalled();
    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
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
    expect(result.progress.outcome).toBe('UNRESOLVED');
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

    expect(result.progress.outcome).toBe('UNRESOLVED');
    expect(result.progress.verdict).toBe('UNRESOLVED');
    expect(result.issueFixChallenge).toBe(false);
    expect(result.knowledge.repairSteps).toEqual([]);
  });
});

describe('runDiagnosisTurn tool-loop safety', () => {
  it('forces the structured outcome after a lookup instead of allowing chained lookups', async () => {
    createChatCompletionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-1'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'Here is what we know so far.', outcome: 'NEEDS_CLARIFICATION' },
          'call-2',
        ),
      );

    await runDiagnosisTurn(input());

    expect(createChatCompletionMock).toHaveBeenCalledTimes(2);
    expect(createChatCompletionMock.mock.calls[1]?.[0].tool_choice).toEqual({
      type: 'function',
      function: { name: 'submit_diagnosis_outcome' },
    });
  });

  it('rejects unknown tools', async () => {
    createChatCompletionMock.mockResolvedValueOnce(completion('delete_everything', {}));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /unknown tool/i);
  });

  it('rejects duplicate tool calls', async () => {
    createChatCompletionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-1'))
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-2'));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /repeated a tool call/i);
  });

  it('stops at the tool-loop limit without a final outcome', async () => {
    createChatCompletionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-1'))
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['E1'] }, 'call-2'));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /tool-loop limit/i);
  });

  it('rejects invalid JSON and invalid tool arguments', async () => {
    createChatCompletionMock.mockResolvedValueOnce(completion('submit_diagnosis_outcome', '{bad json'));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /invalid tool arguments/i);

    createChatCompletionMock.mockResolvedValueOnce(completion('submit_diagnosis_outcome', {}));
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);
  });

  it('rejects a 37-character repair code with a controlled validation failure', async () => {
    createChatCompletionMock.mockResolvedValueOnce(
      completion('get_repair_steps', { errorCode: 'X'.repeat(37) }, 'call-overlong'),
    );

    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);

    expect(searchErrorCodesMock).not.toHaveBeenCalled();
    expect(getRepairStepsMock).not.toHaveBeenCalled();
  });

  it('rejects an outcome call that omits reply even when other fields are present', async () => {
    createChatCompletionMock.mockResolvedValueOnce(
      completion('submit_diagnosis_outcome', {
        outcome: 'UNRESOLVED',
        followUpQuestion: null,
        suspectedComponents: null,
      }),
    );
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /failed validation/i);
  });

  it('rejects parallel tool calls and empty responses', async () => {
    createChatCompletionMock.mockResolvedValueOnce({
      choices: [{ message: { tool_calls: [{ id: 'a' }, { id: 'b' }] } }],
    });
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /parallel tool calls/i);

    createChatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [] } }] });
    await expectAiInvalidResponse(runDiagnosisTurn(input()), /structured outcome/i);
  });

  it('logs tool validation diagnostics with issue paths and no argument values', async () => {
    const secret = 'user-secret-please-do-not-log';
    createChatCompletionMock.mockResolvedValueOnce(
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
    createChatCompletionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockResolvedValueOnce(
        completion(
          'submit_diagnosis_outcome',
          { reply: 'Check the drain filter.', outcome: 'NEEDS_CLARIFICATION' },
          'call-final',
        ),
      );

    await runDiagnosisTurn(input());

    expect(createChatCompletionMock).toHaveBeenCalledTimes(2);
    expect(createChatCompletionMock.mock.calls[0]?.[1]).toEqual({
      round: 0,
      toolChoice: 'required',
    });
    expect(createChatCompletionMock.mock.calls[1]?.[1]).toEqual({
      round: 1,
      toolChoice: { type: 'function', function: { name: 'submit_diagnosis_outcome' } },
    });
  });

  it('uses a safe deterministic turn when the forced final tool call is missing', async () => {
    createChatCompletionMock
      .mockResolvedValueOnce(completion('search_error_codes', { codes: ['FE'] }, 'call-search'))
      .mockRejectedValueOnce(new ForcedToolNotCalledError());

    const result = await runDiagnosisTurn(input());

    expect(result.reply).toMatch(/could not complete a verified diagnosis/i);
    expect(result.progress).toMatchObject({
      status: 'OPEN',
      verdict: 'UNRESOLVED',
      outcome: 'UNRESOLVED',
    });
    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.issueFixChallenge).toBe(false);
    expect(result.errorCodeId).toBeUndefined();
    expect(result.nextContext.currentOutcome).toBe('UNRESOLVED');
    expect(JSON.stringify(result)).not.toContain('to=functions.json');
  });

  it('keeps hazard escalation when the forced final tool call is missing', async () => {
    createChatCompletionMock
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
    createChatCompletionMock
      .mockResolvedValueOnce(completion('get_repair_steps', { errorCode: 'FE' }, 'call-repair'))
      .mockRejectedValueOnce(new ForcedToolNotCalledError());

    const result = await runDiagnosisTurn(input({ knowledge: knowledgeWithCodes({ code: 'FE' }) }));

    expect(result.knowledge.repairSteps).toEqual([]);
    expect(result.errorCodeId).toBeUndefined();
    expect(result.issueFixChallenge).toBe(false);
    expect(result.progress.outcome).toBe('UNRESOLVED');
  });

  it('does not use the fallback when the missing tool call is outside the forced final round', async () => {
    createChatCompletionMock.mockRejectedValueOnce(new ForcedToolNotCalledError());

    await expect(runDiagnosisTurn(input())).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_REJECTED',
    });
  });
});
