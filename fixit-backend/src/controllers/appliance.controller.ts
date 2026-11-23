import type { NextFunction, Request, Response } from 'express';
import * as applianceService from '../services/appliance.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { HttpError } from '../utils/httpError.js';
import type {
  ApplianceIdParam,
  CreateApplianceInput,
  ListAppliancesQuery,
  UpdateApplianceInput,
} from '../validators/appliance.validator.js';

// Ownership always starts from the verified token. Never take a user id from
// the body, params or query.
function currentUserId(req: Request): string {
  if (!req.user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return req.user.id;
}

export async function createAppliance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await applianceService.createAppliance(currentUserId(req), req.body as CreateApplianceInput);
    sendSuccess(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function listAppliances(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.validatedQuery as ListAppliancesQuery;
    const result = await applianceService.listAppliances(currentUserId(req), query);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getAppliance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as ApplianceIdParam;
    const result = await applianceService.getApplianceById(currentUserId(req), params);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateAppliance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as ApplianceIdParam;
    const input = req.body as UpdateApplianceInput;
    const result = await applianceService.updateAppliance(currentUserId(req), params, input);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteAppliance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = req.params as unknown as ApplianceIdParam;
    // The service returns void, so use the project's standard mutation message
    // envelope rather than inventing a delete-specific payload.
    await applianceService.deleteAppliance(currentUserId(req), params);
    sendSuccess(res, { message: 'Appliance deleted' });
  } catch (error) {
    next(error);
  }
}
