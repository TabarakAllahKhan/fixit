import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import { logAiToolFailure } from '../../utils/aiDiagnostics.js';
import { ForcedToolNotCalledError } from '../../utils/aiErrors.js';
import { HttpError } from '../../utils/httpError.js';
import { containsExactToken } from '../../utils/textMatching.js';
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
  type SafetyDto,
  type SubmitDiagnosisOutcome,
  type TroubleshootingDto,
} from '../../validators/ai.validator.js';
import type { ResearchDto } from '../../validators/research.validator.js';
import {
  collectKnowledgeCitations,
  extractCandidateCodes,
  getApprovedRepairSequence,
  searchErrorCodes,
  type ApprovedRepairSequence,
  type KnowledgeApplianceContext,
} from '../knowledge.service.js';
import { hasManufacturerEvidence } from '../research.service.js';
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
import {
  assessUserSafetyState,
  buildSafetyResponse,
  containsUnplugInstruction,
  detectModelSafetyCategories,
  isAmbiguousFollowUp,
  isRestrictedComponent,
  mentionsMicrowave,
  mentionsRestrictedFamily,
  mergeSafetyCategories,
  reportsWetConditions,
  restrictedFollowUpFamiliesFromHistory,
  WET_ISOLATION_NOTE,
  type SafetyCategory,
} from './safety.js';
import { brandSource, otherBrandSource } from '../../utils/manufacturerDomains.js';
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
  // Bounded, backend-classified web research. Untrusted evidence only.
  research?: ResearchDto;
  // Prior USER turns for the restricted follow-up window (I3), oldest first.
  // Loaded separately from `history` so the window does not depend on
  // GEMINI_HISTORY_LIMIT. When absent, the USER messages in `history` are used.
  restrictionUserHistory?: readonly string[];
  // The session's persisted, user-entered error code (I4: trusted KB
  // error-code evidence must come from it or from the user's own messages).
  sessionErrorCode?: string | null;
};

// The restricted follow-up window for this turn (see safety.ts).
function restrictionWindowInput(input: OrchestratorInput) {
  return {
    history: input.history,
    restrictionUserHistory: input.restrictionUserHistory,
    restrictionWindow: env.SAFETY_FOLLOW_UP_USER_TURNS,
  };
}

// `categories` decide this turn; `sticky` is what may be persisted (never a
// hazard named only in a general question).
function assessTurnSafety(input: OrchestratorInput): { categories: SafetyCategory[]; sticky: SafetyCategory[] } {
  return assessUserSafetyState({ ...restrictionWindowInput(input), userContent: input.userContent, context: input.context });
}

// CR-C: the appliance is known to be a microwave when the user says so (in
// this turn, the bounded history or the restriction window) or a proposed
// component names one. Its internal parts are then restricted.
function isMicrowaveContext(input: OrchestratorInput, extra: ReadonlyArray<string | null | undefined> = []): boolean {
  return mentionsMicrowave([
    ...userTexts(input),
    ...(input.restrictionUserHistory ?? []),
    ...extra,
  ]);
}

export type OrchestratorResult = {
  reply: string;
  progress: DiagnosisProgressDto;
  knowledge: KnowledgeDto;
  parts?: PartsDto;
  troubleshooting?: TroubleshootingDto;
  safety?: SafetyDto;
  citations: CitationDto[];
  nextContext: DiagnosisContextDto;
  errorCodeId?: string;
  issueFixChallenge: boolean;
};

type ToolState = {
  final?: SubmitDiagnosisOutcome;
  parts?: PartsDto;
  partsComponent?: string;
  repairSequence?: ApprovedRepairSequence;
};

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

