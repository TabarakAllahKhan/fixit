import type { Groq } from 'groq-sdk';

// Small explicit tool surface. The model may request work, but backend code
// validates every argument and decides what may be returned or persisted.

const outcomeValues = [
  'NEEDS_CLARIFICATION',
  'NEEDS_MODEL_NUMBER',
  'READY_FOR_CONFIRMATION',
  'NEEDS_PART',
  'TECHNICIAN_REQUIRED',
  'UNRESOLVED',
  'FIXED',
];

export const diagnosisTools: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_error_codes',
      description:
        'Look up approved error-code candidates for the trusted appliance category and brand. Use when an error code is known or suspected.',
      parameters: {
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_repair_steps',
      description:
        'Retrieve a complete approved, user-safe repair sequence. The backend resolves the error code to an approved record and rejects partial, unreviewed, unsafe or inapplicable sequences.',
      parameters: {
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_replacement_parts',
      description:
        'Search for replacement parts. Requires a suspected component and exact appliance brand/model; the backend controls the provider and compatibility classification.',
      parameters: {
        type: 'object',
        properties: {
          component: { type: 'string', minLength: 1, maxLength: 120 },
          partNumber: { type: 'string', minLength: 1, maxLength: 64 },
          modelNumber: { type: 'string', minLength: 1, maxLength: 80 },
        },
        required: ['component'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_diagnosis_outcome',
      description:
        'Finish the turn with the user-facing reply and proposed diagnostic state. Always use this tool instead of plain final text.',
      // Groq strict mode requires every property to be listed as required and
      // absent optional values to be expressed as nullable unions. Bounds stay
      // in the Zod validator, which remains the backend authority.
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          reply: {
            type: 'string',
            description: 'The complete user-facing answer for this turn. Required in every call.',
          },
          outcome: { type: 'string', enum: outcomeValues },
          followUpQuestion: { type: ['string', 'null'] },
          suspectedComponents: {
            type: ['array', 'null'],
            items: { type: 'string' },
          },
          diagnosticFacts: {
            type: ['array', 'null'],
            items: { type: 'string' },
          },
          modelNumber: { type: ['string', 'null'] },
          component: { type: ['string', 'null'] },
          partNumber: { type: ['string', 'null'] },
        },
        required: [
          'reply',
          'outcome',
          'followUpQuestion',
          'suspectedComponents',
          'diagnosticFacts',
          'modelNumber',
          'component',
          'partNumber',
        ],
        additionalProperties: false,
      },
    },
  },
];

export const diagnosisToolNames = new Set(diagnosisTools.map((tool) => tool.function!.name!));
