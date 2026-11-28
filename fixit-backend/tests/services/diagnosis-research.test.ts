import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { MessageRole, SessionStatus } from '../../src/generated/prisma/client.js';
import type { ResearchDto } from '../../src/validators/research.validator.js';

// Phase 2C research integration in the diagnosis turn. Prisma, the
// orchestrator and the research provider call are mocked; no network or
// database is used.

const { prisma, runDiagnosisTurnMock, searchErrorCodesMock, researchMock } = vi.hoisted(() => ({
  prisma: {
    diagnosisSession: { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    message: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  runDiagnosisTurnMock: vi.fn(),
  searchErrorCodesMock: vi.fn(),
  researchMock: vi.fn(),
}));

vi.mock('../../src/config/prisma.js', () => ({ prisma }));
vi.mock('../../src/services/ai/orchestrator.js', () => ({ runDiagnosisTurn: runDiagnosisTurnMock }));
vi.mock('../../src/services/parts.service.js', () => ({ searchReplacementParts: vi.fn() }));
vi.mock('../../src/services/knowledge.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/knowledge.service.js')>();
  return { ...actual, searchErrorCodes: searchErrorCodesMock };
});
vi.mock('../../src/services/research.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/research.service.js')>();
  return { ...actual, researchApplianceIssue: researchMock };
});

import { buildResearchAnchorKey, buildResearchKey } from '../../src/services/research.service.js';
import { sendMessage } from '../../src/services/diagnosis.service.js';

const sessionId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-0000000000a1';
const originalProvider = env.RESEARCH_PROVIDER;

const completed: ResearchDto = {
  status: 'COMPLETED',
  confidence: 'THIRD_PARTY_SUPPORTED',
  results: [
    {
      title: 'Dishwasher drain guide',
      url: 'https://www.lg.com/support/drain',
      snippet: 'Clean the filter.',
      sourceKind: 'SEARCH_RESULT',
      trust: 'MANUFACTURER',
      exactModelMatch: false,
      exactErrorCodeMatch: true,
      relevance: 'DIRECT',
      contradicted: false,
      confidence: 'THIRD_PARTY_SUPPORTED',
    },
  ],
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    status: SessionStatus.OPEN,
    context: null,
    errorCode: 'E24',
    symptom: 'Dishwasher not draining',
    updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    appliance: { category: null, brand: 'LG', modelNumber: null },
    ...overrides,
  };
}

function row(role: MessageRole, metadata: unknown = null) {
  return {
    id: role === MessageRole.USER ? '00000000-0000-4000-8000-0000000000b1' : '00000000-0000-4000-8000-0000000000b2',
    sessionId,
    role,
    content: role === MessageRole.USER ? 'Still not draining' : 'Let us check the filter.',
    createdAt: new Date(),
    metadata,
  };
}

function orchestratorResult(overrides: Record<string, unknown> = {}) {
  return {
    reply: 'Let us check the filter.',
    progress: { status: 'OPEN' as const, verdict: null, outcome: 'NEEDS_CLARIFICATION' as const },
    knowledge: { unverified: false, errorCodes: [], repairSteps: [] },
    citations: [],
    nextContext: { suspectedComponents: [], diagnosticFacts: [] },
    issueFixChallenge: false,
    ...overrides,
  };
}

function orchestratorInput() {
  expect(runDiagnosisTurnMock).toHaveBeenCalledTimes(1);
  return runDiagnosisTurnMock.mock.calls[0]![0] as {
    research?: ResearchDto;
    context: {
      research?: { key: string; anchorKey?: string; result: ResearchDto };
      safety?: { activeCategories: string[] };
      trustedApplianceIdentity?: unknown;
    };
    identity: { modelNumber: string | null; modelSource: string | null };
  };
}

function storedAssistantMetadata(): Record<string, unknown> {
  const call = prisma.message.create.mock.calls.find(
    (args: unknown[]) => (args[0] as { data: { role: MessageRole } }).data.role === MessageRole.ASSISTANT,
  );
  return (call![0] as { data: { metadata: Record<string, unknown> } }).data.metadata;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.RESEARCH_PROVIDER = 'groq_browser';
  prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma));
  prisma.diagnosisSession.findFirst.mockResolvedValue(session());
  prisma.diagnosisSession.updateMany.mockResolvedValue({ count: 1 });
  prisma.message.findMany.mockResolvedValue([]);
  prisma.message.findFirst.mockResolvedValue(null);
  prisma.message.create.mockImplementation(async ({ data }: { data: { role: MessageRole; metadata?: unknown } }) =>
    row(data.role, data.metadata ?? null),
  );
  searchErrorCodesMock.mockResolvedValue({ unverified: false, errorCodes: [], repairSteps: [] });
  researchMock.mockResolvedValue(completed);
  runDiagnosisTurnMock.mockResolvedValue(orchestratorResult());
});

