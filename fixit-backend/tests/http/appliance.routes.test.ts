import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { resetRateLimits } from '../../src/middleware/rateLimit.js';
import * as applianceService from '../../src/services/appliance.service.js';
import { signAccessToken } from '../../src/services/token.service.js';
import type { ApplianceDto, PaginatedApplianceDto } from '../../src/types/appliance.dto.js';
import { HttpError } from '../../src/utils/httpError.js';

// HTTP-level tests mock the service at the controller boundary. No valid
// request here can reach PostgreSQL.
vi.mock('../../src/services/appliance.service.js', () => ({
  createAppliance: vi.fn(),
  listAppliances: vi.fn(),
  getApplianceById: vi.fn(),
  updateAppliance: vi.fn(),
  deleteAppliance: vi.fn(),
}));

const userId = '00000000-0000-7000-8000-000000000000';
const applianceId = '00000000-0000-7000-8000-000000000001';
const missingId = '00000000-0000-7000-8000-000000000099';
const foreignId = '00000000-0000-7000-8000-0000000000aa';
const authHeader = `Bearer ${signAccessToken(userId)}`;
const validCreate = { brand: 'LG' };

const DTO_KEYS = ['id', 'brand', 'modelNumber', 'createdAt', 'updatedAt'];

const applianceDto: ApplianceDto = {
  id: applianceId,
  brand: 'LG',
  modelNumber: 'WW80T3040WW',
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

const serializedDto = {
  ...applianceDto,
  createdAt: applianceDto.createdAt.toISOString(),
  updatedAt: applianceDto.updatedAt.toISOString(),
};

const serializedPage = {
  ...pageDto,
  items: [serializedDto],
};

type Method = 'get' | 'post' | 'patch' | 'delete';
type RouteCase = { method: Method; path: string; body?: object };

function authorized(method: Method, path: string) {
  return request(app)[method](path).set('Authorization', authHeader);
}

function serviceMocks() {
  return [
    applianceService.createAppliance,
    applianceService.listAppliances,
    applianceService.getApplianceById,
    applianceService.updateAppliance,
    applianceService.deleteAppliance,
  ];
}

function expectNoServiceCalls(): void {
  for (const mock of serviceMocks()) {
    expect(mock).not.toHaveBeenCalled();
  }
}

function expectPublicApplianceData(data: Record<string, unknown>): void {
  expect(Object.keys(data).sort()).toEqual([...DTO_KEYS].sort());
  for (const field of ['category', 'nickname', 'userId']) {
    expect(data[field]).toBeUndefined();
  }
  expect(data.id).toBe(applianceId);
  expect(data.createdAt).toBe(applianceDto.createdAt.toISOString());
  expect(data.updatedAt).toBe(applianceDto.updatedAt.toISOString());
  expect(JSON.stringify(data)).not.toContain('forged');
}

beforeEach(() => {
  resetRateLimits();
  vi.resetAllMocks();
  vi.mocked(applianceService.createAppliance).mockResolvedValue(applianceDto);
  vi.mocked(applianceService.listAppliances).mockResolvedValue(pageDto);
  vi.mocked(applianceService.getApplianceById).mockResolvedValue(applianceDto);
  vi.mocked(applianceService.updateAppliance).mockResolvedValue(applianceDto);
  vi.mocked(applianceService.deleteAppliance).mockResolvedValue(undefined);
});

afterEach(() => {
  resetRateLimits();
});

describe('appliance routes require authentication', () => {
  const protectedRoutes: RouteCase[] = [
    { method: 'post', path: '/appliances', body: validCreate },
    { method: 'get', path: '/appliances?page=1&limit=20' },
    { method: 'get', path: `/appliances/${applianceId}` },
    { method: 'patch', path: `/appliances/${applianceId}`, body: { brand: 'LG' } },
    { method: 'delete', path: `/appliances/${applianceId}` },
  ];

  it.each(protectedRoutes)('rejects unauthenticated $method $path', async ({ method, path, body }) => {
    const call = request(app)[method](path);
    if (body) call.send(body);
    const response = await call;

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    expectNoServiceCalls();
  });

  it('rejects a malformed bearer token', async () => {
    const response = await request(app)
      .post('/appliances')
      .set('Authorization', 'Bearer not-a-token')
      .send(validCreate);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expectNoServiceCalls();
  });
});

describe('appliance routes authenticate before validation', () => {
  const invalidRequests: RouteCase[] = [
    { method: 'post', path: '/appliances', body: {} },
    { method: 'get', path: '/appliances?page=0' },
    { method: 'get', path: '/appliances/not-a-uuid' },
    { method: 'patch', path: '/appliances/not-a-uuid', body: {} },
    { method: 'delete', path: '/appliances/not-a-uuid' },
  ];

  it.each(invalidRequests)('returns auth failure for unauthenticated $method $path', async ({ method, path, body }) => {
    const call = request(app)[method](path);
    if (body) call.send(body);
    const response = await call;

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expectNoServiceCalls();
  });
});

describe('appliance route behaviour', () => {
  it('creates with validated input and the authenticated user id, returning 201', async () => {
    const response = await authorized('post', '/appliances').send({
      brand: '  LG  ',
      modelNumber: '',
      category: 'WASHING_MACHINE',
      nickname: '  Main washer  ',
      userId: 'forged-user-id',
      id: 'forged-appliance-id',
      createdAt: 'forged-timestamp',
      updatedAt: 'forged-timestamp',
    });

    expect(response.status).toBe(201);
    expect(applianceService.createAppliance).toHaveBeenCalledTimes(1);
    expect(applianceService.createAppliance).toHaveBeenCalledWith(userId, {
      brand: 'LG',
      modelNumber: null,
    });
    expect(response.body).toEqual({ success: true, data: serializedDto });
    expectPublicApplianceData(response.body.data as Record<string, unknown>);
  });

  it('lists with default pagination', async () => {
    const response = await authorized('get', '/appliances');

    expect(response.status).toBe(200);
    expect(applianceService.listAppliances).toHaveBeenCalledWith(userId, { page: 1, limit: 20 });
    expect(response.body).toEqual({ success: true, data: serializedPage });
  });

  it('lists with validated pagination values', async () => {
    const response = await authorized('get', '/appliances?page=3&limit=7');

    expect(response.status).toBe(200);
    expect(applianceService.listAppliances).toHaveBeenCalledWith(userId, { page: 3, limit: 7 });
    expect(response.body).toEqual({ success: true, data: serializedPage });
  });

  it('gets the requested appliance', async () => {
    const response = await authorized('get', `/appliances/${applianceId}`);

    expect(response.status).toBe(200);
    expect(applianceService.getApplianceById).toHaveBeenCalledWith(userId, { id: applianceId });
    expect(response.body).toEqual({ success: true, data: serializedDto });
  });

  it('updates with only validated fields and returns the updated DTO', async () => {
    const response = await authorized('patch', `/appliances/${applianceId}`).send({
      brand: '  Samsung  ',
      modelNumber: '  ',
      category: 'REFRIGERATOR',
      nickname: '  Laundry  ',
      userId: 'forged-user-id',
      id: 'forged-appliance-id',
      createdAt: 'forged-timestamp',
      updatedAt: 'forged-timestamp',
    });

    expect(response.status).toBe(200);
    expect(applianceService.updateAppliance).toHaveBeenCalledWith(userId, { id: applianceId }, {
      brand: 'Samsung',
      modelNumber: null,
    });
    expect(response.body).toEqual({ success: true, data: serializedDto });
    expectPublicApplianceData(response.body.data as Record<string, unknown>);
  });

  it('deletes through the service and returns the standard success response', async () => {
    const response = await authorized('delete', `/appliances/${applianceId}`);

    expect(response.status).toBe(200);
    expect(applianceService.deleteAppliance).toHaveBeenCalledWith(userId, { id: applianceId });
    expect(response.body).toEqual({ success: true, data: { message: 'Appliance deleted' } });
  });
});

describe('appliance route error mapping', () => {
  const notFound = new HttpError(404, 'APPLIANCE_NOT_FOUND', 'Appliance not found');

  it.each([
    { label: 'missing', id: missingId },
    { label: 'foreign-owned', id: foreignId },
  ])('returns the same 404 for a $label appliance on get, patch and delete', async ({ id }) => {
    vi.mocked(applianceService.getApplianceById).mockRejectedValueOnce(notFound);
    const fetched = await authorized('get', `/appliances/${id}`);

    vi.mocked(applianceService.updateAppliance).mockRejectedValueOnce(notFound);
    const updated = await authorized('patch', `/appliances/${id}`).send({ brand: 'LG' });

    vi.mocked(applianceService.deleteAppliance).mockRejectedValueOnce(notFound);
    const deleted = await authorized('delete', `/appliances/${id}`);

    for (const response of [fetched, updated, deleted]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: { code: 'APPLIANCE_NOT_FOUND', message: 'Appliance not found' },
      });
    }
  });
});