function userTexts(input: Pick<OrchestratorInput, 'userContent' | 'history'>): string[] {
  // Only the current and prior USER turns are reports of real conditions.
  // Assistant history and diagnosticFacts are advisory model hypotheses.
  return [
    input.userContent,
    ...input.history.filter((message) => message.role === 'USER').map((message) => message.content),
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

function dedupeCitations(citations: readonly CitationDto[]): CitationDto[] {
  const seen = new Set<string>();
  return citations
    .filter((citation) => {
      const key = `${citation.title}|${citation.url ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Hazard path: backend-written response only
// ---------------------------------------------------------------------------

// Immediate hazards return a backend-written, category-specific response. No
// Gemini troubleshooting text, repair steps, parts or fix challenge is mixed
// in. User-reported categories are persisted so later turns stay restricted.
// Suspected components and diagnostic facts from a blocked model draft are
// never persisted: the draft was unsafe, so its hypotheses are not trusted.
function hazardResult(
  input: OrchestratorInput,
  categories: readonly SafetyCategory[],
  stickyCategories: readonly SafetyCategory[],
): OrchestratorResult {
  const active = mergeSafetyCategories(input.context.safety?.activeCategories, stickyCategories);
  const knowledge: KnowledgeDto = { ...input.knowledge, repairSteps: [] };
  return {
    reply: buildSafetyResponse(categories),
    progress: defaultProgress('TECHNICIAN_REQUIRED'),
    knowledge,
    safety: { categories: mergeSafetyCategories(categories) },
    citations: dedupeCitations(collectKnowledgeCitations(knowledge)),
    nextContext: {
      ...input.context,
      trustedApplianceIdentity: toPersistedTrustedApplianceIdentity(input.identity),
      currentOutcome: 'TECHNICIAN_REQUIRED',
      ...(active.length ? { safety: { activeCategories: active } } : {}),
    },
    issueFixChallenge: false,
  };
}

// ---------------------------------------------------------------------------
// Troubleshooting, resolution and failure signals
// ---------------------------------------------------------------------------

const STEP_FAILURE_PATTERNS: readonly RegExp[] = [
  /\b(?:did(?:n'?t| not)\s+(?:work|help|fix|change|solve|do anything|make (?:a|any) difference|drain|spin|start|heat|cool|dry|turn on|power on|stop|clear|go away|reset|respond|run)|does(?:n'?t| not)\s+(?:work|help)|no (?:change|difference|luck|improvement|good|dice)|still\s+(?:not|doesn'?t|won'?t|isn'?t|can'?t|the same|happening|broken|leaking|showing|there|stuck|get|getting|gets|shows?|has|have|having|flashing|displaying|leaks?|beeping|tripping)|same (?:problem|issue|error|code|thing|result|noise)|not (?:fixed|working|resolved|solved)|nothing (?:changed|worked|happened|helped))\b/i,
  // "error is back", "the code came back", "it keeps happening"
  /\b(?:error|code|fault|problem|issue|leak|noise|smell|it)(?:\s+code)?\s+(?:is|'s|was|came|has come|keeps coming|comes)\s+back\b(?!\s+on\b)/i,
  /\b(?:came back|back again|reappeared|showed up again|shows up again|popped up again|keeps? (?:happening|showing|coming back|flashing|beeping|tripping|leaking))\b(?!\s+on\b)/i,
  // Short replies: "nope", "nah", "no.", "it didn't", "not really", "nothing".
  /^\s*(?:nope|nah)\b/i,
  /^\s*(?:no|nothing|not really)\s*[.!]*\s*$/i,
  /\b(?:it|that|this|they|those)\s+did(?:n'?t| not)\s*(?:[.!,;]|$)/i,
];

const RESOLUTION_PATTERN =
  /\b(?:(?:it'?s|it is|that'?s|that is|problem(?: is)?|issue(?: is)?)\s+(?:now\s+|all\s+)?(?:fixed|solved|resolved|working(?: again| now| fine| properly)?)|(?:works|working|drains|draining|cools|cooling|spins|spinning|heats|heating|runs|running|starts|starting)\s+(?:fine|properly|normally|again|now)|(?:fixed|solved|resolved) (?:it|the problem|the issue)|that (?:did it|worked|fixed it|solved it)|back to normal)\b/i;

const NEGATED_LEAD = /\b(?:not|no|never|isn'?t|wasn'?t|hasn'?t|haven'?t|didn'?t|doesn'?t|won'?t|can'?t)\b[^.!?]{0,20}$/i;

const PHYSICAL_DAMAGE_PATTERN =
  /\b(?:snapped|cracked|shattered|torn|ripped|bent|broke(?:n)? off|physically (?:broken|damaged)|visibly (?:broken|damaged))\b/i;

// Phone keyboards send curly apostrophes ("didn’t").
function straightQuotes(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'");
}

function reportsStepFailure(text: string): boolean {
  const normalized = straightQuotes(text);
  return STEP_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function reportsResolution(raw: string): boolean {
  const text = straightQuotes(raw);
  const match = RESOLUTION_PATTERN.exec(text);
  if (!match) return false;
  return !NEGATED_LEAD.test(text.slice(0, match.index));
}

function reportsPhysicalDamage(texts: readonly string[]): boolean {
  return texts.some((text) => {
    const match = PHYSICAL_DAMAGE_PATTERN.exec(text);
    return Boolean(match) && !NEGATED_LEAD.test(text.slice(0, match!.index));
  });
}

// A referral is not a troubleshooting step the user can verify.
const REFERRAL_ONLY =
  /^\s*(?:please\s+)?(?:contact|call|consult|hire|book|schedule|reach out to)\b[^.]*\b(?:technician|professional|engineer|service|manufacturer|support|repair (?:shop|centre|center))\b/i;

function normalizeStep(step: string): string {
  return step.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 300);
}

// Paraphrase detection for troubleshooting steps. Deliberately simple: steps
// are compared as sets of content words after light stemming and a small
// synonym map, so "Remove and rinse the filter" and "Take out the filter and
// give it a rinse" are the same step, while "Check the drain hose for kinks"
// and "Run the garbage disposal" are not. Generic verbs such as "check" or
// "make sure" carry no meaning on their own and are ignored.
const STEP_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'your', 'you', 'it', 'its', 'that', 'this', 'then', 'is',
  'are', 'be', 'if', 'any', 'on', 'in', 'at', 'with', 'by', 'from', 'into', 'onto', 'out', 'up', 'down', 'off',
  'over', 'again', 'once', 'all', 'make', 'sure', 'check', 'inspect', 'verify', 'ensure', 'look', 'try', 'see',
  'whether', 'there', 'no', 'not', 'so', 'as', 'can', 'could', 'should', 'will', 'would', 'may', 'might',
  'please', 'also', 'still', 'do', 'does', 'did', 'just', 'some', 'more', 'until', 'before', 'after', 'while',
  'about', 'them', 'they', 'their', 'give', 'get', 'carefully', 'gently', 'properly', 'fully', 'any', 'way',
]);

const STEP_SYNONYMS: Readonly<Record<string, string>> = {
  rins: 'clean', wash: 'clean', flush: 'clean', wip: 'clean', clear: 'clean', unclog: 'clean', unblock: 'clean',
  restart: 'reset', reboot: 'reset', kinked: 'kink', bent: 'kink', twist: 'kink', block: 'clog', blockag: 'clog',
  obstruct: 'clog', take: 'remov', tak: 'remov', detach: 'remov', pull: 'remov', fridg: 'refrigerator',
};

function stepStem(token: string): string {
  let stem = token;
  if (stem.length > 5 && stem.endsWith('ing')) stem = stem.slice(0, -3);
  else if (stem.length > 4 && stem.endsWith('ed')) stem = stem.slice(0, -2);
  else if (stem.length > 3 && stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1);
  if (stem.length > 4 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1);
  if (stem.length > 4 && stem.endsWith('e')) stem = stem.slice(0, -1);
  return STEP_SYNONYMS[token] ?? STEP_SYNONYMS[stem] ?? stem;
}

function stepTokens(step: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of normalizeStep(step).split(' ')) {
    if (raw.length < 3 || STEP_STOP_WORDS.has(raw)) continue;
    tokens.add(stepStem(raw));
  }
  return tokens;
}

function sameStep(a: string, b: string): boolean {
  if (normalizeStep(a) === normalizeStep(b)) return true;
  const left = stepTokens(a);
  const right = stepTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const smaller = Math.min(left.size, right.size);
  const union = left.size + right.size - shared;
  return (shared >= 3 && shared / smaller >= 0.75) || (shared >= 2 && shared / union >= 0.6);
}

function isRepeatOf(step: string, previous: readonly string[]): boolean {
  return previous.some((earlier) => sameStep(step, earlier));
}

// Something the user can actually do and report back on: a short sentence
// with a few words that is more than a referral. Duplicates are removed.
function meaningfulSteps(steps: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of steps) {
    const step = raw.trim();
    const key = normalizeStep(step);
    if (step.length < 12 || key.split(' ').length < 3 || REFERRAL_ONLY.test(step) || isRepeatOf(step, result)) continue;
    result.push(step);
    if (result.length >= 8) break;
  }
  return result;
}

function mergeProvidedSteps(previous: readonly string[], shown: readonly string[]): string[] {
  const merged: string[] = [...previous.map((step) => truncate(step.trim(), 300)).filter(Boolean)];
  for (const step of shown) {
    const trimmed = step.trim();
    if (!trimmed || isRepeatOf(trimmed, merged)) continue;
    merged.push(truncate(trimmed, 300));
  }
  return merged.slice(-20);
}

// ---------------------------------------------------------------------------
// Evidence guards on model wording
// ---------------------------------------------------------------------------

// Abbreviations such as "part no. 54321" do not end a sentence, so the
// number stays with its label for the part-number guard.
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])(?<!\b(?:[Nn]o|[Nn]um|[Aa]pprox|e\.g|i\.e|[Vv]s)\.)\s+/)
    .filter((sentence) => sentence.trim().length > 0);
}

type Filtered = { text: string; removed: boolean };

// Removes every sentence the predicate rejects. Used for the reply, the
// follow-up question and each troubleshooting step alike.
function dropSentences(text: string, reject: (sentence: string) => boolean): Filtered {
  let removed = false;
  const kept = splitSentences(text).filter((sentence) => {
    const drop = reject(sentence);
    if (drop) removed = true;
    return !drop;
  });
  return { text: kept.join(' ').trim(), removed };
}

// ---- Manufacturer and documentation claims --------------------------------
//
// A claim names an authority (the manufacturer, a brand, "official", or a
// manual / documentation / spec sheet) and attributes content to it, either
// directly ("Samsung recommends", "your owner's manual says", "the service
// manual for your model specifies"), by reference ("according to", "as
// documented in the Samsung manual") or as official guidance ("Samsung's
// official guidance is"). Hedged or referral wording is not a claim: "your
// manual may list", "check what your manual says", "ask Samsung to confirm".

// Nouns that always mean documentation, and generic nouns ("guide",
// "instructions") that only do with a documentation qualifier, so "the
// instructions above" is not read as a manual.
const DOC_CORE = String.raw`(?:manuals?|handbooks?|documentation|literature|spec(?:ification)?s?(?:\s+sheets?)?|data\s*sheets?|tech(?:nical)?\s+sheets?|wiring\s+diagrams?|knowledge\s+base)`;
const DOC = String.raw`(?:(?:(?:owner'?s?|owners'|user'?s?|service|repair|installation|instruction|technical|operating|use\s+(?:and|&)\s+care)\s+(?:guides?|instructions|${DOC_CORE}))|${DOC_CORE})`;
const ENTITY_DOC = String.raw`(?:${DOC}|guides?|instructions|guidelines|websites?|support\s+(?:pages?|sites?|articles?|documents?))`;
// Words that make the sentence hedged, an infinitive ("ask Samsung to
// confirm") or about a physical label rather than documentation.
const GAP_STOP = String.raw`(?:may|might|should|could|would|can|will|usually|typically|often|probably|likely|generally|normally|to|label|labels|sticker|stickers|plate|tag|badge|logo|name)`;
const ATTRIBUTION_VERB = String.raw`(?:confirm|state|say|said|show|specif|indicate|recommend|advis|suggest|list|note|mention|explain|require|instruct|warn|stipulate|tell|direct|describ|outline|call)\w*`;
const REFERENCE_LEAD = String.raw`(?:according\s+to|per|as\s+per|based\s+on|in\s+line\s+with|as\s+(?:stated|documented|specified|described|confirmed|recommended|listed|noted|outlined|shown)\s+(?:in|by)|(?:documented|specified|described|outlined|listed|stated|confirmed|verified|recommended|approved|noted|shown|mentioned|covered)\s+(?:in|by))`;
const MODEL_SPECIFIC = /\b(?:your|this|that|the\s+exact)\s+(?:exact\s+)?model\b|\bmodel'?s\b|\byour\s+(?:own\s+)?(?:owner'?s?\s+|user'?s?\s+|service\s+)?(?:manual|guide|documentation|handbook)\b/i;
const CONDITIONAL_LEAD = /\b(?:if|whether|unless|in case)\b|\b(?:check|consult|see|look\s+up|read|find\s+out)\s+(?:what|whether|if|how)\b/gi;
// A conditional clause ends at a comma, semicolon, colon or "then": "If the
// error persists, LG recommends ..." attributes the advice outside it.
const CONDITIONAL_CLAUSE_END = /[,;:]|\bthen\b/i;

function claimPatterns(brand: string): RegExp[] {
  const brands = [brandSource(brand), otherBrandSource(brand)].filter(Boolean).join('|');
  const entity = String.raw`(?:${brands}|(?:the\s+)?manufacturer|(?:the\s+)?maker|official)`;
  const source = String.raw`(?:${entity}(?:'s|s')?(?:\s+(?:own|official|published|online))*(?:\s+${ENTITY_DOC})?|(?:(?:your|the|this|that|its|their)\s+)(?:(?:model|appliance|unit|machine)(?:'s)?\s+)?${DOC})`;
  const gap = String.raw`(?:\s+(?!${GAP_STOP}\b)[\w'-]+){0,6}?`;
  return [
    new RegExp(String.raw`(?:^|[^A-Za-z0-9])${source}${gap}\s+${ATTRIBUTION_VERB}\b`, 'i'),
    new RegExp(String.raw`\b${REFERENCE_LEAD}\s+(?:[\w'-]+\s+){0,3}?${source}(?=$|[^A-Za-z0-9])`, 'i'),
    /\bofficial(?:ly)?\s+(?:[\w-]+\s+){0,2}?(?:guidance|recommendations?|advice|position|procedures?|instructions|documentation|information|answer|confirmed|documented|verified|recommended|approved|states?|says)\b/i,
    /\bmanufacturer[- ](?:confirmed|approved|recommended|specified|verified|documented)\b/i,
  ];
}

// "If your manual says ...", "check what your manual says": a referral, but
// only while the attribution is still inside the conditional clause. In "If
// the error persists, LG recommends replacing the pump" the condition ends at
// the comma and the attribution is a claim.
//
// I5: without a comma, the attribution must also be the conditional clause's
// own subject: only determiners and documentation qualifiers may sit between
// the conditional lead and the source ("if your manual says", "check what
// the service manual says"). "If the error persists Samsung recommends ..."
// has a complete condition ("the error persists") before the source, so the
// attribution is a claim.
const CONDITIONAL_SUBJECT_WORDS = new Set([
  'the', 'your', 'my', 'this', 'that', 'its', 'their', 'a', 'an', 'own', 'official', 'owner', "owner's", 'owners',
  'user', "user's", 'users', 'service', 'appliance', "appliance's", 'model', "model's", 'unit', 'machine',
]);

function insideConditional(prefix: string): boolean {
  let lead: RegExpExecArray | undefined;
  for (const match of prefix.matchAll(CONDITIONAL_LEAD)) lead = match;
  if (!lead) return false;
  const between = prefix.slice((lead.index ?? 0) + lead[0].length);
  if (CONDITIONAL_CLAUSE_END.test(between)) return false;
  return between
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z']+|[^a-z']+$/gi, '').toLowerCase())
    .filter(Boolean)
    .every((word) => CONDITIONAL_SUBJECT_WORDS.has(word));
}

function isManufacturerClaim(sentence: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    const match = pattern.exec(sentence);
    if (!match) return false;
    // A leading delimiter captured by the pattern (", LG recommends") stays
    // in the prefix so the clause-end check still sees it.
    const leading = /^[^A-Za-z0-9]/.test(match[0]) ? 1 : 0;
    return !insideConditional(sentence.slice(0, match.index + leading));
  });
}

type ClaimEvidence = { general: boolean; exact: boolean };

// The approved manufacturer-claim guard. A sentence claiming manufacturer or
// documentation support survives only when valid manufacturer evidence
// exists: an approved knowledge record, or a brand-official research source
// (and an exact-model MANUFACTURER_CONFIRMED source for model-specific
// claims). A claim attributed to a different brand is never supported.
function unsupportedClaim(
  input: OrchestratorInput,
  evidence: ClaimEvidence,
): (sentence: string) => boolean {
  const patterns = claimPatterns(input.identity.brand);
  const otherBrand = new RegExp(String.raw`(?:^|[^A-Za-z0-9])${otherBrandSource(input.identity.brand)}(?=$|[^A-Za-z0-9])`, 'i');
  const model = input.identity.modelNumber;
  return (sentence) => {
    const text = straightQuotes(sentence);
    if (!isManufacturerClaim(text, patterns)) return false;
    if (otherBrand.test(text)) return true;
    const modelSpecific = MODEL_SPECIFIC.test(text) || Boolean(model && containsExactToken(text, model));
    return !(modelSpecific ? evidence.exact : evidence.general);
  };
}

// ---- Part numbers ----------------------------------------------------------
//
// Part numbers are shown only when they come from a trusted source: a backend
// parts result, an approved knowledge record, the trusted model itself, or
// the user's own messages. Any other part-number-like identifier in any
// user-visible field is removed, not only the declared final.partNumber.

// Case-insensitive: "wpw10348269" is as much a part number as "WPW10348269".
const PART_NUMBER_TOKEN = /(?<![A-Za-z0-9-])[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){5,24}(?![A-Za-z0-9-])/g;
// Short all-digit identifiers count only when labelled as a part number:
// "part 279838", "Part #279838", "part no. 279838", "number 12345", "#12345",
// and (I6) "Part: 279838", "Part number: 279838", "Part number is 279838",
// "P/N 279838", "PN 279838".
const LABELLED_NUMBER =
  /(?:\b(?:part|item|number|no\.?|p\/n|pn)\s*(?:(?:no\.?|number|num\.?)\s*)?(?:[:=]\s*|(?:is|was)\s+)?#?\s*|#\s*)(\d{5,6})(?![\d-])/gi;
const MEASUREMENT = /^\d+(?:RPM|W|KW|KWH|V|VAC|HZ|MM|CM|M|KG|G|LB|LBS|BTU|BTUH|PSI|L|ML|C|F|MIN|S|H|MAH|GPM|CFM)$/;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}-\d{4}$/;

function compactIdentifier(value: string): string {
  return value.toUpperCase().replace(/[\s._-]+/g, '');
}

function partNumberCandidates(text: string): string[] {
  const found: string[] = [];
  const normalized = straightQuotes(text);
  for (const match of normalized.matchAll(PART_NUMBER_TOKEN)) {
    const token = match[0];
    const upper = token.toUpperCase();
    const digits = token.replace(/\D/g, '').length;
    const letters = /[A-Z]/i.test(token);
    if (digits < 4 || (!letters && digits < 7) || MEASUREMENT.test(upper) || DATE_LIKE.test(token)) continue;
    found.push(token);
  }
  for (const match of normalized.matchAll(LABELLED_NUMBER)) found.push(match[1]!);
  return found;
}

function trustedPartIdentifiers(input: OrchestratorInput, parts: PartsDto | undefined): Set<string> {
  const trusted = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value?.trim()) trusted.add(compactIdentifier(value));
  };
  add(input.identity.modelNumber);
  for (const candidate of parts?.candidates ?? []) add(candidate.partNumber);
  const knowledgeText = [
    ...input.knowledge.errorCodes.flatMap((code) => [code.code, code.meaning]),
    ...input.knowledge.repairSteps.map((step) => step.instruction),
  ];
  for (const text of [...userTexts(input), ...knowledgeText]) {
    for (const token of partNumberCandidates(text)) add(token);
    // Lower-case user spellings of a part number still count as the user's.
    for (const token of partNumberCandidates(text.toUpperCase())) add(token);
  }
  return trusted;
}

function unverifiedPartNumber(
  trusted: ReadonlySet<string>,
  declared: string | null | undefined,
): (sentence: string) => boolean {
  const declaredKey = declared?.trim() ? compactIdentifier(declared) : null;
  const declaredUnverified = declaredKey !== null && !trusted.has(declaredKey);
  return (sentence) => {
    if (declaredUnverified && containsExactToken(sentence, declared!)) return true;
    return partNumberCandidates(sentence).some((token) => !trusted.has(compactIdentifier(token)));
  };
}

// The component name is persisted in lastPartsQuery; an unverified part
// number inside it ("drain pump WPW10348269") is removed first.
function stripUnverifiedPartNumbers(text: string, trusted: ReadonlySet<string>): string {
  let result = text;
  for (const token of partNumberCandidates(text)) {
    if (trusted.has(compactIdentifier(token))) continue;
    result = result.replace(token, ' ');
  }
  return result.replace(/\s*#\s*(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() || 'component';
}

// ---- Plug handling under wet conditions -----------------------------------

const USER_ASKS_ABOUT_POWER =
  /\b(?:unplug\w*|plug|socket|outlet|power\s+(?:cord|lead|point)|(?:switch|turn)\s+(?:it\s+|the\s+power\s+)?off)\b/i;

// ---- Component-specific part evidence --------------------------------------
//
// A replacement is justified only by evidence about the named component: a
// research page about a drain filter does not justify a new drain pump.

const COMPONENT_FILLER = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'assembly', 'part', 'parts', 'unit', 'kit', 'replacement', 'new',
  'faulty', 'failed', 'broken', 'defective', 'complete', 'genuine', 'oem', 'module',
]);

