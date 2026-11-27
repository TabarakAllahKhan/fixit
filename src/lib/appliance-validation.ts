import type { ApplianceCategory, CreateApplianceInput, UpdateApplianceInput } from '@/types/appliance';

// Mirrors fixit-backend/src/validators/appliance.validator.ts. The check runs on
// the raw value so leading/trailing tabs or newlines are rejected, not trimmed away.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
const CATEGORIES: readonly ApplianceCategory[] = ['WASHING_MACHINE', 'REFRIGERATOR'];
const EDITABLE_FIELDS = ['category', 'brand', 'modelNumber', 'nickname'] as const;

export interface ApplianceFieldErrors {
  category?: string;
  brand?: string;
  modelNumber?: string;
  nickname?: string;
  form?: string;
}

function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTERS.test(value);
}

function validateCategory(value: ApplianceCategory | undefined): string | undefined {
  if (value === undefined || !CATEGORIES.includes(value)) {
    return 'Choose a valid appliance category.';
  }
  return undefined;
}

function validateBrand(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return 'Brand cannot be empty';
  if (hasControlCharacters(value)) return 'Brand contains control characters';

  const trimmed = value.trim();
  if (!trimmed) return 'Brand cannot be empty';
  if (trimmed.length > 120) return 'Brand is too long';
  return undefined;
}

function validateOptionalText(
  value: string | null | undefined,
  max: number,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  // Runtime guards keep validation safe when form state is loosely typed.
  if (typeof value !== 'string') return `${label} is invalid`;
  if (hasControlCharacters(value)) return `${label} contains control characters`;
  return value.trim().length > max ? `${label} is too long` : undefined;
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function assignError(errors: ApplianceFieldErrors, field: keyof ApplianceFieldErrors, message?: string): void {
  if (message) errors[field] = message;
}

export function hasApplianceErrors(errors: ApplianceFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** Field-level messages for a create form. Does not add constraints beyond the backend. */
export function validateCreateAppliance(input: CreateApplianceInput): ApplianceFieldErrors {
  const errors: ApplianceFieldErrors = {};
  assignError(errors, 'category', validateCategory(input.category));
  assignError(errors, 'brand', validateBrand(input.brand));
  assignError(errors, 'modelNumber', validateOptionalText(input.modelNumber, 80, 'Model number'));
  assignError(errors, 'nickname', validateOptionalText(input.nickname, 100, 'Nickname'));
  return errors;
}

/** Trimmed body matching the backend's create normalization. */
export function normalizeCreateAppliance(input: CreateApplianceInput): CreateApplianceInput {
  return {
    category: input.category,
    brand: typeof input.brand === 'string' ? input.brand.trim() : '',
    modelNumber: normalizeOptionalText(input.modelNumber) ?? null,
    nickname: normalizeOptionalText(input.nickname) ?? null,
  };
}

/** Field-level messages for an edit form, including the empty-PATCH rule. */
export function validateUpdateAppliance(input: UpdateApplianceInput): ApplianceFieldErrors {
  const errors: ApplianceFieldErrors = {};
  if (!EDITABLE_FIELDS.some((field) => input[field] !== undefined)) {
    errors.form = 'Provide at least one editable field';
  }
  if (input.category !== undefined) assignError(errors, 'category', validateCategory(input.category));
  if (input.brand !== undefined) assignError(errors, 'brand', validateBrand(input.brand));
  assignError(errors, 'modelNumber', validateOptionalText(input.modelNumber, 80, 'Model number'));
  assignError(errors, 'nickname', validateOptionalText(input.nickname, 100, 'Nickname'));
  return errors;
}

/**
 * Trimmed PATCH body. Omitted fields stay omitted so the backend leaves them
 * unchanged; explicit null and empty strings both clear optional fields.
 */
export function normalizeUpdateAppliance(input: UpdateApplianceInput): UpdateApplianceInput {
  const normalized: UpdateApplianceInput = {};
  if (input.category !== undefined) normalized.category = input.category;
  if (input.brand !== undefined) {
    normalized.brand = typeof input.brand === 'string' ? input.brand.trim() : '';
  }
  if (input.modelNumber !== undefined) {
    normalized.modelNumber = normalizeOptionalText(input.modelNumber) ?? null;
  }
  if (input.nickname !== undefined) {
    normalized.nickname = normalizeOptionalText(input.nickname) ?? null;
  }
  return normalized;
}
