import type { NextFunction, Request, Response } from 'express';

// Minimal CORS for frontend integration. The Expo client authenticates with a
// Bearer header rather than cookies, so no credentialed CORS is needed here.
// Reflecting the Origin keeps local device/emulator/web origins working; a
// strict allowlist belongs in the Phase 9 hardening pass.
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}