function componentStems(text: string): string[] {
  return normalizeStep(text)
    .split(' ')
    .filter((word) => word.length >= 3 && !COMPONENT_FILLER.has(word))
    .map(stepStem);
}

// Words that may sit directly before a component name without changing which
// component it is: "the pump motor", "replace the main control board".
const NEUTRAL_QUALIFIER = new Set([
  'the', 'a', 'an', 'your', 'my', 'its', 'this', 'that', 'their', 'our', 'of', 'for', 'on', 'in', 'at', 'to',
  'and', 'or', 'if', 'whether', 'is', 'check', 'test', 'inspect', 'clean', 'replace', 'remove', 'examine',
  'new', 'faulty', 'failed', 'broken', 'defective', 'bad', 'main', 'original', 'genuine', 'oem', 'washer',
  'dishwasher', 'dryer', 'fridge', 'refrigerator', 'freezer', 'oven', 'appliance', 'machine', 'unit',
]);

// Fourth review: evidence must be about the named component. Every word of
// the component must appear in the evidence. When every word of the name is
// generic ("pump motor", "control board"), the words must also appear
// together and not be qualified by a more specific word: "circulation pump
// motor" is evidence about the circulation pump motor, not about a "pump
// motor" (which could equally be the drain pump motor).
function mentionsComponent(text: string | undefined, component: string): boolean {
  const wanted = componentStems(component);
  if (!text || wanted.length === 0) return false;
  const present = new Set(componentStems(text));
  if (!wanted.every((stem) => present.has(stem))) return false;
  if (wanted.some((stem) => !GENERIC_COMPONENT_STEMS.has(stem))) return true;
  const tokens = normalizeStep(text).split(' ').filter(Boolean);
  const stems = tokens.map((token) => (token.length >= 3 && !COMPONENT_FILLER.has(token) ? stepStem(token) : null));
  for (let start = 0; start < tokens.length; start += 1) {
    // The component's words, contiguous (fillers such as "assembly" between
    // them are skipped).
    const found = new Set<string>();
    let end = start;
    while (end < tokens.length && found.size < wanted.length) {
      const stem = stems[end];
      if (stem === null || stem === undefined) {
        if (found.size === 0) break;
        end += 1;
        continue;
      }
      if (!wanted.includes(stem)) break;
      found.add(stem);
      end += 1;
    }
    if (found.size < wanted.length) continue;
    const before = tokens[start - 1];
    if (before === undefined || NEUTRAL_QUALIFIER.has(before)) return true;
  }
  return false;
}

