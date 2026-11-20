
// This files contains the routes for authentication related endpoints
import { Router } from 'express';
import {
  changePassword,
  login,
  logout,
  me,
  refresh,
  register,
} from '../controllers/auth.controller.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import {
  changePasswordSchema,
  loginSchema,
  refreshTokenSchema, 
  registerSchema,
} from '../validators/auth.validator.js';

export const authRouter = Router();

const authRateLimit = rateLimit({ name: 'auth', max: env.RATE_LIMIT_AUTH_MAX });

authRouter.post('/register', authRateLimit, validateBody(registerSchema), register);
authRouter.post('/login', authRateLimit, validateBody(loginSchema), login);
authRouter.post('/refresh', authRateLimit, validateBody(refreshTokenSchema), refresh);
authRouter.post('/logout', authRateLimit, validateBody(refreshTokenSchema), logout);
authRouter.post(
  '/change-password',
  requireAuth,
  authRateLimit,
  validateBody(changePasswordSchema),
  changePassword,
);
authRouter.get('/me', requireAuth, me);
