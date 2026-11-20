import type { Groq } from 'groq-sdk';
import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import { logAiToolFailure } from '../../utils/aiDiagnostics.js';
import { ForcedToolNotCalledError } from '../../utils/aiErrors.js';
import { HttpError } from '../../utils/httpError.js';
import type { MessageDto } from '../../types/diagnosis.dto.js';
import {
  findReplacementPartsArgsSchema,
  getRepairStepsArgsSchema,
  searchErrorCodeArgsSchema,
  submitDiagnosisOutcomeSchema,
  type CitationDto,
  type DiagnosisContextDto,
  type DiagnosisOutcome,
  type DiagnosisProgressDto,
  type KnowledgeDto,
  type PartsDto,
  type SubmitDiagnosisOutcome,
} from '../../validators/ai.validator.js';
import { createChatCompletion } from '../groq.service.js';
import {
  collectKnowledgeCitations,
  extractCandidateCodes,
  getApprovedRepairSequence,
  searchErrorCodes,
  type ApprovedRepairSequence,
  type KnowledgeApplianceContext,
} from '../knowledge.service.js';
import { buildDiagnosisMessages } from './prompt.js';
import { diagnosisToolNames, diagnosisTools } from './tool-definitions.js';

export type PartsSearchFn = (query: {
  brand: string;
  modelNumber: string;
  component: string;
  partNumber?: string;
}) => Promise<PartsDto>;

export type OrchestratorInput = {
  appliance: { category: 'WASHING_MACHINE' | 'REFRIGERATOR'; brand: string; modelNumber: string | null };
  context: DiagnosisContextDto;
  history: readonly MessageDto[];
  userContent: string;
  knowledge: KnowledgeDto;
  includeUnreviewed: boolean;
  partsSearch: PartsSearchFn;
};

export type OrchestratorResult = {
  reply: string;
  progress: DiagnosisProgressDto;
  knowledge: KnowledgeDto;
  parts?: PartsDto;
  citations: CitationDto[];
  nextContext: DiagnosisContextDto;
  errorCodeId?: string;
  issueFixChallenge: boolean;
};

type ToolState = {
  final?: SubmitDiagnosisOutcome;
  parts?: PartsDto;
  repairSequence?: ApprovedRepairSequence;
};

const HAZARD_PATTERN =
  /\b(main[s]?|mains|voltage|live wire|electrical panel|gas line|gas valve|refrigerant|sealed system|compressor replacement|open(?:ing)? (?:the )?panel|bypass|door lock bypass|disconnect the earth|capacitor)\b/i;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

type ToolCallLike = { function?: { name?: unknown } };

function logToolFailure(
  reason: string,
  details: {
    round: number;
    finishReason?: unknown;
    calls?: readonly ToolCallLike[];
    totalToolCalls?: number;
    zodIssuePaths?: readonly (readonly (string | number)[])[];
  },
): void {
  logAiToolFailure({
    reason,
    round: details.round + 1,
    toolName: details.calls?.[0]?.function?.name,
    finishReason: details.finishReason,
    toolCallCount: details.calls?.length ?? 0,
    totalToolCalls: details.totalToolCalls,
    zodIssuePaths: details.zodIssuePaths,
  });
}

function failTool(reason: string, details: Parameters<typeof logToolFailure>[1]): never {
  logToolFailure(reason, details);
  throw new HttpError(502, 'AI_INVALID_RESPONSE', reason);
}

function allConversationText(input: OrchestratorInput): string[] {
  return [
    input.userContent,
    ...input.history.map((message) => message.content),
    ...input.context.diagnosticFacts,
  ];
}

function isValidModelNumber(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(value);
}

function resolveModelNumber(input: OrchestratorInput, candidate?: string | null): string | undefined {
  const known = [input.appliance.modelNumber, input.context.confirmedModelNumber, candidate].filter(
    (value): value is string => Boolean(value && isValidModelNumber(value)),
  );
  for (const value of known) {
    if (value === input.appliance.modelNumber || value === input.context.confirmedModelNumber) return value;
    if (allConversationText(input).some((text) => text.includes(value))) return value;
  }
  return undefined;
}