// I4: generic part words. A model-chosen name made only of one of these
// ("pump", "motor", "board") could match evidence about any pump, motor or
// board, so it never justifies a replacement on its own. "Drain pump",
// "control board" and "heating element" are specific.
const GENERIC_COMPONENT_STEMS = new Set(
  [
    'pump', 'motor', 'board', 'valve', 'switch', 'sensor', 'hose', 'fan', 'element', 'heater', 'seal', 'control',
    'relay', 'thermostat', 'light', 'lamp', 'door', 'button', 'wire', 'cable', 'panel', 'filter', 'gasket',
    'coil', 'timer', 'solenoid', 'actuator', 'bearing', 'belt', 'fuse', 'component', 'device', 'electronics',
  ].map(stepStem),
);

function isSpecificComponent(component: string): boolean {
  const stems = componentStems(component);
  return stems.length >= 2 || (stems.length === 1 && !GENERIC_COMPONENT_STEMS.has(stems[0]!));
}

// I4: error codes the user actually reported: the session's persisted,
// user-entered code, or a code in the user's own messages. Codes that only
// appear in assistant text or model-written diagnostic facts are not trusted.
function isUserReportedCode(input: OrchestratorInput, code: string): boolean {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return false;
  if (input.sessionErrorCode && input.sessionErrorCode.trim().toUpperCase() === normalized) return true;
  return userTexts(input).some((text) => containsExactToken(text, normalized));
}

