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

// MANUFACTURER: official domain mapped to the appliance's own brand.
// OTHER_MANUFACTURER: allowlisted manufacturer site belonging to a different
// (or unmapped) brand; never evidence about this appliance beyond WEAK.
// TECHNICAL_REFERENCE: allowlisted independent repair/parts reference.
export const researchTrustSchema = z.enum(['MANUFACTURER', 'OTHER_MANUFACTURER', 'TECHNICAL_REFERENCE']);

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

// Full bounded research kept in session context so an unchanged research key
// can reuse it on later turns. `key` is a SHA-256 hex digest of the trusted
// research inputs; it contains no raw user text.
export const researchCacheSchema = z.object({
  version: z.literal(1),
  key: z.string().regex(/^[0-9a-f]{64}$/),
  // Symptom-free identity hash, used only by legacy sessions with no
  // persisted symptom. Optional so caches written earlier still parse.
  anchorKey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  researchedAt: z.iso.datetime(),
  result: researchDtoSchema,
});

// Small, client-visible summary stored in assistant message metadata. Each
// source carries its backend-derived evidence tier so wording can match it.
export const researchSummarySourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.url({ protocol: /^https$/ }),
  trust: researchTrustSchema,
  confidence: researchConfidenceSchema,
});

export const researchSummarySchema = z.object({
  status: researchStatusSchema,
  confidence: researchConfidenceSchema,
  reused: z.boolean(),
  sources: z.array(researchSummarySourceSchema).max(5),
});

export type ResearchCacheDto = z.infer<typeof researchCacheSchema>;
export type ResearchSummaryDto = z.infer<typeof researchSummarySchema>;
export type ResearchStatus = z.infer<typeof researchStatusSchema>;
export type ResearchConfidence = z.infer<typeof researchConfidenceSchema>;
export type ResearchSourceKind = z.infer<typeof researchSourceKindSchema>;
export type ResearchTrust = z.infer<typeof researchTrustSchema>;
export type ResearchRelevance = z.infer<typeof researchRelevanceSchema>;
export type ResearchResultDto = z.infer<typeof researchResultSchema>;
export type ResearchDto = z.infer<typeof researchDtoSchema>;
