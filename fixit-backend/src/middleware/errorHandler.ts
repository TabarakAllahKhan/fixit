import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../utils/apiResponse.js';
import { HttpError } from '../utils/httpError.js';

// Express recognises an error handler by its four parameters, so all four
// must be declared even though _req is unused.
export function errorHandler( 
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If a response is already partly sent, let Express close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  // Expected, client-safe failures carry their own status and error code.
  if (error instanceof HttpError) {
    sendError(res, error.statusCode, error.code, error.message);
    return;
  }

  // The real details go to the server log only.
  console.error('Unhandled error:', error instanceof Error ? (error.stack ?? error.message) : error);

  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}