function inferModelScope(input: OrchestratorInput): DiagnosisContextDto['modelScope'] {
  const text = allConversationText(input).join(' ').toLowerCase();
  if (input.appliance.category === 'REFRIGERATOR' && /french door|bottom freezer/.test(text)) {
    return 'FRENCH_DOOR_BOTTOM_FREEZER';
  }
  if (input.appliance.category === 'WASHING_MACHINE') {
    if (/top[\s-]?load/.test(text)) return 'TOP_LOAD';
    if (/front[\s-]?load/.test(text)) return 'FRONT_LOAD';
  }
  return undefined;
}

type ErrorCodeResolution =
  | { status: 'matched'; id: string }
  | { status: 'ineligible'; reason: string };

// errorCodeId is an internal database identifier and is never accepted from the
// model. The model supplies a manufacturer code; the backend performs a fresh
// knowledge search with the appliance's own category, brand and model scope, so
// a code returned by search_error_codes is resolvable even when it was not
// present in the precomputed prompt knowledge. `trusted` means approved with
// an exact scope match. Only a single unambiguous trusted match may be used.
async function resolveErrorCodeId(
  input: OrchestratorInput,
  errorCode: string,
): Promise<ErrorCodeResolution> {
  const normalized = errorCode.trim().toUpperCase();
  const knowledge = await searchErrorCodes(
    {
      category: input.appliance.category,
      brand: input.appliance.brand,
      modelScope: input.context.modelScope,
    },
    [normalized],
    input.includeUnreviewed,
  );
  const matches = knowledge.errorCodes.filter(
    (candidate) => candidate.code.trim().toUpperCase() === normalized && candidate.trusted,
  );

  if (matches.length === 0) {
    return {
      status: 'ineligible',
      reason: 'The error code is unknown, not approved, or not applicable to this appliance.',
    };
  }
  if (matches.length > 1) {
    return {
      status: 'ineligible',
      reason: 'The error code matches more than one approved record; no repair sequence can be selected.',
    };
  }
  return { status: 'matched', id: matches[0]!.id };
}

function hasHazard(input: OrchestratorInput, final: SubmitDiagnosisOutcome, knowledge: KnowledgeDto): boolean {
  const stepText = knowledge.repairSteps.map((step) => step.instruction).join(' ');
  const facts = final.diagnosticFacts ?? [];
  return HAZARD_PATTERN.test([input.userContent, final.reply, stepText, ...facts].join(' '));
}

function mergeUnique(current: readonly string[], additions: readonly string[], max: number): string[] {
  const values: string[] = [];
  for (const value of [...current, ...additions]) {
    const trimmed = value.trim();
    if (trimmed && !values.includes(trimmed)) values.push(trimmed);
    if (values.length >= max) break;
  }
  return values;
}

function defaultProgress(outcome: DiagnosisOutcome, followUpQuestion?: string | null): DiagnosisProgressDto {
  const terminalVerdict =
    outcome === 'NEEDS_PART' ||
    outcome === 'TECHNICIAN_REQUIRED' ||
    outcome === 'UNRESOLVED'
      ? outcome
      : null;

  return {
    status: 'OPEN',
    verdict: terminalVerdict,
    outcome,
    ...(followUpQuestion ? { followUpQuestion } : {}),
  };
}

