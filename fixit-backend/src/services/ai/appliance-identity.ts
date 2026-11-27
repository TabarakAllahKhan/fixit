import { z } from 'zod';

/*
Identity resolver for saved appliances of any type.

It combines the trusted appliance row with USER-authored messages to resolve a
model number and (only when a legacy category is known) a category-specific
configuration scope. AI-generated identity claims are never accepted.
*/

export const trustedApplianceCategorySchema = z.enum(['WASHING_MACHINE', 'REFRIGERATOR']);
export const trustedModelScopeSchema = z.enum([
  'TOP_LOAD',
  'FRONT_LOAD',
  'FRENCH_DOOR_BOTTOM_FREEZER',
]);
export const trustedModelSourceSchema = z.enum(['APPLIANCE', 'USER_MESSAGE']);
export const trustedScopeSourceSchema = z.literal('USER_MESSAGE');

// `version` makes the persisted shape explicit. Legacy unversioned fields are
// rejected by the context parser and can never seed a trusted identity.
export const persistedTrustedApplianceIdentitySchema = z.strictObject({
  version: z.literal(1),
  modelNumber: z.string().trim().min(1).max(80).nullable(),
  modelSource: trustedModelSourceSchema.nullable(),
  modelScope: trustedModelScopeSchema.nullable(),
  scopeSource: trustedScopeSourceSchema.nullable(),
  modelConflict: z.boolean().optional(),
  scopeConflict: z.boolean().optional(),
});

export type ApplianceCategory = z.infer<typeof trustedApplianceCategorySchema>;
export type TrustedModelScope = z.infer<typeof trustedModelScopeSchema>;
export type TrustedModelSource = z.infer<typeof trustedModelSourceSchema>;
export type TrustedScopeSource = z.infer<typeof trustedScopeSourceSchema>;
export type PersistedTrustedApplianceIdentity = z.infer<
  typeof persistedTrustedApplianceIdentitySchema
>;

export type TrustedApplianceIdentity = {
  version: 1;
  // Null for new appliances: no category is inferred from a brand or model.
  category: ApplianceCategory | null;
  brand: string;
  modelNumber: string | null;
  modelSource: TrustedModelSource | null;
  modelScope: TrustedModelScope | null;
  scopeSource: TrustedScopeSource | null;
  modelConflict: boolean;
  scopeConflict: boolean;
  needsModelNumber: boolean;
  needsModelScope: boolean;
};

export type ResolveTrustedApplianceIdentityInput = {
  appliance: {
    category: ApplianceCategory | null;
    brand: string;
    modelNumber: string | null;
  };
  persisted?: unknown;
  userMessages: readonly string[];
  currentUserContent: string;
};

export function parsePersistedTrustedApplianceIdentity(
  value: unknown,
): PersistedTrustedApplianceIdentity | null {
  const parsed = persistedTrustedApplianceIdentitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toPersistedTrustedApplianceIdentity(
  identity: TrustedApplianceIdentity,
): PersistedTrustedApplianceIdentity {
  return {
    version: 1,
    modelNumber: identity.modelNumber,
    modelSource: identity.modelSource,
    modelScope: identity.modelScope,
    scopeSource: identity.scopeSource,
    ...(identity.modelConflict ? { modelConflict: true } : {}),
    ...(identity.scopeConflict ? { scopeConflict: true } : {}),
  };
}

export function hasTrustedModel(
  identity: TrustedApplianceIdentity,
): identity is TrustedApplianceIdentity & { modelNumber: string; modelSource: TrustedModelSource } {
  return Boolean(identity.modelNumber && identity.modelSource && !identity.modelConflict);
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

// Stored values (registered appliances and valid persisted USER entries) only
// need to be bounded; extraction from free text uses the stricter token rule
// below so short error codes cannot become model numbers.
function normalizeStoredModelNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || hasControlCharacter(trimmed)) return null;
  return trimmed;
}

function comparisonKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s._-]+/g, '');
}

const MODEL_TOKEN_PATTERN = /\b[A-Za-z0-9][A-Za-z0-9._-]{3,79}\b/g;
const EXPLICIT_MODEL_PATTERN =
  /\bmodel(?:\s+number|\s*#)?\s*(?:is\s*)?(?::|=)?\s*([A-Za-z0-9][A-Za-z0-9._-]{3,79})\b/gi;

function isModelLikeToken(value: string): boolean {
  return value.length >= 4 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function collectMatches(text: string, pattern: RegExp, group = 0): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = normalizeStoredModelNumber(match[group]);
    if (!value || !isModelLikeToken(value)) continue;
    if (!values.some((existing) => comparisonKey(existing) === comparisonKey(value))) {
      values.push(value);
    }
  }
  return values;
}

// Any model-shaped token in USER-authored text is a user claim. The explicit
// pattern additionally acts as a correction: when the current USER message
// explicitly identifies a model, it supersedes older conflicting claims.
export function extractUserModelNumbers(text: string): string[] {
  return collectMatches(text, MODEL_TOKEN_PATTERN);
}

export function extractExplicitUserModelNumbers(text: string): string[] {
  return collectMatches(text, EXPLICIT_MODEL_PATTERN, 1);
}

const SCOPE_PATTERNS: Record<ApplianceCategory, ReadonlyArray<[TrustedModelScope, RegExp]>> = {
  WASHING_MACHINE: [
    ['TOP_LOAD', /\btop[\s-]?load(?:er)?\b/i],
    ['FRONT_LOAD', /\bfront[\s-]?load(?:er)?\b/i],
  ],
  REFRIGERATOR: [
    [
      'FRENCH_DOOR_BOTTOM_FREEZER',
      /\b(?:french[\s-]?door[^.!?]{0,40}bottom[\s-]?freezer|bottom[\s-]?freezer[^.!?]{0,40}french[\s-]?door)\b/i,
    ],
  ],
};

