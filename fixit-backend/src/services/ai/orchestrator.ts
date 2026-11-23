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
import {
  collectKnowledgeCitations,
  extractCandidateCodes,
  getApprovedRepairSequence,
  searchErrorCodes,
  type ApprovedRepairSequence,
  type KnowledgeApplianceContext,
} from '../knowledge.service.js';
import {
  hasTrustedModel,
  toPersistedTrustedApplianceIdentity,
  type TrustedApplianceIdentity,
} from './appliance-identity.js';
import {
  createAiInteraction,
  type AiFunctionCall,
  type AiProviderResponse,
  type AiStep,
  type AiToolChoice,
} from './provider.js';
import { buildDiagnosisPrompt } from './prompt.js';
import { diagnosisToolNames, diagnosisTools } from './tool-definitions.js';

export type PartsSearchFn = (query: {
  brand: string;
  modelNumber: string;
  modelSource: 'APPLIANCE' | 'USER_MESSAGE';
  component: string;
  partNumber?: string;
}) => Promise<PartsDto>;

export type OrchestratorInput = {
  identity: TrustedApplianceIdentity;
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

// Backend-owned safety policy. Immediate danger and dangerous instructions are
// detected separately from diagnostic component names. A speculative mention of
// refrigerant, a sealed system, a capacitor or a compressor is never itself a
// hazard; only explicit danger reports, assertive evidence, or instructions to
// perform prohibited work trigger the stop-now override.
function caseInsensitive(source: string): RegExp {
  return new RegExp(source, 'gi');
}

const IMMEDIATE_HAZARD_PATTERNS: readonly RegExp[] = [
  caseInsensitive(String.raw`\b(?:smoke|smoking|fire|flames?)\b`),
  caseInsensitive(String.raw`\b(?:burning|charred|scorched|melted|melting|overheated|overheating)\b`),
  caseInsensitive(String.raw`\b(?:sparks?|sparking|arcing)\b`),
  caseInsensitive(String.raw`\b(?:electric(?:al)? shock|shocked|electrocuted|electrocution)\b`),
  caseInsensitive(String.raw`\b(?:gas leak|gas smell|gas odou?r|smell(?:s|ed|ing)? (?:of|like) gas|rotten[- ]egg smell)\b`),
  caseInsensitive(String.raw`\b(?:refrigerant leak|freon leak|coolant leak)\b`),
  caseInsensitive(String.raw`\blive (?:wire|wiring|terminal)s?\b`),
  caseInsensitive(String.raw`\bexposed\b[^.!?;,]{0,50}\b(?:mains|voltage|wires?|wiring|electrical|terminals?)\b`),
  caseInsensitive(String.raw`\b(?:mains|voltage|wires?|wiring)\b[^.!?;,]{0,50}\bexposed\b`),
];

// Assertive model-generated evidence of danger, as opposed to a hypothesis such
// as "possible refrigerant issue". Negated or hypothetical clauses are ignored.
const ESTABLISHED_HAZARD_PATTERN = caseInsensitive(
  String.raw`\b(?:there (?:is|are)|confirmed|evidence of|active|visible|found|detected|you have|i (?:can )?(?:see|smell|hear|notice))\b[^.!?;\n]{0,80}\b(?:smoke|fire|flames?|sparks?|arcing|burning smell|gas leak|gas odou?r|refrigerant leak|freon leak|exposed (?:live )?wires?)\b`,
);

const DANGEROUS_ACTION = String.raw`(?:check|test|measure|probe|inspect|open|remove|replace|charge|recharge|refill|top(?:ped|ping)?[\s-]?up|add|bypass|short|jump|bridge|disconnect|reconnect|adjust|repair|fix|install|handle|touch|unscrew|pry|service)`;
const DANGEROUS_SUBJECT = String.raw`(?:mains|voltage|live (?:wire|wiring|terminal)s?|electrical panel|fuse box|circuit breaker|capacitor|refrigerant|freon|coolant(?: line)?|sealed system|gas line|gas valve|propane line|compressor|door lock|safety(?: device| switch| interlock| thermostat)?|earth wire|ground wire)`;

// Repair instructions are validated on their own, not by broad keyword
// matching: technician-only component names in a diagnosis are allowed, but
// directing the user to work on them is not.
const UNSAFE_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  caseInsensitive(String.raw`\b${DANGEROUS_ACTION}\w*\b[^.!?;\n]{0,70}\b${DANGEROUS_SUBJECT}\b`),
  caseInsensitive(
    String.raw`\b${DANGEROUS_SUBJECT}\b[^.!?;\n]{0,70}\b(?:tested|checked|measured|replaced|recharged|refilled|charged|bypassed|opened|handled|serviced|disconnected|repaired)\b`,
  ),
  caseInsensitive(
    String.raw`\b(?:how (?:do|can|should) (?:i|we)|tell me how|can you (?:tell|show) me how|i want to|i (?:am going to|will|need to))\b[^.!?;\n]{0,80}\b${DANGEROUS_ACTION}\w*\b`,
  ),
];