function decideOutcome(input: OrchestratorInput, final: SubmitDiagnosisOutcome, state: ToolState) {
  const hazard = hasHazard(input, final, state.repairSequence?.eligible ? withRepairSteps(state) : { ...input.knowledge, repairSteps: [] });
  const modelNumber = resolveModelNumber(input, final.modelNumber);
  let outcome = final.outcome;
  let reply = final.reply;

  if (hazard) {
    outcome = 'TECHNICIAN_REQUIRED';
    reply =
      'This may involve electrical, gas, refrigerant or safety-critical work. Stop and contact a qualified technician rather than attempting a DIY repair.';
  } else if (outcome === 'FIXED') {
    outcome = state.repairSequence?.eligible ? 'READY_FOR_CONFIRMATION' : 'UNRESOLVED';
  } else if (outcome === 'READY_FOR_CONFIRMATION' && !state.repairSequence?.eligible) {
    outcome = 'UNRESOLVED';
  } else if (outcome === 'NEEDS_PART' && !modelNumber) {
    outcome = 'NEEDS_MODEL_NUMBER';
  }

  const followUpQuestion =
    outcome === 'NEEDS_MODEL_NUMBER'
      ? final.followUpQuestion ?? 'What is the exact appliance model number from the sticker?'
      : final.followUpQuestion;

  const safeKnowledge: KnowledgeDto = {
    ...input.knowledge,
    repairSteps:
      !hazard && outcome === 'READY_FOR_CONFIRMATION' && state.repairSequence?.eligible
        ? state.repairSequence.steps
        : [],
  };

  const nextContext: DiagnosisContextDto = {
    ...input.context,
    suspectedComponents: mergeUnique(input.context.suspectedComponents, final.suspectedComponents ?? [], 10),
    diagnosticFacts: mergeUnique(input.context.diagnosticFacts, final.diagnosticFacts ?? [], 20),
    ...(modelNumber ? { confirmedModelNumber: modelNumber, modelNumberSource: modelNumber === input.appliance.modelNumber ? 'APPLIANCE' : 'USER_MESSAGE' } : {}),
    ...(inferModelScope(input) ? { modelScope: inferModelScope(input) } : {}),
    ...(input.context.errorCodeHypothesis || state.repairSequence?.eligible
      ? { errorCodeHypothesis: input.context.errorCodeHypothesis ?? extractCandidateCodes(allConversationText(input))[0] }
      : {}),
    currentOutcome: outcome,
    ...(outcome === 'NEEDS_PART' && final.component
      ? {
          lastPartsQuery: {
            component: final.component,
            ...(final.partNumber ? { partNumber: final.partNumber } : {}),
            ...(modelNumber ? { modelNumberUsed: modelNumber } : {}),
          },
        }
      : {}),
  };

  const citations = [
    ...collectKnowledgeCitations(safeKnowledge),
    ...(state.parts?.candidates ?? []).map<CitationDto>((candidate) => ({
      title: candidate.sourceName,
      url: candidate.url,
      sourceKind: 'SEARCH_RESULT',
    })),
  ];
  const seen = new Set<string>();
  const uniqueCitations = citations.filter((citation) => {
    const key = `${citation.title}|${citation.url ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    reply,
    progress: defaultProgress(outcome, followUpQuestion),
    knowledge: safeKnowledge,
    parts: state.parts,
    citations: uniqueCitations,
    nextContext,
    errorCodeId: state.repairSequence?.eligible ? state.repairSequence.errorCodeId : undefined,
    issueFixChallenge: outcome === 'READY_FOR_CONFIRMATION' && Boolean(state.repairSequence?.eligible),
  };
}

function withRepairSteps(state: ToolState): KnowledgeDto {
  return {
    unverified: false,
    errorCodes: [],
    repairSteps: state.repairSequence?.eligible ? state.repairSequence.steps : [],
  };
}

const FORCED_TOOL_FALLBACK_REPLY =
  'I could not complete a verified diagnosis for this appliance. No approved, model-specific repair instructions are available, so I cannot provide repair steps. Please contact a qualified technician for further assessment.';

// Deterministic backend-owned final turn for the exact case where the provider
// rejected a forced submit_diagnosis_outcome call because the model answered in
// plain text. The model's text and failed_generation are never parsed or used.
// decideOutcome() still applies the normal hazard, verdict and context policy.
function forcedToolFallback(
  input: OrchestratorInput,
  state: ToolState,
  round: number,
  toolCalls: number,
): OrchestratorResult {
  logToolFailure('Forced final tool call was not emitted by the model', {
    round,
    totalToolCalls: toolCalls,
  });
  const result = decideOutcome(
    input,
    {
      reply: FORCED_TOOL_FALLBACK_REPLY,
      outcome: 'UNRESOLVED',
      followUpQuestion: null,
      suspectedComponents: null,
      diagnosticFacts: null,
      modelNumber: null,
      component: null,
      partNumber: null,
    },
    state,
  );
  // Belt-and-braces: the fallback must not expose repair steps, citations, a
  // fix challenge or an error-code link, regardless of earlier tool state.
  return {
    ...result,
    knowledge: { ...result.knowledge, repairSteps: [] },
    citations: [],
    errorCodeId: undefined,
    issueFixChallenge: false,
  };
}

async function executeTool(
  name: string,
  args: unknown,
  input: OrchestratorInput,
  state: ToolState,
): Promise<unknown> {
  if (!diagnosisToolNames.has(name)) {
    throw new HttpError(502, 'AI_INVALID_RESPONSE', 'AI provider requested an unknown tool');
  }

  if (name === 'search_error_codes') {
    const parsed = searchErrorCodeArgsSchema.parse(args);
    const codes = parsed.codes?.length ? parsed.codes : extractCandidateCodes(allConversationText(input));
    const knowledge = await searchErrorCodes(
      {
        category: input.appliance.category,
        brand: input.appliance.brand,
        modelScope: input.context.modelScope,
      },
      codes,
      input.includeUnreviewed,
    );
    return knowledge;
  }

  if (name === 'get_repair_steps') {
    const parsed = getRepairStepsArgsSchema.parse(args);
    const resolved = await resolveErrorCodeId(input, parsed.errorCode);
    let sequence: ApprovedRepairSequence;
    if (resolved.status === 'ineligible') {
      // An unknown, untrusted or ambiguous code is a normal ineligible result,
      // never a provider rejection and never a model-supplied database ID.
      sequence = { eligible: false, reason: resolved.reason, steps: [] };
    } else {
      sequence = await getApprovedRepairSequence(
        resolved.id,
        {
          category: input.appliance.category,
          brand: input.appliance.brand,
          modelScope: input.context.modelScope,
        } satisfies KnowledgeApplianceContext,
        input.includeUnreviewed,
      );
    }
    state.repairSequence = sequence;
    return {
      eligible: sequence.eligible,
      reason: sequence.reason,
      stepCount: sequence.steps.length,
      steps: sequence.steps,
    };
  }

  if (name === 'find_replacement_parts') {
    const parsed = findReplacementPartsArgsSchema.parse(args);
    const modelNumber = resolveModelNumber(input, parsed.modelNumber);
    if (!modelNumber) {
      const parts: PartsDto = {
        note: 'Ask the user for the exact appliance model number before parts discovery.',
        candidates: [],
      };
      state.parts = parts;
      return parts;
    }
    // Parts discovery is optional. A provider failure must degrade to zero
    // candidates instead of failing an otherwise valid diagnosis turn.
    let parts: PartsDto;
    try {
      parts = await input.partsSearch({
        brand: input.appliance.brand,
        modelNumber,
        component: parsed.component,
        ...(parsed.partNumber ? { partNumber: parsed.partNumber } : {}),
      });
    } catch {
      parts = {
        note: 'Parts search is currently unavailable. No part listings could be verified.',
        candidates: [],
      };
    }
    state.parts = parts;
    return parts;
  }

  const parsed = submitDiagnosisOutcomeSchema.parse(args);
  state.final = parsed;
  return { accepted: true };
}

export async function runDiagnosisTurn(input: OrchestratorInput): Promise<OrchestratorResult> {
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = buildDiagnosisMessages(input);
  const state: ToolState = {};
  const seenToolCalls = new Set<string>();
  let toolCalls = 0;

  for (let round = 0; round < env.GROQ_MAX_TOOL_ROUNDS; round += 1) {
    // A lookup on round one must be followed by the structured outcome on
    // round two. Forcing the tool choice in the backend prevents the provider
    // from spending the whole loop on chained lookups and still caps work at
    // one lookup plus one final call per turn.
    const toolChoice: 'required' | { type: 'function'; function: { name: string } } =
      round === 0
        ? 'required'
        : { type: 'function', function: { name: 'submit_diagnosis_outcome' } };

    let completion;
    try {
      completion = await createChatCompletion(
        {
          model: env.GROQ_MODEL,
          messages,
          tools: diagnosisTools,
          tool_choice: toolChoice,
          temperature: 0.2,
          max_completion_tokens: env.GROQ_MAX_COMPLETION_TOKENS,
          reasoning_effort: env.GROQ_REASONING_EFFORT,
        },
        // Diagnostics-only: labels provider rejections with the round and the
        // effective tool choice without altering the request or retry policy.
        { round, toolChoice },
      );
    } catch (error) {
      if (
        error instanceof ForcedToolNotCalledError &&
        typeof toolChoice === 'object' &&
        toolChoice.type === 'function' &&
        toolChoice.function.name === 'submit_diagnosis_outcome'
      ) {
        return forcedToolFallback(input, state, round, toolCalls);
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'AI_INVALID_RESPONSE', 'AI provider returned an invalid response');
    }

    const choice = completion.choices[0];
    const assistantMessage = choice?.message;
    const finishReason = choice?.finish_reason;
    const calls = assistantMessage?.tool_calls ?? [];

    if (!assistantMessage) {
      failTool('AI provider returned no message', { round, finishReason, calls, totalToolCalls: toolCalls });
    }

    if (calls.length === 0) {
      failTool('AI provider did not return a structured outcome', {
        round,
        finishReason,
        calls,
        totalToolCalls: toolCalls,
      });
    }
    if (calls.length > 1) {
      failTool('AI provider requested parallel tool calls', {
        round,
        finishReason,
        calls,
        totalToolCalls: toolCalls,
      });
    }

    const call = calls[0]!;
    toolCalls += 1;
    if (toolCalls > env.GROQ_MAX_TOOL_CALLS) {
      failTool('AI tool-call limit exceeded', { round, finishReason, calls, totalToolCalls: toolCalls });
    }

    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      failTool('AI provider returned invalid tool arguments', {
        round,
        finishReason,
        calls,
        totalToolCalls: toolCalls,
      });
    }

    const signature = `${call.function.name}:${JSON.stringify(args)}`;
    if (seenToolCalls.has(signature)) {
      failTool('AI provider repeated a tool call', { round, finishReason, calls, totalToolCalls: toolCalls });
    }
    seenToolCalls.add(signature);

    let result: unknown;
    try {
      result = await executeTool(call.function.name, args, input, state);
    } catch (error) {
      const issuePaths =
        error instanceof ZodError ? error.issues.map((issue) => issue.path.map(String)) : undefined;
      failTool(error instanceof HttpError ? error.message : 'AI tool arguments failed validation', {
        round,
        finishReason,
        calls,
        totalToolCalls: toolCalls,
        zodIssuePaths: issuePaths,
      });
    }

    messages.push(assistantMessage as Groq.Chat.Completions.ChatCompletionMessageParam);
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: truncate(JSON.stringify(result), 4000),
    });

    if (state.final) {
      return decideOutcome(input, state.final, state);
    }
  }

  failTool('AI tool-loop limit exceeded', {
    round: env.GROQ_MAX_TOOL_ROUNDS - 1,
    totalToolCalls: toolCalls,
  });
}