const MANUFACTURER_CLAIM_NOTE =
  'Note: this guidance has not been confirmed by manufacturer documentation for your appliance.';
const PART_NUMBER_NOTE =
  'A specific part number could not be verified from a trusted source; confirm the part number for your exact model before buying.';
const COMPATIBILITY_NOTE =
  'Compatibility with your exact model has not been verified. Confirm the part with the manufacturer or a qualified technician before buying.';
const PART_NOT_JUSTIFIED_NOTE =
  'Before recommending a replacement part, a few safe checks are needed to confirm the cause.';
const DEFAULT_FOLLOW_UP =
  'Can you describe exactly what the appliance does when the problem happens, and what you have already tried?';
const FAILURE_FOLLOW_UP =
  'What exactly happened when you tried that, and has anything changed at all?';
const EMPTY_REPLY_FALLBACK =
  'I could not confirm that information from a trusted source for your appliance.';

function researchCitations(research: ResearchDto | undefined): CitationDto[] {
  if (!research) return [];
  return research.results
    .filter((result) => !result.contradicted)
    .slice(0, 5)
    .map((result) => ({
      title: truncate(result.title, 200),
      url: result.url,
      sourceKind: result.trust === 'MANUFACTURER' ? 'MANUFACTURER_PAGE' : 'SEARCH_RESULT',
      confidence: result.confidence,
    }));
}