describe('appliance route validation', () => {
  it.each([
    { body: {} },
    { body: { ...validCreate, brand: '' } },
    { body: { ...validCreate, brand: 'bad\u0000value' } },
    { body: { ...validCreate, modelNumber: 'm'.repeat(81) } },
    { body: { category: 'WASHING_MACHINE' } },
    { body: { nickname: 'Kitchen fridge' } },
  ])('rejects an invalid create body', async ({ body }) => {
    const response = await authorized('post', '/appliances').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(applianceService.createAppliance).not.toHaveBeenCalled();
  });

  it.each(['page=0', 'limit=0', 'limit=101', 'limit=abc'])('rejects invalid list query %s', async (query) => {
    const response = await authorized('get', `/appliances?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(applianceService.listAppliances).not.toHaveBeenCalled();
  });

  it.each(['get', 'patch', 'delete'] as const)('rejects an invalid UUID on %s', async (method) => {
    const call = authorized(method, '/appliances/not-a-uuid');
    if (method === 'patch') call.send({ brand: 'LG' });
    const response = await call;

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expectNoServiceCalls();
  });

  it.each([
    {},
    { userId: 'forged-user-id' },
    { id: 'forged-appliance-id' },
    { category: 'WASHING_MACHINE' },
    { nickname: 'Kitchen fridge' },
    { createdAt: 'forged-timestamp' },
  ])('rejects a PATCH without editable fields', async (body) => {
    const response = await authorized('patch', `/appliances/${applianceId}`).send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(applianceService.updateAppliance).not.toHaveBeenCalled();
  });
});

describe('appliance write rate limiting and CORS', () => {
  it.each([
    { method: 'post' as const, path: '/appliances', body: validCreate as object, successStatus: 201 },
    { method: 'patch' as const, path: `/appliances/${applianceId}`, body: { brand: 'LG' } as object, successStatus: 200 },
    { method: 'delete' as const, path: `/appliances/${applianceId}`, successStatus: 200 },
  ])('rate limits repeated $method writes with RATE_LIMIT_AUTH_MAX', async ({ method, path, body, successStatus }) => {
    for (let index = 0; index < env.RATE_LIMIT_AUTH_MAX; index += 1) {
      const call = authorized(method, path);
      if (body) call.send(body);
      expect((await call).status).toBe(successStatus);
    }

    const blockedCall = authorized(method, path);
    if (body) blockedCall.send(body);
    const blocked = await blockedCall;

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('does not rate-limit appliance reads', async () => {
    for (let index = 0; index < env.RATE_LIMIT_AUTH_MAX + 1; index += 1) {
      const response = await authorized('get', '/appliances');
      expect(response.status).toBe(200);
    }
  });

  it('advertises every required method for an allowed CORS origin', async () => {
    const response = await request(app)
      .options('/appliances')
      .set('Origin', 'http://localhost:19006')
      .set('Access-Control-Request-Method', 'PATCH');

    expect(response.status).toBe(204);
    const methods = String(response.headers['access-control-allow-methods']);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(methods).toContain(method);
    }
    expectNoServiceCalls();
  });

  it('still rejects preflight from a non-allowlisted origin', async () => {
    const response = await request(app)
      .options('/appliances')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'DELETE');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expectNoServiceCalls();
  });
});
