import type { NextFunction, Request, Response } from 'express';
import * as diagnosisService from '../services/diagnosis.service.js';
import * as sessionService from '../services/session.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { HttpError } from '../utils/httpError.js';
import type {
  CompleteSessionInput,
  ConfirmFixInput,
  CreateSessionInput,
  ListMessagesQuery,
  ListSessionsQuery,
  SendMessageInput,
  SessionIdParam,
} from '../validators/diagnosis.validator.js';

// Ownership always starts from the verified token. Never take a user id from
// the body, params or query.
function currentUserId(req: Request): string {
  if (!req.user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return req.user.id;
}

export async function createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await sessionService.createSession(currentUserId(req), req.body as CreateSessionInput);
    sendSuccess(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.validatedQuery as ListSessionsQuery;
    const result = await sessionService.listSessions(currentUserId(req), query);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as SessionIdParam;
    const result = await sessionService.getSessionById(currentUserId(req), params);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function listMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as SessionIdParam;
    const query = req.validatedQuery as ListMessagesQuery;
    const result = await diagnosisService.listMessages(currentUserId(req), params, query);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as SessionIdParam;
    const input = req.body as SendMessageInput;
    const result = await diagnosisService.sendMessage(currentUserId(req), params, input);
    sendSuccess(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function confirmFix(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as SessionIdParam;
    const input = req.body as ConfirmFixInput;
    const result = await diagnosisService.confirmFix(currentUserId(req), params, input);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function completeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as SessionIdParam;
    const input = req.body as CompleteSessionInput;
    const result = await diagnosisService.completeSession(currentUserId(req), params, input);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}
