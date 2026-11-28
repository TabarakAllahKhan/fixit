import { z } from 'zod';
import {
  persistedTrustedApplianceIdentitySchema,
  type PersistedTrustedApplianceIdentity,
} from '../services/ai/appliance-identity.js';
import { safetyCategorySchema } from '../services/ai/safety.js';
import {
  researchCacheSchema,
  researchConfidenceSchema,
  researchSummarySchema,
} from './research.validator.js';

// Every structured value produced by the AI or persisted in JSON columns is
// validated here. Tool calls and database JSON are never trusted implicitly.

export const diagnosisOutcomeSchema = z.enum([
  'NEEDS_CLARIFICATION',
  'NEEDS_MODEL_NUMBER',
  'READY_FOR_CONFIRMATION',
  'NEEDS_PART',
  'TECHNICIAN_REQUIRED',
  'UNRESOLVED',
  'FIXED',
]);

export const diagnosisVerdictSchema = z.enum([
  'FIXED',
  'NEEDS_PART',
  'TECHNICIAN_REQUIRED',
  'UNRESOLVED',
]);

export const modelScopeSchema = z.enum([
  'UNSPECIFIED',
  'TOP_LOAD',
  'FRONT_LOAD',
  'FRENCH_DOOR_BOTTOM_FREEZER',
]);

export const compatibilitySchema = z.enum(['VERIFIED', 'POSSIBLE_MATCH', 'UNKNOWN']);

const boundedText = z.string().trim().min(1).max(4000);
const shortText = z.string().trim().min(1).max(200);

export const citationSchema = z.object({
  title: shortText,
  url: z.url().nullable().optional(),
  sourceKind: z.enum(['MANUAL', 'MANUFACTURER_PAGE', 'OTHER', 'TEST_FIXTURE', 'SEARCH_RESULT']),
  // Present on web-research citations only: the backend-derived evidence tier,
  // so the client never presents weak evidence as confirmation.
  confidence: researchConfidenceSchema.optional(),
});

export const errorCodeKnowledgeSchema = z.object({
  id: z.uuid(),
  code: shortText,
  meaning: boundedText,
  modelScope: modelScopeSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(300).optional(),
  source: citationSchema,
});

export const repairStepKnowledgeSchema = z.object({
  position: z.number().int().min(1),
  instruction: boundedText,
  source: citationSchema,
});

export const knowledgeDtoSchema = z.object({
  unverified: z.boolean(),
  errorCodes: z.array(errorCodeKnowledgeSchema).max(10),
  repairSteps: z.array(repairStepKnowledgeSchema).max(20),
  note: z.string().trim().max(500).optional(),
});

export const partCandidateSchema = z.object({
  partName: shortText,
  sourceName: shortText,
  url: z.url(),
  compatibility: compatibilitySchema,
  reason: z.string().trim().min(1).max(300),
  partNumber: z.string().trim().min(1).max(64).optional(),
});

export const partsDtoSchema = z.object({
  note: z.string().trim().max(500),
  modelNumberUsed: z.string().trim().min(1).max(80).optional(),
  candidates: z.array(partCandidateSchema).max(10),
});

export const diagnosisProgressSchema = z.object({
  status: z.enum(['OPEN', 'COMPLETED']),
  verdict: diagnosisVerdictSchema.nullable(),
  outcome: diagnosisOutcomeSchema,
  followUpQuestion: z.string().trim().min(1).max(1000).optional(),
  fixChallenge: z.string().trim().min(1).max(200).optional(),
  fixChallengeExpiresAt: z.iso.datetime().optional(),
});

const troubleshootingStepText = z.string().trim().min(1).max(500);

// General, safety-checked troubleshooting proposed by the AI. It is never
// approved knowledge (that stays in knowledge.repairSteps); `evidence` is the
// research tier available for this turn, so the client can word it honestly.
export const troubleshootingDtoSchema = z.object({
  steps: z.array(troubleshootingStepText).min(1).max(8),
  evidence: researchConfidenceSchema,
});

export const safetyDtoSchema = z.object({
  categories: z.array(safetyCategorySchema).min(1).max(safetyCategorySchema.options.length),
});

export const assistantMessageMetadataSchema = z.object({
  kind: z.literal('ASSISTANT_TURN'),
  requestId: z.uuid(),
  progress: diagnosisProgressSchema,
  knowledge: knowledgeDtoSchema.optional(),
  parts: partsDtoSchema.optional(),
  troubleshooting: troubleshootingDtoSchema.optional(),
  research: researchSummarySchema.optional(),
  safety: safetyDtoSchema.optional(),
  citations: z.array(citationSchema).max(20),
});

// Optional context sections fail independently: a corrupt or outdated value
// is dropped on its own instead of invalidating the whole context, so trusted
// appliance identity is never reset by bad optional cache data.
function optionalSection<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

const activeSafetySchema = z.object({
  activeCategories: z.array(safetyCategorySchema).min(1).max(safetyCategorySchema.options.length),
});

type ActiveSafety = z.infer<typeof activeSafetySchema>;

// Persisted safety state is NOT optional cache data: dropping it would let a
// session with an active hazard return to ordinary troubleshooting. Valid
// state is kept as-is. Anything present but unreadable fails closed: every
// recognisable category is kept, and if any part could not be verified an
// UNVERIFIED_HAZARD restriction is added, so the session stays restricted.
// Only an absent (undefined or null) section means "no active hazard".
export function salvageSafetyContext(value: unknown): ActiveSafety | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = activeSafetySchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const raw =
    typeof value === 'object' && !Array.isArray(value)
      ? (value as { activeCategories?: unknown }).activeCategories
      : undefined;
  const entries = Array.isArray(raw) ? raw : [];
  const known = new Set(
    entries.flatMap((entry) => {
      const category = safetyCategorySchema.safeParse(entry);
      return category.success ? [category.data] : [];
    }),
  );
  known.add('UNVERIFIED_HAZARD');
  return {
    activeCategories: safetyCategorySchema.options.filter((category) => known.has(category)),
  };
}

