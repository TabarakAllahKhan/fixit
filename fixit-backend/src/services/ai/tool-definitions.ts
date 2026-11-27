import type { AiFunctionDeclaration } from './provider.js';

// Small explicit tool surface. The model may request work, but backend code
// validates every argument and decides what may be returned or persisted.
// These are native Gemini Interactions API function declarations. Zod schemas
// in ai.validator.ts remain the only authority for executed arguments.

const outcomeValues = [
  'NEEDS_CLARIFICATION',
  'NEEDS_MODEL_NUMBER',
  'READY_FOR_CONFIRMATION',
  'NEEDS_PART',
  'TECHNICIAN_REQUIRED',
  'UNRESOLVED',
  'FIXED',
];

// Gemini's function schema subset does not accept `type: ["string", "null"]`.
// Optional fields still accept omissions/null at the Zod boundary; the
// descriptions tell the model exactly how to omit them.
function normalizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (node && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' && Array.isArray(value)) {
        const nonNull = value.filter((item) => item !== 'null');
        result[key] = nonNull.length === 1 ? nonNull[0] : nonNull;
      } else {
        result[key] = normalizeSchema(value);
      }
    }
    return result;
  }
  return node;
}

function declaration(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): AiFunctionDeclaration {
  return {
    type: 'function',
    name,
    description,
    parameters: normalizeSchema(parameters) as Record<string, unknown>,
  };
}

export const diagnosisTools: readonly AiFunctionDeclaration[] = [
  declaration(
    'search_error_codes',
    'Look up approved error-code candidates for the trusted appliance brand and category when one is known. Use when an error code is known or suspected; no category-specific candidates exist without a trusted category.',
    {
      type: 'object',
      properties: {
        codes: {
          type: 'array',
          description: 'Exact code-like tokens to look up. Omit to use clues already in the conversation.',
          items: { type: 'string', maxLength: 16 },
          maxItems: 8,
        },
      },
      additionalProperties: false,
    },
  ),
  declaration(
    'get_repair_steps',
    'Retrieve a complete approved, user-safe repair sequence. The backend resolves the error code to an approved record and rejects partial, unreviewed, unsafe or inapplicable sequences.',
    {
      type: 'object',
      properties: {
        errorCode: {
          type: 'string',
          minLength: 1,
          maxLength: 36,
          description:
            'The manufacturer error code from Backend knowledge candidates (errorCodes[].code), e.g. FE. This is NOT the appliance model number and NOT an internal database UUID; the backend resolves it to the approved record.',
        },
      },
      required: ['errorCode'],
      additionalProperties: false,
    },
  ),
  declaration(
    'find_replacement_parts',
    'Search for replacement parts using the backend-trusted appliance identity. Only a suspected component (and optional part number) may be supplied; the backend supplies the trusted brand and model.',
    {
      type: 'object',
      properties: {
        component: { type: 'string', minLength: 1, maxLength: 120 },
        partNumber: { type: 'string', minLength: 1, maxLength: 64 },
      },
      required: ['component'],
      additionalProperties: false,
    },
  ),
  declaration(
    'submit_diagnosis_outcome',
    'Finish the turn with the user-facing reply and proposed diagnostic state. Always use this tool instead of plain final text. reply and outcome are mandatory; omit optional fields that do not apply (or send null). Use NEEDS_CLARIFICATION while safe checks remain; reserve TECHNICIAN_REQUIRED for immediate hazards or confirmed professional-only work. Never include dangerous repair instructions in reply or followUpQuestion.',
    // Only reply/outcome are truly required. Gemini must be able to omit the
    // nullable optional arguments; Zod remains the authority for every supplied
    // value, type and bound.
    {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description: 'The complete user-facing answer for this turn. Required in every call.',
        },
        outcome: { type: 'string', enum: outcomeValues },
        followUpQuestion: {
          type: 'string',
          description:
            'One short diagnostic question, or null/omitted when none is needed. Omit for terminal outcomes such as TECHNICIAN_REQUIRED or UNRESOLVED.',
        },
        suspectedComponents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suspected component names, or null/omitted when there are none.',
        },
        diagnosticFacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Observed diagnostic facts, or null/omitted when there are none.',
        },
        component: {
          type: 'string',
          description: 'Component for parts discovery, or null/omitted when no part is needed.',
        },
        partNumber: {
          type: 'string',
          description: 'Known part number, or null/omitted when unknown.',
        },
      },
      required: ['reply', 'outcome'],
      additionalProperties: false,
    },
  ),
];

export const diagnosisToolNames = new Set(diagnosisTools.map((tool) => tool.name));
