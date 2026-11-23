import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAppliance,
  deleteAppliance,
  getAppliance,
  listAppliances,
  updateAppliance,
} from '../../src/controllers/appliance.controller.js';
import * as applianceService from '../../src/services/appliance.service.js';
import type { ApplianceDto, PaginatedApplianceDto } from '../../src/types/appliance.dto.js';
import { HttpError } from '../../src/utils/httpError.js';
import type {
  ApplianceIdParam,
  CreateApplianceInput,
  ListAppliancesQuery,
  UpdateApplianceInput,
} from '../../src/validators/appliance.validator.js';

// Controllers are HTTP adapters only: the service is mocked so these tests
// prove delegation, envelopes and error forwarding without any database.
vi.mock('../../src/services/appliance.service.js', () => ({
  createAppliance: vi.fn(),
  listAppliances: vi.fn(),
  getApplianceById: vi.fn(),
  updateAppliance: vi.fn(),
  deleteAppliance: vi.fn(),
}));

const userId = '00000000-0000-7000-8000-000000000000';
const applianceId = '00000000-0000-7000-8000-000000000001';
const params: ApplianceIdParam = { id: applianceId };

const applianceDto: ApplianceDto = {
  id: applianceId,
  category: 'WASHING_MACHINE',
  brand: 'LG',
  modelNumber: 'WW80T3040WW',
  nickname: 'Main washer',
  createdAt: new Date('2026-11-20T00:00:00.000Z'),
  updatedAt: new Date('2026-11-20T00:00:00.000Z'),
};

const pageDto: PaginatedApplianceDto = {
  items: [applianceDto],
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
};

function requestWith(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: userId },
    body: {},
    params,
    validatedQuery: { page: 1, limit: 20 },
    ...overrides,
  } as unknown as Request;
}

function responseMock() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  return { res: { status, json } as unknown as Response, status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('appliance controller delegation', () => {
  it('creates with the token user id and only validated input', async () => {
    const body = {
      category: 'WASHING_MACHINE',
      brand: 'LG',
      modelNumber: null,
      nickname: 'Main washer',
    } as CreateApplianceInput;
    vi.mocked(applianceService.createAppliance).mockResolvedValue(applianceDto);
    const { res, status, json } = responseMock();
    const next = vi.fn();

    await createAppliance(requestWith({ body }), res, next);

    expect(applianceService.createAppliance).toHaveBeenCalledWith(userId, body);
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ success: true, data: applianceDto });
    expect(next).not.toHaveBeenCalled();
  });

  it('lists with the validated query from req.validatedQuery', async () => {
    const query: ListAppliancesQuery = { page: 2, limit: 5 };
    vi.mocked(applianceService.listAppliances).mockResolvedValue(pageDto);
    const { res, status, json } = responseMock();
    const next = vi.fn();

    await listAppliances(requestWith({ validatedQuery: query }), res, next);

    expect(applianceService.listAppliances).toHaveBeenCalledWith(userId, query);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: pageDto });
    expect(next).not.toHaveBeenCalled();
  });

  it('gets the appliance identified by the validated params', async () => {
    vi.mocked(applianceService.getApplianceById).mockResolvedValue(applianceDto);
    const { res, status, json } = responseMock();
    const next = vi.fn();

    await getAppliance(requestWith(), res, next);

    expect(applianceService.getApplianceById).toHaveBeenCalledWith(userId, params);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: applianceDto });
    expect(next).not.toHaveBeenCalled();
  });

  it('updates with only validated params and body fields', async () => {
    const input = { brand: 'Samsung' } as UpdateApplianceInput;
    vi.mocked(applianceService.updateAppliance).mockResolvedValue(applianceDto);
    const { res, status, json } = responseMock();
    const next = vi.fn();

    await updateAppliance(requestWith({ body: input }), res, next);

    expect(applianceService.updateAppliance).toHaveBeenCalledWith(userId, params, input);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: applianceDto });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns the standard message envelope for a void-returning delete', async () => {
    vi.mocked(applianceService.deleteAppliance).mockResolvedValue(undefined);
    const { res, status, json } = responseMock();
    const next = vi.fn();

    await deleteAppliance(requestWith(), res, next);

    expect(applianceService.deleteAppliance).toHaveBeenCalledWith(userId, params);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: { message: 'Appliance deleted' } });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('appliance controller error handling', () => {
  it('forwards service failures to the central error handler', async () => {
    const failure = new Error('service failed');
    vi.mocked(applianceService.getApplianceById).mockRejectedValue(failure);
    const { res, status, json } = responseMock();
    const next = vi.fn();

    await getAppliance(requestWith(), res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('never calls the service without an authenticated user id', async () => {
    const { res } = responseMock();
    const next = vi.fn();

    await createAppliance(requestWith({ user: undefined }), res, next);

    expect(applianceService.createAppliance).not.toHaveBeenCalled();
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as HttpError;
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });
});
