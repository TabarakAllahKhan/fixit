import { z } from 'zod';
import { paginationSchema } from './diagnosis.validator.js';
import { brandSchema, optionalTextSchema } from './text.js';

// One field definition per editable column keeps create and PATCH aligned.
// Zod objects strip unlisted keys, so id, userId, category, nickname and
// timestamps are never accepted as writable input. Category and nickname are
// legacy database columns only; they are no longer part of the appliance API.
const editableFields = {
  brand: brandSchema,
  modelNumber: optionalTextSchema(80, 'Model number'),
};

export const createApplianceSchema = z.object(editableFields);

export const updateApplianceSchema = z
  .object({
    ...editableFields,
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
