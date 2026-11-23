import { describe, expect, it } from 'vitest';
import { diagnosisTools } from '../../src/services/ai/tool-definitions.js';
import {
  diagnosisOutcomeSchema,
  findReplacementPartsArgsSchema,
  getRepairStepsArgsSchema,
  knowledgeDtoSchema,
  submitDiagnosisOutcomeSchema,
} from '../../src/validators/ai.validator.js';

// The provider declarations are flat Gemini function tools. This adapter keeps
// the schema assertions below focused on the JSON Schema contract.
const geminiToolsAsLegacy: Array<{
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}> = diagnosisTools.map((tool) => ({
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

type OutcomeParameters = {
  type: string;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
};

const OUTCOME_PROPERTIES = [
  'reply',
  'outcome',
  'followUpQuestion',
  'suspectedComponents',
  'diagnosticFacts',
  'component',
  'partNumber',
];

const outcomeTool = geminiToolsAsLegacy.find(
  (tool) => tool.function?.name === 'submit_diagnosis_outcome',
);

function outcomeParameters(): OutcomeParameters {
  expect(outcomeTool).toBeDefined();
  return outcomeTool!.function!.parameters as OutcomeParameters;
}

const validSource = { title: 'Manual', sourceKind: 'MANUAL' as const };

describe('submit_diagnosis_outcome provider schema', () => {
  it('uses flat Gemini function declarations without non-native strict mode', () => {
    // Gemini's native declarations have no `strict` flag. Optional fields are
    // described as omittable; the backend Zod schema stays authoritative.
    expect(diagnosisTools[0]).toMatchObject({ type: 'function', name: expect.any(String) });
    expect(diagnosisTools[0]).not.toHaveProperty('function');
    expect(outcomeTool?.function?.strict).not.toBe(true);
    expect(outcomeTool?.function).not.toHaveProperty('strict');

    const otherTools = geminiToolsAsLegacy.filter(
      (tool) => tool.function?.name !== 'submit_diagnosis_outcome',
    );
    expect(otherTools).toHaveLength(3);
    for (const tool of otherTools) {
      expect(tool.function?.strict).not.toBe(true);
    }
  });

  it('requires only reply and outcome in the provider schema', () => {
    const parameters = outcomeParameters();
    expect(parameters.type).toBe('object');
    expect(parameters.additionalProperties).toBe(false);
    expect(Object.keys(parameters.properties).sort()).toEqual([...OUTCOME_PROPERTIES].sort());
    expect([...parameters.required].sort()).toEqual(['outcome', 'reply']);
  });

  it('documents optional arguments so the model may omit or null them', () => {
    const description = String(outcomeTool?.function?.description);
    expect(description).toMatch(/reply and outcome are mandatory/i);
    expect(description).toMatch(/omit optional fields/i);

    const { properties } = outcomeParameters();
    for (const name of ['followUpQuestion', 'suspectedComponents', 'diagnosticFacts', 'component', 'partNumber']) {
      expect(String(properties[name]?.description)).toMatch(/null\/omitted/i);
    }
  });

  it('uses Gemini-compatible scalar types for optional fields', () => {
    const { properties } = outcomeParameters();

    for (const name of ['followUpQuestion', 'component', 'partNumber']) {
      expect(properties[name]?.type).toBe('string');
      expect(properties[name]?.type).not.toContain('null');
      expect(properties[name]).not.toHaveProperty('minLength');
      expect(properties[name]).not.toHaveProperty('maxLength');
    }

    for (const name of ['suspectedComponents', 'diagnosticFacts']) {
      expect(properties[name]?.type).toBe('array');
      expect(properties[name]?.type).not.toContain('null');
      expect(properties[name]).not.toHaveProperty('maxItems');
      expect(properties[name]?.items).toEqual({ type: 'string' });
    }

    expect(properties.reply?.type).toBe('string');
    expect(properties.reply?.description).toMatch(/complete user-facing answer/i);
    expect(properties.reply).not.toHaveProperty('minLength');
    expect(properties.reply).not.toHaveProperty('maxLength');
    expect(properties.outcome?.type).toBe('string');
    expect(properties.outcome?.enum).toEqual(diagnosisOutcomeSchema.options);
  });
});

describe('submitDiagnosisOutcomeSchema backend validation', () => {
  it('accepts null optional fields from strict mode as absent', () => {
    const parsed = submitDiagnosisOutcomeSchema.safeParse({
      reply: 'Here is what to check next.',
      outcome: 'NEEDS_CLARIFICATION',
      followUpQuestion: null,
      suspectedComponents: null,
      diagnosticFacts: null,
      modelNumber: null,
      component: null,
      partNumber: null,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reply).toBe('Here is what to check next.');
      expect(parsed.data.outcome).toBe('NEEDS_CLARIFICATION');
    }
  });

  it('still accepts omitted optional fields', () => {
    expect(
      submitDiagnosisOutcomeSchema.safeParse({ reply: 'Understood.', outcome: 'UNRESOLVED' }).success,
    ).toBe(true);
  });

  it('still rejects a missing, null, or empty reply', () => {
    const missing = submitDiagnosisOutcomeSchema.safeParse({ outcome: 'UNRESOLVED' });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((issue) => issue.path[0] === 'reply')).toBe(true);
    }
    expect(submitDiagnosisOutcomeSchema.safeParse({ reply: null, outcome: 'UNRESOLVED' }).success).toBe(
      false,
    );
    expect(submitDiagnosisOutcomeSchema.safeParse({ reply: '', outcome: 'UNRESOLVED' }).success).toBe(
      false,
    );
  });

  it('still rejects invalid or null outcomes', () => {
    expect(submitDiagnosisOutcomeSchema.safeParse({ reply: 'Answer', outcome: 'BOGUS' }).success).toBe(
      false,
    );
    expect(submitDiagnosisOutcomeSchema.safeParse({ reply: 'Answer', outcome: null }).success).toBe(
      false,
    );
    expect(submitDiagnosisOutcomeSchema.safeParse({ reply: 'Answer' }).success).toBe(false);
  });

  it('preserves all Zod length and array bounds for non-null values', () => {
    expect(
      submitDiagnosisOutcomeSchema.safeParse({ reply: 'x'.repeat(4001), outcome: 'UNRESOLVED' }).success,
    ).toBe(false);
    expect(
      submitDiagnosisOutcomeSchema.safeParse({
        reply: 'Answer',
        outcome: 'UNRESOLVED',
        followUpQuestion: 'x'.repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      submitDiagnosisOutcomeSchema.safeParse({
        reply: 'Answer',
        outcome: 'UNRESOLVED',
        suspectedComponents: Array.from({ length: 6 }, () => 'part'),
      }).success,
    ).toBe(false);
    expect(
      submitDiagnosisOutcomeSchema.safeParse({
        reply: 'Answer',
        outcome: 'UNRESOLVED',
        diagnosticFacts: Array.from({ length: 9 }, () => 'fact'),
      }).success,
    ).toBe(false);
  });
});

describe('knowledge repair-step validation is unchanged', () => {
  const base = { unverified: false, errorCodes: [] };

  it('rejects malformed repair steps', () => {
    expect(
      knowledgeDtoSchema.safeParse({
        ...base,
        repairSteps: [{ position: 0, instruction: 'Clear the filter.', source: validSource }],
      }).success,
    ).toBe(false);
    expect(
      knowledgeDtoSchema.safeParse({
        ...base,
        repairSteps: [{ position: 1, instruction: '', source: validSource }],
      }).success,
    ).toBe(false);
    expect(
      knowledgeDtoSchema.safeParse({
        ...base,
        repairSteps: [{ position: 1.5, instruction: 'Clear the filter.', source: validSource }],
      }).success,
    ).toBe(false);
    expect(
      knowledgeDtoSchema.safeParse({
        ...base,
        repairSteps: [
          { position: 1, instruction: 'Clear the filter.', source: { title: 'x', sourceKind: 'UNKNOWN' } },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a well-formed repair step', () => {
    expect(
      knowledgeDtoSchema.safeParse({
        ...base,
        repairSteps: [{ position: 1, instruction: 'Clear the filter.', source: validSource }],
      }).success,
    ).toBe(true);
  });
});

describe('AI-controlled model arguments are removed', () => {
  it('strips a modelNumber from the final outcome payload', () => {
    const parsed = submitDiagnosisOutcomeSchema.parse({
      reply: 'Let us narrow this down.',
      outcome: 'NEEDS_CLARIFICATION',
      modelNumber: 'AI-INVENTED-MODEL',
    });

    expect(parsed).not.toHaveProperty('modelNumber');
  });

  it('exposes only component and optional part number for parts discovery', () => {
    const partsTool = geminiToolsAsLegacy.find((tool) => tool.function?.name === 'find_replacement_parts');
    expect(partsTool).toBeDefined();
    const parameters = partsTool!.function!.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };

    expect(Object.keys(parameters.properties).sort()).toEqual(['component', 'partNumber']);
    expect(parameters.required).toEqual(['component']);
    expect(parameters.additionalProperties).toBe(false);
    expect(String(partsTool!.function!.description)).toMatch(/backend-trusted appliance identity/i);

    const parsed = findReplacementPartsArgsSchema.parse({
      component: 'drain pump',
      modelNumber: 'AI-INVENTED-MODEL',
    });
    expect(parsed).toEqual({ component: 'drain pump' });
    expect(parsed).not.toHaveProperty('modelNumber');
  });
});

describe('get_repair_steps manufacturer-code contract', () => {
  const repairTool = geminiToolsAsLegacy.find((tool) => tool.function?.name === 'get_repair_steps');

  it('requires one bounded errorCode with no UUID format and no strict mode', () => {
    expect(repairTool?.function?.strict).not.toBe(true);
    const parameters = repairTool!.function!.parameters as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(parameters.required).toEqual(['errorCode']);
    expect(parameters.additionalProperties).toBe(false);
    expect(Object.keys(parameters.properties)).toEqual(['errorCode']);
    expect(parameters.properties.errorCode?.type).toBe('string');
    expect(parameters.properties.errorCode).not.toHaveProperty('format');
    expect(parameters.properties.errorCode?.minLength).toBe(1);
    expect(parameters.properties.errorCode?.maxLength).toBe(36);
    expect('WW80T3040WW'.length).toBeLessThanOrEqual(parameters.properties.errorCode!.maxLength as number);
  });

  it('describes the code as an error code, not a model number or UUID', () => {
    const description = String(
      (repairTool!.function!.parameters as {
        properties: Record<string, { description?: string }>;
      }).properties.errorCode?.description,
    );
    expect(description).toMatch(/manufacturer error code/i);
    expect(description).toMatch(/errorCodes\[\]\.code/);
    expect(description).toMatch(/NOT the appliance model number/i);
    expect(description).toMatch(/NOT an internal database UUID/i);
  });

  it('trims and uppercases manufacturer codes consistently', () => {
    const parsed = getRepairStepsArgsSchema.parse({ errorCode: '  fe  ' });
    expect(parsed.errorCode).toBe('FE');
  });

  it('accepts model numbers, 17-character codes and complete UUIDs within the bound', () => {
    expect(getRepairStepsArgsSchema.safeParse({ errorCode: 'WW80T3040WW' }).success).toBe(true);
    expect(getRepairStepsArgsSchema.safeParse({ errorCode: 'x'.repeat(17) }).success).toBe(true);
    expect(
      getRepairStepsArgsSchema.safeParse({ errorCode: '00000000-0000-4000-8000-000000000001' }).success,
    ).toBe(true);
  });

  it('rejects empty, non-string, and 37-character codes', () => {
    expect(getRepairStepsArgsSchema.safeParse({ errorCode: '' }).success).toBe(false);
    expect(getRepairStepsArgsSchema.safeParse({ errorCode: 42 }).success).toBe(false);
    expect(getRepairStepsArgsSchema.safeParse({ errorCode: 'x'.repeat(37) }).success).toBe(false);
    expect(getRepairStepsArgsSchema.safeParse({}).success).toBe(false);
  });
});