const safetySection = z.unknown().transform(salvageSafetyContext).optional();

export const diagnosisContextSchema = z.object({
  // Only this versioned object carries persisted identity. Legacy unversioned
  // identity keys are intentionally absent and stripped by Zod's object parser.
  trustedApplianceIdentity: persistedTrustedApplianceIdentitySchema.nullable().optional(),
  suspectedComponents: z.array(shortText).max(10),
  diagnosticFacts: z.array(boundedText).max(20),
  errorCodeHypothesis: z.string().trim().min(1).max(64).optional(),
  currentOutcome: diagnosisOutcomeSchema.optional(),
  lastPartsQuery: z
    .object({
      component: shortText,
      partNumber: z.string().trim().min(1).max(64).optional(),
      modelNumberUsed: z.string().trim().min(1).max(80).optional(),
    })
    .optional(),
  // Bounded research cache, reused only while its key is unchanged.
  research: optionalSection(researchCacheSchema),
  // User-reported hazards stay active for the rest of the session. Corrupt
  // or schema-drifted state fails closed (see salvageSafetyContext).
  safety: safetySection,
  // Troubleshooting already shown, so a "that didn't work" reply cannot be
  // answered with the same steps and another fix challenge.
  providedTroubleshooting: optionalSection(z.array(z.string().trim().min(1).max(300)).max(20)),
  // The steps shown in the most recent turn that showed any (I4). Only these
  // can be the "failed safe checks" that justify a replacement part.
  lastTroubleshootingRound: optionalSection(z.array(z.string().trim().min(1).max(300)).max(20)),
});

export const searchErrorCodeArgsSchema = z.object({
  codes: z.array(z.string().trim().min(1).max(16)).max(8).optional(),
});

// The model supplies a human-readable manufacturer code, never an internal
// identifier. Trim and uppercase here so backend matching is exact and
// consistent with searchErrorCodes(), which uppercases codes before lookup.
export const getRepairStepsArgsSchema = z.object({
  errorCode: z
    .string()
    .trim()
    .min(1)
    .max(36)
    .transform((value) => value.toUpperCase()),
});

export const findReplacementPartsArgsSchema = z.object({
  component: z.string().trim().min(1).max(120),
  partNumber: z.string().trim().min(1).max(64).optional(),
});

// The model's final structured answer. It is advisory only: backend policy
// decides the persisted verdict, compatibility and safe instruction content.
// Optional values may be omitted or sent as null by the provider. Both forms
// are equivalent here; every bound and enum still applies.
export const submitDiagnosisOutcomeSchema = z.object({
  reply: boundedText,
  outcome: diagnosisOutcomeSchema,
  followUpQuestion: z.string().trim().min(1).max(1000).nullable().optional(),
  suspectedComponents: z.array(shortText).max(5).nullable().optional(),
  diagnosticFacts: z.array(boundedText).max(8).nullable().optional(),
  component: shortText.nullable().optional(),
  partNumber: z.string().trim().min(1).max(64).nullable().optional(),
  troubleshootingSteps: z.array(troubleshootingStepText).max(8).nullable().optional(),
});

export type TroubleshootingDto = z.infer<typeof troubleshootingDtoSchema>;
export type SafetyDto = z.infer<typeof safetyDtoSchema>;
export type CitationDto = z.infer<typeof citationSchema>;
export type ErrorCodeKnowledgeDto = z.infer<typeof errorCodeKnowledgeSchema>;
export type RepairStepKnowledgeDto = z.infer<typeof repairStepKnowledgeSchema>;
export type KnowledgeDto = z.infer<typeof knowledgeDtoSchema>;
export type PartCandidateDto = z.infer<typeof partCandidateSchema>;
export type PartsDto = z.infer<typeof partsDtoSchema>;
export type DiagnosisProgressDto = z.infer<typeof diagnosisProgressSchema>;
export type AssistantMessageMetadataDto = z.infer<typeof assistantMessageMetadataSchema>;
export type DiagnosisContextDto = z.infer<typeof diagnosisContextSchema>;
export type PersistedIdentityDto = PersistedTrustedApplianceIdentity;
export type SubmitDiagnosisOutcome = z.infer<typeof submitDiagnosisOutcomeSchema>;
export type DiagnosisOutcome = z.infer<typeof diagnosisOutcomeSchema>;

export function emptyDiagnosisContext(): DiagnosisContextDto {
  return { suspectedComponents: [], diagnosticFacts: [] };
}

export function parseAssistantMetadata(value: unknown): AssistantMessageMetadataDto | null {
  if (value === null || value === undefined) return null;
  const parsed = assistantMessageMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseDiagnosisContext(value: unknown): DiagnosisContextDto {
  if (value === null || value === undefined) return emptyDiagnosisContext();
  // A context that is not even an object (a string, number, boolean or
  // array) cannot be inspected for a recorded hazard, so it fails closed: the
  // session stays restricted rather than silently starting over.
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ...emptyDiagnosisContext(), safety: { activeCategories: ['UNVERIFIED_HAZARD'] } };
  }
  const parsed = diagnosisContextSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // The context as a whole is unusable, but an active hazard recorded in it
  // must survive: the safety section is salvaged on its own (fail closed).
  const safety = salvageSafetyContext((value as { safety?: unknown }).safety);
  return { ...emptyDiagnosisContext(), ...(safety ? { safety } : {}) };
}