// Evidence for a replacement must be about the named component (I3):
//  1. Parts candidates establish compatibility only. They never justify a
//     replacement, however they are classified.
//  2. "Safe checks were tried and failed" counts only when a step of the
//     MOST RECENT troubleshooting round (context.lastTroubleshootingRound)
//     mentioned this same component. Older accumulated steps do not count.
//  3. Research about the component counts only after at least one
//     troubleshooting round. Two exceptions need no round: the user reports
//     physical damage to the component, or a trusted knowledge-base error
//     code's meaning names it AND that code was reported by the user (the
//     session's persisted code or the user's own messages), never a code
//     taken from assistant text or model-written facts.
//  4. A repeat NEEDS_PART counts only for the same component.
// The component itself must be specific: a generic name such as "pump" can
// never be justified, because it would match unrelated evidence.
// Anything else returns NEEDS_CLARIFICATION.
function isPartJustified(
  input: OrchestratorInput,
  component: string,
  signals: { previousSteps: readonly string[]; userReportsFailure: boolean },
): boolean {
  if (!isSpecificComponent(component)) return false;
  const troubleshootingRound = signals.previousSteps.length > 0;
  const researchEvidence =
    troubleshootingRound &&
    (input.research?.results ?? []).some(
      (result) =>
        !result.contradicted &&
        (result.confidence === 'MANUFACTURER_CONFIRMED' || result.confidence === 'THIRD_PARTY_SUPPORTED') &&
        mentionsComponent(`${result.title} ${result.snippet ?? ''}`, component),
    );
  const knowledgeEvidence = input.knowledge.errorCodes.some(
    (code) => code.trusted && isUserReportedCode(input, code.code) && mentionsComponent(code.meaning, component),
  );
  const latestRound = input.context.lastTroubleshootingRound ?? [];
  const failedChecksOnComponent =
    signals.userReportsFailure && latestRound.some((step) => mentionsComponent(step, component));
  const previousComponent = input.context.lastPartsQuery?.component;
  const previouslyJustified =
    input.context.currentOutcome === 'NEEDS_PART' && Boolean(previousComponent && mentionsComponent(previousComponent, component));
  const damageReported = userTexts(input).some(
    (text) => reportsPhysicalDamage([text]) && mentionsComponent(text, component),
  );
  return researchEvidence || knowledgeEvidence || failedChecksOnComponent || previouslyJustified || damageReported;
}

// ---------------------------------------------------------------------------
// Outcome policy
// ---------------------------------------------------------------------------

const WET_KB_FOLLOW_UP =
  'Once the power is off at the circuit breaker and the water has been cleaned up, let me know and we can continue with the next checks.';

