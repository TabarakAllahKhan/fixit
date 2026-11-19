import { z } from 'zod';

// Session IDs arrive from the client as text. Only the shape is checked here;
// existence and ownership stay in the service layer, where the owner is derived
// from the verified access token rather than from the request.
export const sessionIdParamSchema = z.object({
  id: z.uuid('Session ID must be a valid UUID'),
});

// The MVP keeps appliance context as a reference to a saved Appliance, so a
// model number is not required here — older appliances may not have one.
// At least one starting clue is required so diagnosis never begins blind.
export const createSessionSchema = z
  .object({
    applianceId: z.uuid('Appliance ID must be a valid UUID'),
    symptom: z.string().trim().min(1, 'Symptom cannot be empty').max(2000, 'Symptom is too long').optional(),
    errorCode: z.string().trim().min(1, 'Error code cannot be empty').max(64, 'Error code is too long').optional(),
  })
  .refine((data) => Boolean(data.symptom) || Boolean(data.errorCode), {
    message: 'Provide at least one of symptom or errorCode',
    path: ['symptom'],
  });

// Bounded offset pagination. Defaults keep the first call cheap; the upper
// limit prevents a single request from loading an entire conversation.
const paginationSchema = {
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100').default(20),
};

export const listSessionsQuerySchema = z.object(paginationSchema);

export const listMessagesQuerySchema = z.object(paginationSchema);

export const sendMessageSchema = z.object({
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
