
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
import { requireAuth } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import {
  changePasswordSchema,
  loginSchema,
  refreshTokenSchema, 
  registerSchema,
} from '../validators/auth.validator.js';

export const authRouter = Router();

authRouter.post('/register', validateBody(registerSchema), register);
authRouter.post('/login', validateBody(loginSchema), login);
authRouter.post('/refresh', validateBody(refreshTokenSchema), refresh);
authRouter.post('/logout', validateBody(refreshTokenSchema), logout);
authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  changePassword,
);
authRouter.get('/me', requireAuth, me);
