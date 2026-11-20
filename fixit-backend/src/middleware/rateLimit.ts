import type { Request, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { sendError } from '../utils/apiResponse.js';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimit(options: {
  name: string;
  max: number;
  key?: (req: Request) => string;
}): RequestHandler {
  return (req, res, next) => {
    if (!env.RATE_LIMIT_ENABLED) {
      next();
      return;
    }

    const now = Date.now();
    prune(now);
    const key = `${options.name}:${options.key ? options.key(req) : clientIp(req)}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS });
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(options.max - 1));
      next();
      return;
    }

    if (current.count >= options.max) {
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', '0');
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      sendError(res, 429, 'RATE_LIMITED', 'Too many requests; try again later');
      return;
    }

    current.count += 1;
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(options.max - current.count));
    next();
  };
}