// A model number never establishes configuration scope. Only these explicit
// USER-authored configuration statements may do so, and the patterns are
// category-specific so a fridge claim cannot set a washer scope. With no
// trusted category there is no scope vocabulary, so no scope can be claimed.
export function extractUserModelScopes(text: string, category: ApplianceCategory | null): TrustedModelScope[] {
  if (!category) return [];
  return SCOPE_PATTERNS[category]
    .filter(([, pattern]) => pattern.test(text))
    .map(([scope]) => scope);
}

type SingleResolution<T> = { value: T | null; conflict: boolean };

function resolveSingle<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  inheritedConflict: boolean,
  currentCorrection: boolean,
): SingleResolution<T> {
  const distinct: T[] = [];
  for (const value of values) {
    if (!distinct.some((existing) => keyOf(existing) === keyOf(value))) distinct.push(value);
  }
  // Only a fresh explicit answer after a persisted conflict may clear it. A
  // new claim that merely disagrees with existing USER claims is itself a
  // conflict and must remain unknown until the user resolves it.
  if (currentCorrection) {
    return distinct.length === 1 ? { value: distinct[0]!, conflict: false } : { value: null, conflict: true };
  }
  if (inheritedConflict || distinct.length > 1) return { value: null, conflict: true };
  return distinct.length === 1 ? { value: distinct[0]!, conflict: false } : { value: null, conflict: false };
}

type ModelResolution = {
  value: string | null;
  source: TrustedModelSource | null;
  conflict: boolean;
};

function resolveUserModel(
  persisted: PersistedTrustedApplianceIdentity | null,
  userMessages: readonly string[],
  currentUserContent: string,
): ModelResolution {
  const explicitCurrent = extractExplicitUserModelNumbers(currentUserContent);
  const persistedConflict = Boolean(persisted?.modelConflict);
  // An explicit model statement is accepted as a correction only after a prior
  // conflict was persisted. Otherwise it is one more USER claim and must be
  // checked against the rest of the conversation.
  const currentCorrection = persistedConflict && explicitCurrent.length > 0;
  const claims = currentCorrection
    ? explicitCurrent
    : [
        ...(persisted?.modelSource === 'USER_MESSAGE' && persisted.modelNumber && !persistedConflict
          ? [persisted.modelNumber]
          : []),
        ...userMessages.flatMap(extractUserModelNumbers),
        ...extractUserModelNumbers(currentUserContent),
      ];
  const resolved = resolveSingle(claims, comparisonKey, persistedConflict, currentCorrection);
  return {
    value: resolved.value,
    source: resolved.value ? 'USER_MESSAGE' : null,
    conflict: resolved.conflict,
  };
}

type ScopeResolution = {
  value: TrustedModelScope | null;
  source: TrustedScopeSource | null;
  conflict: boolean;
};

function resolveUserScope(
  persisted: PersistedTrustedApplianceIdentity | null,
  userMessages: readonly string[],
  currentUserContent: string,
  category: ApplianceCategory | null,
): ScopeResolution {
  // A category-less appliance has no scope vocabulary. Persisted scope claims
  // from another category are never promoted, while an unresolved persisted
  // conflict is retained rather than silently cleared.
  if (!category) {
    return { value: null, source: null, conflict: Boolean(persisted?.scopeConflict) };
  }
  const currentScopes = extractUserModelScopes(currentUserContent, category);
  const persistedConflict = Boolean(persisted?.scopeConflict);
  const currentCorrection = persistedConflict && currentScopes.length > 0;
  const claims = currentCorrection
    ? currentScopes
    : [
        ...(persisted?.scopeSource === 'USER_MESSAGE' && persisted.modelScope && !persistedConflict
          ? [persisted.modelScope]
          : []),
        ...userMessages.flatMap((message) => extractUserModelScopes(message, category)),
        ...currentScopes,
      ];
  const resolved = resolveSingle(
    claims,
    (scope) => scope,
    persistedConflict,
    currentCorrection,
  );
  return {
    value: resolved.value,
    source: resolved.value ? 'USER_MESSAGE' : null,
    conflict: resolved.conflict,
  };
}

export function resolveTrustedApplianceIdentity(
  input: ResolveTrustedApplianceIdentityInput,
): TrustedApplianceIdentity {
  const persisted = parsePersistedTrustedApplianceIdentity(input.persisted);
  const category = input.appliance.category;
  const brand = input.appliance.brand.trim();
  // Always re-read from the supplied fresh row. A persisted APPLIANCE-source
  // value is never promoted when the registered model changes or is cleared.
  const registeredModel = normalizeStoredModelNumber(input.appliance.modelNumber);

  const model = registeredModel
    ? { value: registeredModel, source: 'APPLIANCE' as const, conflict: false }
    : resolveUserModel(persisted, input.userMessages, input.currentUserContent);
  const scope = resolveUserScope(
    persisted,
    input.userMessages,
    input.currentUserContent,
    category,
  );

  return {
    version: 1,
    category,
    brand,
    modelNumber: model.value,
    modelSource: model.source,
    modelScope: scope.value,
    scopeSource: scope.source,
    modelConflict: model.conflict,
    scopeConflict: scope.conflict,
    needsModelNumber: model.value === null,
    needsModelScope: scope.value === null,
  };
}
