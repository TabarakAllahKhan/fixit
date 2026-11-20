import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { signAccessToken } from '../../src/services/token.service.js';

// These tests exercise routing, auth and validation only. Provider-backed and
// database-backed behaviour is covered by unit/DB tests; no valid request here
// is allowed to reach the database.
const userId = '00000000-0000-7000-8000-000000000000';
const applianceId = '00000000-0000-7000-8000-000000000001';
const authHeader = `Bearer ${signAccessToken(userId)}`;

function authorized(method: 'get' | 'post', path: string) {
  return request(app)[method](path).set('Authorization', authHeader);
}

describe('diagnosis routes — authentication before validation', () => {
  it('rejects a request without a bearer token before checking the body', async () => {
    const response = await request(app).post('/diagnosis').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('rejects a malformed bearer token', async () => {
    const response = await request(app)
      .post('/diagnosis')
      .set('Authorization', 'Bearer not-a-token')
      .send({ applianceId, symptom: 'Not draining' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('diagnosis route validation', () => {
  it('rejects a missing applianceId and missing clues', async () => {
    const response = await authorized('post', '/diagnosis').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a session with neither symptom nor errorCode', async () => {
    const response = await authorized('post', '/diagnosis').send({ applianceId });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed applianceId', async () => {
    const response = await authorized('post', '/diagnosis').send({
      applianceId: 'not-a-uuid',
      symptom: 'Not draining',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed session id param', async () => {
    const response = await authorized('get', '/diagnosis/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects page below 1', async () => {
    const response = await authorized('get', '/diagnosis?page=0');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects limit above the maximum of 100', async () => {
    const response = await authorized('get', '/diagnosis?limit=101');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-numeric limit on the messages route', async () => {
    const response = await authorized('get', `/diagnosis/${userId}/messages?limit=abc`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a message without a requestId', async () => {
    const response = await authorized('post', `/diagnosis/${userId}/messages`).send({
      content: 'I cleaned the filter',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed requestId', async () => {
    const response = await authorized('post', `/diagnosis/${userId}/messages`).send({
      requestId: 'not-a-uuid',
      content: 'I cleaned the filter',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty message', async () => {
    const response = await authorized('post', `/diagnosis/${userId}/messages`).send({
      requestId: crypto.randomUUID(),
      content: '   ',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a fix confirmation without a challengeId', async () => {
    const response = await authorized('post', `/diagnosis/${userId}/confirm`).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects completion without explicit acknowledgement', async () => {
    const response = await authorized('post', `/diagnosis/${userId}/complete`).send({ acknowledged: false });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('diagnosis requires authentication on every route', () => {
  const protectedRoutes: Array<{ method: 'get' | 'post'; path: string; body?: object }> = [
    { method: 'post', path: '/diagnosis', body: { applianceId, symptom: 'Not draining' } },
    { method: 'get', path: '/diagnosis?page=1&limit=20' },
    { method: 'get', path: `/diagnosis/${userId}` },
    { method: 'get', path: `/diagnosis/${userId}/messages?page=1&limit=20` },
    {
      method: 'post',
      path: `/diagnosis/${userId}/messages`,
      body: { requestId: crypto.randomUUID(), content: 'I cleaned the filter' },
    },
    { method: 'post', path: `/diagnosis/${userId}/confirm`, body: { challengeId: 'server-issued' } },
    { method: 'post', path: `/diagnosis/${userId}/complete`, body: { acknowledged: true } },
  ];

  it.each(protectedRoutes)('rejects unauthenticated $method $path', async ({ method, path, body }) => {
    const call = request(app)[method](path);
    if (body) call.send(body);
    const response = await call;

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('diagnosis route fallbacks', () => {
  it('returns 404 for an unknown nested diagnosis route', async () => {
    const response = await authorized('get', `/diagnosis/${userId}/not-a-route`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });
});

describe('allowlisted CORS', () => {
  it('reflects an allowed origin on a normal response', async () => {
    const response = await request(app).get('/diagnosis').set('Origin', 'http://localhost:19006');

    expect(response.status).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:19006');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers.vary).toBe('Origin');
  });

  it('answers an allowed preflight request without reaching authentication', async () => {
    const response = await request(app)
      .options('/diagnosis')
      .set('Origin', 'http://localhost:19006')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:19006');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('does not allow a non-allowlisted browser origin', async () => {
    const response = await request(app)
      .get('/diagnosis')
      .set('Origin', 'https://evil.example');

    expect(response.status).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a preflight from a non-allowlisted origin', async () => {
    const response = await request(app)
      .options('/diagnosis')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});
