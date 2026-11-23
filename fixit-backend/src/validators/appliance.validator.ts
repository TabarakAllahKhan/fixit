import { z } from 'zod';
import { ApplianceCategory } from '../generated/prisma/enums.js';
import { paginationSchema } from './diagnosis.validator.js';

// PostgreSQL text cannot contain NUL, and no client-authored control character
// belongs in a saved appliance. Check the raw value before trimming so leading
// or trailing tabs/newlines are rejected instead of silently removed.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
const hasNoControlCharacters = (value: string): boolean => !CONTROL_CHARACTERS.test(value);

// The enum comes from the generated Prisma client so request validation cannot
// drift away from the values the database accepts.
const categorySchema = z.enum(ApplianceCategory);

const brandSchema = z
  .string()
  .refine(hasNoControlCharacters, 'Brand contains control characters')
  .trim()
  .min(1, 'Brand cannot be empty')
  .max(120, 'Brand is too long');

// Blank optional values are stored as null, and explicit null clears the
// field. Undefined is preserved so PATCH can distinguish "not supplied".
function optionalTextSchema(max: number, label: string) {
  return z
    .string()
    .refine(hasNoControlCharacters, `${label} contains control characters`)
    .trim()
    .max(max, `${label} is too long`)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));
}

// One field definition per editable column keeps create and PATCH aligned.
// Zod objects strip unlisted keys, so id, userId and timestamps are never
// accepted as writable input.
const editableFields = {
  category: categorySchema,
  brand: brandSchema,
  modelNumber: optionalTextSchema(80, 'Model number'),
  nickname: optionalTextSchema(100, 'Nickname'),
};

export const createApplianceSchema = z.object(editableFields);

export const updateApplianceSchema = z
  .object({
    ...editableFields,
    category: editableFields.category.optional(),
    brand: editableFields.brand.optional(),
  })
  // Checks run after unknown keys are stripped: a body with only unknown or
  // server-managed properties has no editable field and must fail.
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one editable field',
  });

// The parameter name matches PATCH/GET /appliances/:id. Shape only: existence
// and ownership belong in the service layer, derived from the verified token.
export const applianceIdParamSchema = z.object({
  id: z.uuid('Appliance ID must be a valid UUID'),
});

// Same bounded offset pagination as the diagnosis lists; no new helper.
export const listAppliancesQuerySchema = z.object(paginationSchema);

export type CreateApplianceInput = z.infer<typeof createApplianceSchema>;
export type UpdateApplianceInput = z.infer<typeof updateApplianceSchema>;
export type ApplianceIdParam = z.infer<typeof applianceIdParamSchema>;
export type ListAppliancesQuery = z.infer<typeof listAppliancesQuerySchema>;
