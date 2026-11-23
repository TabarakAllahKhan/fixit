import type { Request, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { sendError } from '../utils/apiResponse.js';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// This function is used to prune the buckets map by removing any buckets that have expired
function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

// This function is used to get the client IP address
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

// This function is used to reset the rate limits for testing purposes so that
// we can test the rate limiting functionality without waiting for the window to expire
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
    // if there is no current bucket or the current bucket has expired then create a new bucket
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS });
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(options.max - 1));
      next();
      return;
    }
    // if the current bucket has not expired then check if the count is greater than or equal to the max
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
