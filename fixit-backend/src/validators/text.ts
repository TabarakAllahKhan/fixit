import { z } from 'zod';

// PostgreSQL text cannot contain NUL, and no client-authored control character
// belongs in saved appliance or diagnosis input. Check the raw value before
// trimming so leading or trailing tabs/newlines are rejected instead of
// silently removed.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

export const hasNoControlCharacters = (value: string): boolean => !CONTROL_CHARACTERS.test(value);

export const brandSchema = z
  .string()
  .refine(hasNoControlCharacters, 'Brand contains control characters')
  .trim()
  .min(1, 'Brand cannot be empty')
  .max(120, 'Brand is too long');

// Blank optional values are stored as null, and explicit null clears the
// field. Undefined is preserved so PATCH can distinguish "not supplied".
export function optionalTextSchema(max: number, label: string) {
  return z
    .string()
    .refine(hasNoControlCharacters, `${label} contains control characters`)
    .trim()
    .max(max, `${label} is too long`)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));
}