const NEGATION_PATTERN =
  /\b(?:no|not|never|none|nothing|without|any|haven'?t|hasn'?t|hadn'?t|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|can'?t|couldn'?t|won'?t|wouldn'?t)\b/i;

// A clause mentioning a technician or a prohibition is not a DIY instruction.
const SAFE_CONTEXT_PATTERN =
  /\b(?:technician|qualified|professional|service (?:person|engineer|technician)|do not|don'?t|never|avoid|should not|shouldn'?t|must not|can'?t|cannot|won'?t|not safe|unsafe|leave (?:it|this) to|not (?:a|an) diy)\b/i;

function safetyClauses(text: string): string[] {
  return text
    .split(/[.!?;\n,]+|\bbut\b|\bhowever\b|\balthough\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function isNegatedBefore(clause: string, index: number): boolean {
  return NEGATION_PATTERN.test(clause.slice(Math.max(0, index - 90), index));
}

function matchesAny(patterns: readonly RegExp[], clause: string): boolean {
  for (const pattern of patterns) {
    for (const match of clause.matchAll(pattern)) {
      if (!isNegatedBefore(clause, match.index ?? 0)) return true;
    }
  }
  return false;
}

function containsImmediateHazard(text: string): boolean {
  return safetyClauses(text).some((clause) => matchesAny(IMMEDIATE_HAZARD_PATTERNS, clause));
}

function containsEstablishedHazard(text: string): boolean {
  return safetyClauses(text).some(
    (clause) => !SAFE_CONTEXT_PATTERN.test(clause) && matchesAny([ESTABLISHED_HAZARD_PATTERN], clause),
  );
}

function containsUnsafeInstruction(text: string): boolean {
  return safetyClauses(text).some(
    (clause) => !SAFE_CONTEXT_PATTERN.test(clause) && matchesAny(UNSAFE_INSTRUCTION_PATTERNS, clause),
  );
}

type SafetySignals = {
  immediateHazard: boolean;
  unsafeInstructions: boolean;
};

function classifySafety(
  input: OrchestratorInput,
  final: SubmitDiagnosisOutcome,
  knowledgeRepairSteps: KnowledgeDto['repairSteps'],
): SafetySignals {
  // Only the current and prior USER turns are reports of real conditions.
  // Assistant history and diagnosticFacts are advisory model hypotheses.
  const userText = [
    input.userContent,
    ...input.history.filter((message) => message.role === 'USER').map((message) => message.content),
  ].join(' ');
  const modelText = [final.reply, ...(final.diagnosticFacts ?? [])].join(' ');
  const stepText = knowledgeRepairSteps.map((step) => step.instruction).join(' ');

  return {
    immediateHazard: containsImmediateHazard(userText) || containsEstablishedHazard(modelText),
    unsafeInstructions:
      containsUnsafeInstruction(userText) ||
      containsUnsafeInstruction(modelText) ||
      containsUnsafeInstruction(stepText),
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

type ToolCallLike = Pick<AiFunctionCall, 'name'>;

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
    toolName: details.calls?.[0]?.name,
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
      category: input.identity.category,
      brand: input.identity.brand,
      modelScope: input.identity.modelScope ?? undefined,
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
  const safety = classifySafety(
    input,
    final,
    state.repairSequence?.eligible ? state.repairSequence.steps : input.knowledge.repairSteps,
  );
  const hazard = safety.immediateHazard || safety.unsafeInstructions;
  const trustedModel = hasTrustedModel(input.identity) ? input.identity : null;
  let outcome = final.outcome;
  let reply = final.reply;
  let conflictOverride = false;

  if (hazard) {
    outcome = 'TECHNICIAN_REQUIRED';
    reply =
      'This may involve electrical, gas, refrigerant or safety-critical work. Stop and contact a qualified technician rather than attempting a DIY repair.';
  } else if (outcome === 'FIXED') {
    outcome = state.repairSequence?.eligible ? 'READY_FOR_CONFIRMATION' : 'UNRESOLVED';
  } else if (outcome === 'READY_FOR_CONFIRMATION' && !state.repairSequence?.eligible) {
    outcome = 'UNRESOLVED';
  } else if (
    !trustedModel &&
    (outcome === 'NEEDS_PART' || outcome === 'NEEDS_MODEL_NUMBER')
  ) {
    conflictOverride = input.identity.modelConflict;
    outcome = conflictOverride ? 'NEEDS_CLARIFICATION' : 'NEEDS_MODEL_NUMBER';
  }

  const identityQuestion = input.identity.modelConflict
    ? 'I have conflicting model numbers. Which exact model is on the appliance sticker?'
    : 'What is the exact appliance model number from the sticker?';
  // Terminal verdicts close the diagnostic path: carrying a diagnostic question
  // into a stop-now or otherwise terminal result is contradictory.
  const terminalOutcome =
    outcome === 'TECHNICIAN_REQUIRED' || outcome === 'NEEDS_PART' || outcome === 'UNRESOLVED';
  const followUpQuestion =
    hazard || terminalOutcome
      ? undefined
      : conflictOverride
        ? identityQuestion
        : outcome === 'NEEDS_MODEL_NUMBER'
          ? final.followUpQuestion ?? identityQuestion
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
    trustedApplianceIdentity: toPersistedTrustedApplianceIdentity(input.identity),
    ...(input.context.errorCodeHypothesis || state.repairSequence?.eligible
      ? { errorCodeHypothesis: input.context.errorCodeHypothesis ?? extractCandidateCodes(allConversationText(input))[0] }
      : {}),
    currentOutcome: outcome,
    ...(outcome === 'NEEDS_PART' && final.component && trustedModel
      ? {
          lastPartsQuery: {
            component: final.component,
            ...(final.partNumber ? { partNumber: final.partNumber } : {}),
            modelNumberUsed: trustedModel.modelNumber,
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
    errorCodeId: !hazard && state.repairSequence?.eligible ? state.repairSequence.errorCodeId : undefined,
    issueFixChallenge:
      !hazard && outcome === 'READY_FOR_CONFIRMATION' && Boolean(state.repairSequence?.eligible),
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
        category: input.identity.category,
        brand: input.identity.brand,
        modelScope: input.identity.modelScope ?? undefined,
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
          category: input.identity.category,
          brand: input.identity.brand,
          modelScope: input.identity.modelScope ?? undefined,
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
    const trustedIdentity = input.identity;
    // No model argument exists in the tool schema. The provider is called only
    // with the resolved, provenance-bearing identity from this turn's fresh
    // appliance row (or a valid versioned USER_MESSAGE model).
    if (!hasTrustedModel(trustedIdentity)) {
      const parts: PartsDto = {
        note: input.identity.modelConflict
          ? 'Conflicting model numbers were reported. Confirm the exact model from the sticker before parts discovery.'
          : 'Ask the user for the exact appliance model number before parts discovery.',
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
        brand: trustedIdentity.brand,
        modelNumber: trustedIdentity.modelNumber,
        modelSource: trustedIdentity.modelSource,
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
  const prompt = buildDiagnosisPrompt(input);
  // Gemini is used statelessly: the orchestrator owns the bounded history and
  // replays provider steps verbatim, including function_call signatures.
  const steps: AiStep[] = [...prompt.steps];
  const state: ToolState = {};
  const seenToolCalls = new Set<string>();
  let toolCalls = 0;

  for (let round = 0; round < env.GEMINI_MAX_TOOL_ROUNDS; round += 1) {
    // A lookup on round one must be followed by the structured outcome on
    // round two. Forcing the tool choice in the backend prevents the provider
    // from spending the whole loop on chained lookups and still caps work at
    // one lookup plus one final call per turn.
    const toolChoice: AiToolChoice =
      round === 0
        ? { mode: 'any' }
        : { mode: 'specific', name: 'submit_diagnosis_outcome' };

    let response: AiProviderResponse;
    try {
      response = await createAiInteraction(
        {
          systemInstruction: prompt.systemInstruction,
          steps,
          tools: diagnosisTools,
          toolChoice,
        },
        // Diagnostics-only: labels provider rejections with the round and the
        // effective tool choice without altering the request or retry policy.
        { round, toolChoice },
      );
    } catch (error) {
      if (
        error instanceof ForcedToolNotCalledError &&
        toolChoice.mode === 'specific' &&
        toolChoice.name === 'submit_diagnosis_outcome'
      ) {
        return forcedToolFallback(input, state, round, toolCalls);
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'AI_INVALID_RESPONSE', 'AI provider returned an invalid response');
    }

    const calls = response.calls;
    const finishReason = response.finishReason;

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
    if (toolCalls > env.GEMINI_MAX_TOOL_CALLS) {
      failTool('AI tool-call limit exceeded', { round, finishReason, calls, totalToolCalls: toolCalls });
    }

    let args: unknown;
    if (typeof call.arguments === 'string') {
      try {
        args = JSON.parse(call.arguments);
      } catch {
        failTool('AI provider returned invalid tool arguments', {
          round,
          finishReason,
          calls,
          totalToolCalls: toolCalls,
        });
      }
    } else if (call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)) {
      args = call.arguments;
    } else {
      failTool('AI provider returned invalid tool arguments', {
        round,
        finishReason,
        calls,
        totalToolCalls: toolCalls,
      });
    }

    const signature = `${call.name}:${JSON.stringify(args)}`;
    if (seenToolCalls.has(signature)) {
      failTool('AI provider repeated a tool call', { round, finishReason, calls, totalToolCalls: toolCalls });
    }
    seenToolCalls.add(signature);

    let result: unknown;
    try {
      result = await executeTool(call.name, args, input, state);
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

    // Replay every model-generated step exactly as received (including thought
    // signatures), then append the backend result. Neither is trusted as
    // identity or as repair/parts authority.
    steps.push(...(response.steps.length ? response.steps : [call.step]));
    steps.push({
      type: 'function_result',
      name: call.name,
      call_id: call.id,
      result: [{ type: 'text', text: truncate(JSON.stringify(result), 4000) }],
    });

    if (state.final) {
      return decideOutcome(input, state.final, state);
    }
  }

  failTool('AI tool-loop limit exceeded', {
    round: env.GEMINI_MAX_TOOL_ROUNDS - 1,
    totalToolCalls: toolCalls,
  });
}