function decideOutcome(input: OrchestratorInput, final: SubmitDiagnosisOutcome, state: ToolState): OrchestratorResult {
  const kbSequence = state.repairSequence?.eligible ? state.repairSequence : undefined;
  // Restricted follow-up mode: derived from the bounded USER history window
  // only, never persisted (see safety.ts).
  const restrictedFamilies = restrictedFollowUpFamiliesFromHistory(restrictionWindowInput(input));
  const proposedParts = [
    final.component,
    state.partsComponent,
    ...(state.parts?.candidates ?? []).map((candidate) => candidate.partName),
  ].filter((value): value is string => Boolean(value?.trim()));
  const microwave = isMicrowaveContext(input, proposedParts);

  // Safety first: user-reported (and sticky) hazards, assertive model hazards
  // and unsafe instructions anywhere in model output or steps to be shown.
  // Every user-visible text field is checked, including provider-written
  // parts notes and candidate reasons (fourth review, CR-B).
  const userSafety = assessTurnSafety(input);
  const modelCategories = detectModelSafetyCategories(
    [
      final.reply,
      final.followUpQuestion ?? '',
      ...(final.diagnosticFacts ?? []),
      ...(kbSequence ? kbSequence.steps : input.knowledge.repairSteps).map((step) => step.instruction),
      ...(final.troubleshootingSteps ?? []),
      state.parts?.note ?? '',
      ...(state.parts?.candidates ?? []).map((candidate) => candidate.reason),
    ],
    { restrictedFamilies, microwave },
  );
  const categories = mergeSafetyCategories(userSafety.categories, modelCategories);
  if (categories.length > 0) return hazardResult(input, categories, userSafety.sticky);

  // CR-3 / CR-C: a restricted component (magnetron, capacitor, thermal fuse,
  // gas valve, compressor, any microwave internal part, ...) is never
  // recommended for user replacement through the parts channel, and neither
  // is the subject of a refused request still in the history window. Parts
  // candidates are not shown and the component is not persisted as a parts
  // query.
  if (
    proposedParts.some(
      (part) => isRestrictedComponent(part, { microwave }) || mentionsRestrictedFamily(part, restrictedFamilies),
    )
  ) {
    return hazardResult(input, ['UNSAFE_MODEL_INSTRUCTION'], userSafety.sticky);
  }

  const trustedModel = hasTrustedModel(input.identity) ? input.identity : null;
  const userReportsFailure = reportsStepFailure(input.userContent);
  const userReportsResolution = !userReportsFailure && reportsResolution(input.userContent);
  const previousSteps = input.context.providedTroubleshooting ?? [];
  const notes: string[] = [];

  // Every user-visible text field passes the same guards before any outcome
  // decision, so a removed step can never count as new troubleshooting:
  //  - wet conditions: no advice to pull or touch the plug;
  //  - unsupported manufacturer or documentation claims;
  //  - part numbers that no trusted source supplied.
  const wetConditions = reportsWetConditions(userTexts(input));
  // CR-5: the wet-floor safeguard covers knowledge-base steps too. A KB
  // sequence that says to unplug the appliance is withheld for this turn and
  // replaced with circuit-breaker guidance; KB records are not modified.
  const kbWithheldForWet = Boolean(
    wetConditions && kbSequence?.steps.some((step) => containsUnplugInstruction(step.instruction)),
  );
  const shownKbSequence = kbWithheldForWet ? undefined : kbSequence;
  const kbManufacturerEvidence =
    Boolean(kbSequence) ||
    input.knowledge.errorCodes.some(
      (code) => code.trusted && (code.source.sourceKind === 'MANUAL' || code.source.sourceKind === 'MANUFACTURER_PAGE'),
    );
  const claimCheck = unsupportedClaim(input, {
    general: kbManufacturerEvidence || hasManufacturerEvidence(input.research, { exactModel: false }),
    exact: kbManufacturerEvidence || hasManufacturerEvidence(input.research, { exactModel: true }),
  });
  const trustedParts = trustedPartIdentifiers(input, state.parts);
  const partCheck = unverifiedPartNumber(trustedParts, final.partNumber);
  const removed = { claim: false, part: false, plug: false };
  const sanitize = (text: string): string => {
    let current = text;
    if (wetConditions) {
      const plug = dropSentences(current, containsUnplugInstruction);
      removed.plug ||= plug.removed;
      current = plug.text;
    }
    const claim = dropSentences(current, claimCheck);
    removed.claim ||= claim.removed;
    const part = dropSentences(claim.text, partCheck);
    removed.part ||= part.removed;
    return part.text;
  };
  const guardedReply = sanitize(final.reply);
  const guardedFollowUp = final.followUpQuestion ? sanitize(final.followUpQuestion) || undefined : undefined;
  const guardedSteps = (final.troubleshootingSteps ?? []).map(sanitize).filter((step) => step.length > 0);
  const partNumberSupported = Boolean(final.partNumber && trustedParts.has(compactIdentifier(final.partNumber)));
  // The component name with any unverified part number removed; used for
  // evidence matching and for the persisted parts query.
  const rawPartComponent = final.component ?? state.partsComponent;
  const partComponent = rawPartComponent ? stripUnverifiedPartNumbers(rawPartComponent, trustedParts) : undefined;

  const proposedSteps = meaningfulSteps(guardedSteps);
  const offered = [...(shownKbSequence?.steps.map((step) => step.instruction) ?? []), ...proposedSteps];
  // Paraphrases of steps already shown are not new troubleshooting.
  const newlyOffered = offered.filter((step) => !isRepeatOf(step, previousSteps));

  let outcome = final.outcome;
  let followUpQuestion = guardedFollowUp;
  let conflictOverride = false;

  // In restricted follow-up mode, nothing about the refused subject may be
  // offered as a fix to confirm. C6 (fourth review): neither may anything
  // answering an ambiguous follow-up ("What next?"), which could be read as
  // the next step of the refused procedure.
  const restrictedSubjectShown =
    restrictedFamilies.length > 0 &&
    ([guardedReply, guardedFollowUp, ...proposedSteps].some((text) => mentionsRestrictedFamily(text, restrictedFamilies)) ||
      isAmbiguousFollowUp(input.userContent, restrictedFamilies));

  if (kbWithheldForWet && outcome !== 'TECHNICIAN_REQUIRED' && outcome !== 'UNRESOLVED') {
    // The withheld KB sequence was the reviewed procedure for this code; ask
    // the user to make the area safe before any further steps.
    outcome = 'NEEDS_CLARIFICATION';
    followUpQuestion = WET_KB_FOLLOW_UP;
  } else if (restrictedSubjectShown && (outcome === 'FIXED' || outcome === 'READY_FOR_CONFIRMATION' || outcome === 'NEEDS_PART')) {
    outcome = 'NEEDS_CLARIFICATION';
    followUpQuestion ??= DEFAULT_FOLLOW_UP;
  } else if (outcome === 'FIXED' || outcome === 'READY_FOR_CONFIRMATION') {
    // D1: a fix challenge needs something meaningful to verify. Absence of a
    // hazard alone is not enough. Genuinely new steps or a user-reported
    // resolution always qualify. Repeated steps qualify only when the user
    // has not reported a failure and no challenge is already outstanding, so
    // re-offering old steps never produces challenge after challenge. FIXED
    // itself is never accepted from the model.
    const repeatedOnly = offered.length > 0 && newlyOffered.length === 0;
    const meaningful =
      newlyOffered.length > 0 ||
      userReportsResolution ||
      (repeatedOnly && !userReportsFailure && input.context.currentOutcome !== 'READY_FOR_CONFIRMATION');
    if (meaningful) {
      outcome = 'READY_FOR_CONFIRMATION';
    } else {
      outcome = 'NEEDS_CLARIFICATION';
      followUpQuestion ??= userReportsFailure ? FAILURE_FOLLOW_UP : DEFAULT_FOLLOW_UP;
    }
  } else if (!trustedModel && (outcome === 'NEEDS_PART' || outcome === 'NEEDS_MODEL_NUMBER')) {
    conflictOverride = input.identity.modelConflict;
    outcome = conflictOverride ? 'NEEDS_CLARIFICATION' : 'NEEDS_MODEL_NUMBER';
  } else if (outcome === 'NEEDS_PART') {
    if (!partComponent || !isPartJustified(input, partComponent, { previousSteps, userReportsFailure })) {
      outcome = 'NEEDS_CLARIFICATION';
      notes.push(PART_NOT_JUSTIFIED_NOTE);
      followUpQuestion ??= DEFAULT_FOLLOW_UP;
    } else if (!(state.parts?.candidates ?? []).some((candidate) => candidate.compatibility === 'VERIFIED')) {
      notes.push(COMPATIBILITY_NOTE);
    }
  }

  const identityQuestion = input.identity.modelConflict
    ? 'I have conflicting model numbers. Which exact model is on the appliance sticker?'
    : 'What is the exact appliance model number from the sticker?';
  // Terminal verdicts close the diagnostic path: carrying a diagnostic question
  // into a stop-now or otherwise terminal result is contradictory.
  const terminalOutcome =
    outcome === 'TECHNICIAN_REQUIRED' || outcome === 'NEEDS_PART' || outcome === 'UNRESOLVED';
  followUpQuestion = terminalOutcome
    ? undefined
    : conflictOverride
      ? identityQuestion
      : outcome === 'NEEDS_MODEL_NUMBER'
        ? followUpQuestion ?? identityQuestion
        : followUpQuestion;

  const safeKnowledge: KnowledgeDto = {
    ...input.knowledge,
    repairSteps: outcome === 'READY_FOR_CONFIRMATION' && shownKbSequence ? shownKbSequence.steps : [],
  };

  // After a reported failure, repeating already-shown steps adds nothing.
  const shownSteps = userReportsFailure
    ? proposedSteps.filter((step) => !isRepeatOf(step, previousSteps))
    : proposedSteps;
  const troubleshooting: TroubleshootingDto | undefined = shownSteps.length
    ? { steps: shownSteps, evidence: input.research?.confidence ?? 'INSUFFICIENT' }
    : undefined;

  if (removed.claim) notes.unshift(MANUFACTURER_CLAIM_NOTE);
  if (removed.part) notes.push(PART_NUMBER_NOTE);
  // Breaker guidance replaces removed plug advice (from the model or from a
  // withheld KB sequence), and also answers a user who asked about
  // unplugging while reporting a leak.
  if (
    wetConditions &&
    (removed.plug || kbWithheldForWet || USER_ASKS_ABOUT_POWER.test(straightQuotes(input.userContent)))
  ) {
    notes.push(WET_ISOLATION_NOTE);
  }
  const baseReply = guardedReply || EMPTY_REPLY_FALLBACK;
  const reply = truncate([baseReply, ...notes].join('\n\n'), 4000);

  const shownThisTurn = [
    ...safeKnowledge.repairSteps.map((step) => step.instruction),
    ...(troubleshooting?.steps ?? []),
  ];
  const providedTroubleshooting = mergeProvidedSteps(previousSteps, shownThisTurn);
  // I4: the latest round replaces the previous one only when this turn
  // showed steps; otherwise the earlier round is still the latest.
  const lastTroubleshootingRound = shownThisTurn.length
    ? shownThisTurn.map((step) => truncate(step.trim(), 300)).filter(Boolean).slice(0, 20)
    : undefined;
  // Persisted hypotheses pass the same part-number guard as visible text, and
  // in restricted follow-up mode nothing about the refused subject is kept.
  const persistable = (value: string): boolean =>
    !partCheck(value) && !mentionsRestrictedFamily(value, restrictedFamilies);
  const nextContext: DiagnosisContextDto = {
    ...input.context,
    suspectedComponents: mergeUnique(
      input.context.suspectedComponents,
      (final.suspectedComponents ?? []).filter(persistable),
      10,
    ),
    diagnosticFacts: mergeUnique(input.context.diagnosticFacts, (final.diagnosticFacts ?? []).filter(persistable), 20),
    trustedApplianceIdentity: toPersistedTrustedApplianceIdentity(input.identity),
    ...(input.context.errorCodeHypothesis || kbSequence
      ? { errorCodeHypothesis: input.context.errorCodeHypothesis ?? extractCandidateCodes(allConversationText(input))[0] }
      : {}),
    currentOutcome: outcome,
    ...(outcome === 'NEEDS_PART' && partComponent && trustedModel
      ? {
          lastPartsQuery: {
            component: truncate(partComponent, 200),
            // An unverified model-supplied part number is never persisted.
            ...(final.partNumber && partNumberSupported ? { partNumber: final.partNumber } : {}),
            modelNumberUsed: trustedModel.modelNumber,
          },
        }
      : {}),
    ...(providedTroubleshooting.length ? { providedTroubleshooting } : {}),
    ...(lastTroubleshootingRound?.length ? { lastTroubleshootingRound } : {}),
  };

  const citations = dedupeCitations([
    ...collectKnowledgeCitations(safeKnowledge),
    ...(state.parts?.candidates ?? []).map<CitationDto>((candidate) => ({
      title: candidate.sourceName,
      url: candidate.url,
      sourceKind: 'SEARCH_RESULT',
    })),
    ...researchCitations(input.research),
  ]);

  return {
    reply,
    progress: defaultProgress(outcome, followUpQuestion),
    knowledge: safeKnowledge,
    parts: state.parts,
    ...(troubleshooting ? { troubleshooting } : {}),
    citations,
    nextContext,
    errorCodeId: kbSequence?.errorCodeId,
    issueFixChallenge: outcome === 'READY_FOR_CONFIRMATION',
  };
}

