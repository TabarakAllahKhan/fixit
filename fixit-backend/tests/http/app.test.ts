import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { resetRateLimits } from '../../src/middleware/rateLimit.js';

// These tests exercise routing and middleware only. None of the chosen requests
// reaches a controller that touches PostgreSQL.
beforeEach(() => resetRateLimits());
afterEach(() => resetRateLimits());

describe('HTTP app smoke tests', () => {
  it('returns the standard error envelope for an unknown route', async () => {
    const response = await request(app).get('/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('rejects an invalid login body before the controller runs', async () => {
    const response = await request(app).post('/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('rejects a missing bearer token on a protected route', async () => {
    const response = await request(app).get('/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('rate limits repeated unauthenticated auth requests', async () => {
    for (let index = 0; index < 30; index += 1) {
      await request(app).post('/auth/login').send({});
    }

    const response = await request(app).post('/auth/login').send({});

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
  });
});
