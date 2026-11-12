import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../utils/apiResponse.js';

// Express recognises an error handler by its four parameters, so all four
// must be declared even though _req is unused.
export function errorHandler( 
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // The real details go to the server log only.
  console.error('Unhandled error:', error instanceof Error ? (error.stack ?? error.message) : error);

  // If a response is already partly sent, let Express close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}