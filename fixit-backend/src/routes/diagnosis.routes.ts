import { Router } from 'express';
import {
  completeSession,
  confirmFix,
  createSession,
  getSession,
  listMessages,
  listSessions,
  sendMessage,
} from '../controllers/diagnosis.controller.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  completeSessionSchema,
  confirmFixSchema,
  createSessionSchema,
  listMessagesQuerySchema,
  listSessionsQuerySchema,
  sendMessageSchema,
  sessionIdParamSchema,
} from '../validators/diagnosis.validator.js';

export const diagnosisRouter = Router();

const messageRateLimit = rateLimit({
  name: 'diagnosis-message',
  max: env.RATE_LIMIT_MESSAGE_MAX,
  key: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

// Authentication runs before request validation so an unauthenticated caller
// cannot probe the validation rules.
diagnosisRouter.post('/', requireAuth, validateBody(createSessionSchema), createSession);
diagnosisRouter.get('/', requireAuth, validateQuery(listSessionsQuerySchema), listSessions);
diagnosisRouter.get('/:id', requireAuth, validateParams(sessionIdParamSchema), getSession);
diagnosisRouter.get(
  '/:id/messages',
  requireAuth,
  validateParams(sessionIdParamSchema),
  validateQuery(listMessagesQuerySchema),
  listMessages,
);
diagnosisRouter.post(
  '/:id/messages',
  requireAuth,
  messageRateLimit,
  validateParams(sessionIdParamSchema),
  validateBody(sendMessageSchema),
  sendMessage,
);
diagnosisRouter.post(
  '/:id/confirm',
  requireAuth,
  validateParams(sessionIdParamSchema),
  validateBody(confirmFixSchema),
  confirmFix,
);
diagnosisRouter.post(
  '/:id/complete',
  requireAuth,
  validateParams(sessionIdParamSchema),
  validateBody(completeSessionSchema),
  completeSession,
);