const FORCED_TOOL_FALLBACK_REPLY =
  'I was not able to finish analysing that message. Please describe the problem again, including what the appliance does, any error code shown and anything you have already tried.';

// Deterministic backend-owned final turn for the exact case where the provider
// rejected a forced submit_diagnosis_outcome call because the model answered in
// plain text. The model's text and failed_generation are never parsed or used.
// It asks a neutral clarifying question rather than inventing a terminal
// verdict; decideOutcome() still applies hazard and context policy.
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
      outcome: 'NEEDS_CLARIFICATION',
      followUpQuestion: DEFAULT_FOLLOW_UP,
      suspectedComponents: null,
      diagnosticFacts: null,
      component: null,
      partNumber: null,
      troubleshootingSteps: null,
    },
    { ...state, repairSequence: undefined },
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
    state.partsComponent = parsed.component;
    // A restricted component (or the subject of a refused request still in
    // the history window) is never looked up for user purchase. No provider
    // call is made; decideOutcome() turns the turn into a professional-repair
    // response.
    if (
      isRestrictedComponent(parsed.component, { microwave: isMicrowaveContext(input, [parsed.component]) }) ||
      mentionsRestrictedFamily(parsed.component, restrictedFollowUpFamiliesFromHistory(restrictionWindowInput(input)))
    ) {
      const parts: PartsDto = {
        note: 'This component is not safe for a user to replace. A qualified technician must diagnose and replace it.',
        candidates: [],
      };
      state.parts = parts;
      return parts;
    }
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
  // An active hazard is answered by the backend alone: no provider call, no
  // research and no model-generated troubleshooting text.
  const userSafety = assessTurnSafety(input);
  if (userSafety.categories.length > 0) {
    return hazardResult(input, userSafety.categories, userSafety.sticky);
  }

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
