import type { Request, Response } from 'express';
import { sendError } from '../utils/apiResponse.js';

// Runs only when no route matched the request.
// _req indicated that the parameter is unused but is required to match the signature of an Express middleware function.
export function notFound(_req: Request, res: Response): void {
  sendError(res, 404, 'NOT_FOUND', 'Route not found');
}