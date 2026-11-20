import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { sendError } from '../utils/apiResponse.js';

function allowedOrigins(): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Browser origins are explicitly allowlisted. Native clients normally send no
// Origin header and remain allowed; they authenticate with a Bearer header, so
// credentialed CORS is not needed.
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowed = origin ? allowedOrigins().includes(origin) : true;

  res.setHeader('Vary', 'Origin');
  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    if (!allowed) {
      sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed');
      return;
    }
    res.status(204).end();
    return;
  }

  next();
}
