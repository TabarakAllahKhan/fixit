import { z } from 'zod';

// Bounded, explicit DTO for backend-owned web research. This object is safe to
// place in existing JSON metadata/context fields later; provider payloads are
// never stored here.

export const researchStatusSchema = z.enum(['COMPLETED', 'NO_EVIDENCE', 'UNAVAILABLE']);

export const researchConfidenceSchema = z.enum([
  'MANUFACTURER_CONFIRMED',
  'THIRD_PARTY_SUPPORTED',
  'WEAK',
  'INSUFFICIENT',
]);

export const researchSourceKindSchema = z.enum(['SEARCH_RESULT', 'OPENED_PAGE']);

export const researchTrustSchema = z.enum(['MANUFACTURER', 'TECHNICAL_REFERENCE']);

export const researchRelevanceSchema = z.enum(['DIRECT', 'TOPICAL']);

export const researchResultSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.url({ protocol: /^https$/ }),
  snippet: z.string().trim().max(2_000).optional(),
  // Provider entry kind, not a trust claim. Trust is derived from the hostname
  // allowlist below.
  sourceKind: researchSourceKindSchema,
  trust: researchTrustSchema,
  exactModelMatch: z.boolean(),
  exactErrorCodeMatch: z.boolean(),
  relevance: researchRelevanceSchema,
  contradicted: z.boolean(),
  confidence: researchConfidenceSchema,
});

export const researchDtoSchema = z.object({
  status: researchStatusSchema,
  confidence: researchConfidenceSchema,
  results: z.array(researchResultSchema).max(10),
});

export type ResearchStatus = z.infer<typeof researchStatusSchema>;
export type ResearchConfidence = z.infer<typeof researchConfidenceSchema>;
export type ResearchSourceKind = z.infer<typeof researchSourceKindSchema>;
export type ResearchTrust = z.infer<typeof researchTrustSchema>;
export type ResearchRelevance = z.infer<typeof researchRelevanceSchema>;
export type ResearchResultDto = z.infer<typeof researchResultSchema>;
export type ResearchDto = z.infer<typeof researchDtoSchema>;
