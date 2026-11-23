import { Router } from 'express';
import { env } from '../config/env.js';
import {
  createAppliance,
  deleteAppliance,
  getAppliance,
  listAppliances,
  updateAppliance,
} from '../controllers/appliance.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  applianceIdParamSchema,
  createApplianceSchema,
  listAppliancesQuerySchema,
  updateApplianceSchema,
} from '../validators/appliance.validator.js';

export const applianceRouter = Router();

// One shared write budget for all appliance mutations, reusing the configured
// auth-write limit. Authentication runs before validation (and before this
// limiter) so unauthenticated callers cannot spend a bucket or probe the rules.
const applianceWriteRateLimit = rateLimit({
  name: 'appliance-write',
  max: env.RATE_LIMIT_AUTH_MAX,
  key: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

applianceRouter.post(
  '/',
  requireAuth,
  applianceWriteRateLimit,
  validateBody(createApplianceSchema),
  createAppliance,
);
applianceRouter.get('/', requireAuth, validateQuery(listAppliancesQuerySchema), listAppliances);
applianceRouter.get('/:id', requireAuth, validateParams(applianceIdParamSchema), getAppliance);
applianceRouter.patch(
  '/:id',
  requireAuth,
  applianceWriteRateLimit,
  validateParams(applianceIdParamSchema),
  validateBody(updateApplianceSchema),
  updateAppliance,
);
applianceRouter.delete(
  '/:id',
  requireAuth,
  applianceWriteRateLimit,
  validateParams(applianceIdParamSchema),
  deleteAppliance,
);