afterEach(() => {
  env.RESEARCH_PROVIDER = originalProvider;
});

async function send(content = 'Still not draining, now it shows E99') {
  return sendMessage('user-1', { id: sessionId }, { requestId, content });
}

describe('diagnosis research integration', () => {
  it('does not research when the provider is disabled', async () => {
    env.RESEARCH_PROVIDER = 'none';

    await send();

    expect(researchMock).not.toHaveBeenCalled();
    expect(orchestratorInput().research).toBeUndefined();
    expect(storedAssistantMetadata()).not.toHaveProperty('research');
  });

  it('runs one bounded research call with the persisted error code, never codes inferred from text', async () => {
    await send('Still not draining, now it shows E99');

    expect(researchMock).toHaveBeenCalledTimes(1);
    expect(researchMock).toHaveBeenCalledWith({
      brand: 'LG',
      modelNumber: null,
      errorCode: 'E24',
      symptom: 'Dishwasher not draining',
    });
    expect(JSON.stringify(researchMock.mock.calls[0])).not.toContain('E99');
  });

  it('passes no error code when the session has none, even if the message contains one', async () => {
    prisma.diagnosisSession.findFirst.mockResolvedValue(session({ errorCode: null }));

    await send('It shows E15');

    expect(researchMock).toHaveBeenCalledWith(expect.objectContaining({ errorCode: null }));
  });

  it('anchors research on a trusted registered model only', async () => {
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({ appliance: { category: null, brand: 'LG', modelNumber: 'LDF5545ST' } }),
    );

    await send();

    expect(researchMock).toHaveBeenCalledWith(expect.objectContaining({ modelNumber: 'LDF5545ST' }));
  });

  it('passes research to the orchestrator, caches it in context and stores a bounded summary', async () => {
    await send();

    const call = orchestratorInput();
    expect(call.research).toEqual(completed);
    expect(call.context.research).toMatchObject({
      version: 1,
      key: buildResearchKey({ brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: 'Dishwasher not draining' }),
      result: completed,
    });
    expect(storedAssistantMetadata().research).toEqual({
      status: 'COMPLETED',
      confidence: 'THIRD_PARTY_SUPPORTED',
      reused: false,
      sources: [
        {
          title: 'Dishwasher drain guide',
          url: 'https://www.lg.com/support/drain',
          trust: 'MANUFACTURER',
          confidence: 'THIRD_PARTY_SUPPORTED',
        },
      ],
    });
  });

  it('reuses cached research while the research key is unchanged', async () => {
    const key = buildResearchKey({ brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: 'Dishwasher not draining' })!;
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        context: {
          suspectedComponents: [],
          diagnosticFacts: [],
          research: { version: 1, key, researchedAt: '2026-11-28T00:00:00.000Z', result: completed },
        },
      }),
    );

    await send();

    expect(researchMock).not.toHaveBeenCalled();
    expect(orchestratorInput().research).toEqual(completed);
    expect(storedAssistantMetadata().research).toMatchObject({ reused: true });
  });

  it('researches again when the key changes (new trusted model)', async () => {
    const oldKey = buildResearchKey({ brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: 'Dishwasher not draining' })!;
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        appliance: { category: null, brand: 'LG', modelNumber: 'LDF5545ST' },
        context: {
          suspectedComponents: [],
          diagnosticFacts: [],
          research: { version: 1, key: oldKey, researchedAt: '2026-11-28T00:00:00.000Z', result: completed },
        },
      }),
    );

    await send();

    expect(researchMock).toHaveBeenCalledTimes(1);
    expect(orchestratorInput().context.research?.key).not.toBe(oldKey);
  });

  it('retries research that was previously unavailable', async () => {
    const key = buildResearchKey({ brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: 'Dishwasher not draining' })!;
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        context: {
          suspectedComponents: [],
          diagnosticFacts: [],
          research: {
            version: 1,
            key,
            researchedAt: '2026-11-28T00:00:00.000Z',
            result: { status: 'UNAVAILABLE', confidence: 'INSUFFICIENT', results: [] },
          },
        },
      }),
    );

    await send();

    expect(researchMock).toHaveBeenCalledTimes(1);
    expect(storedAssistantMetadata().research).toMatchObject({ status: 'COMPLETED', reused: false });
  });

  it('stores a symptom-free anchor key with new research', async () => {
    await send();

    expect(orchestratorInput().context.research).toMatchObject({
      anchorKey: buildResearchAnchorKey({ brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: 'x' }),
    });
  });

  it('does not re-research on every turn for a legacy session with no persisted symptom', async () => {
    const firstMessage = 'It stopped draining yesterday';
    const query = { brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: firstMessage };
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        symptom: null,
        context: {
          suspectedComponents: [],
          diagnosticFacts: [],
          research: {
            version: 1,
            key: buildResearchKey(query)!,
            anchorKey: buildResearchAnchorKey(query)!,
            researchedAt: '2026-11-28T00:00:00.000Z',
            result: completed,
          },
        },
      }),
    );

    // A different message would produce a different symptom key every turn.
    await send('Now it also beeps three times');

    expect(researchMock).not.toHaveBeenCalled();
    expect(storedAssistantMetadata().research).toMatchObject({ reused: true });
  });

  it('still re-researches a legacy session when its trusted identity changes', async () => {
    const query = { brand: 'LG', modelNumber: null, errorCode: 'E24', symptom: 'It stopped draining' };
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        symptom: null,
        appliance: { category: null, brand: 'LG', modelNumber: 'LDF5545ST' },
        context: {
          suspectedComponents: [],
          diagnosticFacts: [],
          research: {
            version: 1,
            key: buildResearchKey(query)!,
            anchorKey: buildResearchAnchorKey(query)!,
            researchedAt: '2026-11-28T00:00:00.000Z',
            result: completed,
          },
        },
      }),
    );

    await send('Now it also beeps three times');

    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it('skips research when persisted safety state is corrupt (fail closed)', async () => {
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({ context: { suspectedComponents: [], diagnosticFacts: [], safety: { activeCategories: ['SMOKE'] } } }),
    );

    await send('What should I check next?');

    expect(researchMock).not.toHaveBeenCalled();
    expect(orchestratorInput().context).toMatchObject({ safety: { activeCategories: ['UNVERIFIED_HAZARD'] } });
  });

  it('skips research entirely when the user reports an immediate hazard', async () => {
    runDiagnosisTurnMock.mockResolvedValue(
      orchestratorResult({
        progress: { status: 'OPEN', verdict: 'TECHNICIAN_REQUIRED', outcome: 'TECHNICIAN_REQUIRED' },
        safety: { categories: ['GAS'] },
      }),
    );

    await send('I can smell gas near the oven');

    expect(researchMock).not.toHaveBeenCalled();
    expect(orchestratorInput().research).toBeUndefined();
    expect(storedAssistantMetadata()).not.toHaveProperty('research');
    expect(storedAssistantMetadata().safety).toEqual({ categories: ['GAS'] });
  });

  // Fourth review (CR-A): natural gas wording is caught by the backend
  // classifier before any research call.
  it.each([
    'It smelt of gas when I came in.',
    'I can hear gas hissing behind the stove.',
    'I took the gas hose off.',
    'I disconnected the gas to move the stove.',
  ])('skips research for the gas report "%s"', async (content) => {
    await send(content);

    expect(researchMock).not.toHaveBeenCalled();
    expect(orchestratorInput().research).toBeUndefined();
  });

  it('still researches after a general hazard question', async () => {
    await send('Is there a risk of electric shock when cleaning the filter?');

    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it('skips research for a sticky hazard persisted by an earlier turn', async () => {
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        context: { suspectedComponents: [], diagnosticFacts: [], safety: { activeCategories: ['FIRE_SMOKE'] } },
      }),
    );

    await send('What should I check now?');

    expect(researchMock).not.toHaveBeenCalled();
  });

  it('degrades an unexpected research failure to UNAVAILABLE without failing the turn', async () => {
    researchMock.mockRejectedValueOnce(new Error('boom'));

    const turn = await send();

    expect(turn.assistantMessage).toBeDefined();
    expect(orchestratorInput().research).toEqual({ status: 'UNAVAILABLE', confidence: 'INSUFFICIENT', results: [] });
  });

  it('keeps trusted identity when the optional research cache is corrupt', async () => {
    prisma.diagnosisSession.findFirst.mockResolvedValue(
      session({
        context: {
          trustedApplianceIdentity: {
            version: 1,
            modelNumber: 'USER-MODEL-1',
            modelSource: 'USER_MESSAGE',
            modelScope: null,
            scopeSource: null,
          },
          suspectedComponents: ['drain pump'],
          diagnosticFacts: [],
          research: { version: 99, key: 'not-a-hash', result: 'garbage' },
        },
      }),
    );

    await send('What next?');

    const call = orchestratorInput();
    expect(call.identity).toMatchObject({ modelNumber: 'USER-MODEL-1', modelSource: 'USER_MESSAGE' });
    // The corrupt cache was dropped and replaced by fresh research.
    expect(researchMock).toHaveBeenCalledTimes(1);
    expect(call.context.research?.result).toEqual(completed);
  });

  it('exposes troubleshooting, research and safety fields on the returned turn', async () => {
    runDiagnosisTurnMock.mockResolvedValue(
      orchestratorResult({
        troubleshooting: { steps: ['Rinse the filter under running water.'], evidence: 'THIRD_PARTY_SUPPORTED' },
      }),
    );

    const turn = await send();

    expect(turn.troubleshooting).toEqual({
      steps: ['Rinse the filter under running water.'],
      evidence: 'THIRD_PARTY_SUPPORTED',
    });
    expect(turn.research).toMatchObject({ status: 'COMPLETED' });
  });
});
