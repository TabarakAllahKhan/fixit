import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { sendError } from '../utils/apiResponse.js';

function sendValidationError(res: Response, issues: readonly { path: readonly PropertyKey[]; message: string }[], fallback: string): void {
  const issue = issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : fallback;
  sendError(res, 400, 'VALIDATION_ERROR', `${field}: ${issue?.message ?? 'Invalid input'}`);
}

// Replaces req.body with the parsed value so controllers only ever see data
// that has passed the route's schema. Zod strips unknown keys by default.
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      sendValidationError(res, result.error.issues, 'body');
      return;
    }

    req.body = result.data;
    next();
  };
}

// Route params are strings until parsed. Replacing them keeps controllers from
// re-checking IDs that have already been validated.
export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      sendValidationError(res, result.error.issues, 'params');
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}

// Express 5 exposes req.query as a read-only getter, so the parsed value is
// stored separately. Controllers must read req.validatedQuery, never req.query.
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      sendValidationError(res, result.error.issues, 'query');
      return;
    }

    req.validatedQuery = result.data;
    next();
  };
}
