import type { NextFunction, Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { HttpError } from '../utils/httpError.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
} from '../validators/auth.validator.js';

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.register(req.body as RegisterInput);
    sendSuccess(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body as LoginInput);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as RefreshTokenInput;
    const tokens = await authService.refresh(refreshToken);
    sendSuccess(res, { tokens });
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as RefreshTokenInput;
    await authService.logout(refreshToken);
    sendSuccess(res, { message: 'Logged out' });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const input = req.body as ChangePasswordInput;
    await authService.changePassword(req.user.id, input);

    // Deliberately return no user object or tokens: the password hash must never
    // leave the server, and every refresh token has just been revoked.
    sendSuccess(res, { message: 'Password changed. Please sign in again.' });
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const user = await authService.getCurrentUser(req.user.id);
    sendSuccess(res, { user });
  } catch (error) {
    next(error);
  }
}
