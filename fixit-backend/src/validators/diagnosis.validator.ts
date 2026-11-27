import { z } from 'zod';
import { brandSchema, optionalTextSchema } from './text.js';

// A symptom is free-form user prose, so ordinary line breaks (LF and CR) are
// allowed. Every other C0/C1 control character, including NUL and tab, is
// still rejected before trimming.
const SYMPTOM_UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const hasNoUnsafeSymptomControlCharacters = (value: string): boolean =>
  !SYMPTOM_UNSAFE_CONTROL_CHARACTERS.test(value);

// Session IDs arrive from the client as text. Only the shape is checked here;
// existence and ownership stay in the service layer, where the owner is derived
// from the verified access token rather than from the request.
export const sessionIdParamSchema = z.object({
  id: z.uuid('Session ID must be a valid UUID'),
});

// Exactly one identification path is accepted: a saved appliance owned by the
// caller, or an inline brand (with an optional model number) that the service
// saves as a new owned appliance. Inline fields never override a saved
// appliance. A symptom is mandatory on both paths; the error code is an
// optional, separately persisted text clue. Unknown keys such as userId and
// errorCodeId are stripped by Zod and can never reach the service.
export const createSessionSchema = z
  .object({
    applianceId: z.uuid('Appliance ID must be a valid UUID').optional(),
    brand: brandSchema.optional(),
    modelNumber: optionalTextSchema(80, 'Model number'),
    errorCode: optionalTextSchema(64, 'Error code'),
    symptom: z
      .string()
      .refine(hasNoUnsafeSymptomControlCharacters, 'Symptom contains control characters')
      .trim()
      .min(1, 'Symptom cannot be empty')
      .max(2000, 'Symptom is too long'),
  })
  .refine((data) => Boolean(data.applianceId) !== Boolean(data.brand), {
    message: 'Provide exactly one of applianceId or brand',
    path: ['applianceId'],
  });

// Bounded offset pagination. Defaults keep the first call cheap; the upper
// limit prevents a single request from loading an entire conversation.
// Exported so other list validators (for example appliances) use the same
// bounds without reimplementing pagination validation.
export const paginationSchema = {
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100').default(20),
};

export const listSessionsQuerySchema = z.object(paginationSchema);

export const listMessagesQuerySchema = z.object(paginationSchema);

export const sendMessageSchema = z.object({
  // Client-generated idempotency key. Replaying the same key returns the
  // stored AI turn instead of calling the AI provider or inserting another message pair.
  requestId: z.uuid('Request ID must be a valid UUID'),
  content: z.string().trim().min(1, 'Message cannot be empty').max(4000, 'Message is too long'),
});

// The challenge ID is opaque and server-issued. Only its shape is checked now;
// matching it against persisted, unexpired state is a later phase's job. The
// client never supplies a verdict.
export const confirmFixSchema = z.object({
  challengeId: z.string().trim().min(1, 'Challenge ID is required').max(200, 'Challenge ID is too long'),
});

// Completion on a NEEDS_PART session requires an explicit acknowledgement.
export const completeSessionSchema = z.object({
  acknowledged: z.literal(true, { message: 'Acknowledgement is required' }),
});

export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ConfirmFixInput = z.infer<typeof confirmFixSchema>;
export type CompleteSessionInput = z.infer<typeof completeSessionSchema>;
