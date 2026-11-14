import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../utils/apiResponse.js';
import { verifyAccessToken } from '../services/token.service.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authorization header must use the Bearer scheme');
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    // Only the internal user id is attached. Never trust a client-supplied id.
    req.user = { id: payload.sub };
    next();
  } catch (error) {
    next(error);
  }
}
