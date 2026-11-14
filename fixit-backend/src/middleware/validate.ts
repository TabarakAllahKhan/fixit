import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { sendError } from '../utils/apiResponse.js';

// Replaces req.body with the parsed value so controllers only ever see data
// that has passed the route's schema. Zod strips unknown keys by default.
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'body';
      sendError(res, 400, 'VALIDATION_ERROR', `${field}: ${issue?.message ?? 'Invalid input'}`);
      return;
    }

    req.body = result.data;
    next();
  };
}
