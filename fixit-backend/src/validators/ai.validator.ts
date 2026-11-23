import { z } from 'zod';
import {
  persistedTrustedApplianceIdentitySchema,
  type PersistedTrustedApplianceIdentity,
} from '../services/ai/appliance-identity.js';

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

export const assistantMessageMetadataSchema = z.object({
  kind: z.literal('ASSISTANT_TURN'),
  requestId: z.uuid(),
  progress: diagnosisProgressSchema,
  knowledge: knowledgeDtoSchema.optional(),
  parts: partsDtoSchema.optional(),
  citations: z.array(citationSchema).max(20),
});

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
});

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
  const parsed = diagnosisContextSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyDiagnosisContext();
}
