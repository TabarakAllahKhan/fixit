import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route contract for the Phase 2C/2D turn fields. The diagnosis service is
// mocked so no request reaches the database, AI or research providers.

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));

vi.mock('../../src/services/diagnosis.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/diagnosis.service.js')>();
  return { ...actual, sendMessage: sendMessageMock };
});

import { app } from '../../src/app.js';
import { signAccessToken } from '../../src/services/token.service.js';

const userId = '00000000-0000-7000-8000-000000000000';
const sessionId = '00000000-0000-7000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-0000000000a1';

function message(role: 'USER' | 'ASSISTANT') {
  return {
    id: role === 'USER' ? '00000000-0000-7000-8000-0000000000b1' : '00000000-0000-7000-8000-0000000000b2',
    sessionId,
    role,
    content: role === 'USER' ? 'Still not draining' : 'Try these safe checks.',
    createdAt: '2026-11-28T00:00:00.000Z',
  };
}

beforeEach(() => {
  sendMessageMock.mockReset();
});

describe('POST /diagnosis/:id/messages turn payload', () => {
  it('returns troubleshooting, research summary and a fix challenge in the success envelope', async () => {
    sendMessageMock.mockResolvedValue({
      userMessage: message('USER'),
      assistantMessage: message('ASSISTANT'),
      progress: {
        status: 'OPEN',
        verdict: null,
        outcome: 'READY_FOR_CONFIRMATION',
        fixChallenge: 'challenge-1',
        fixChallengeExpiresAt: '2026-11-28T00:10:00.000Z',
      },
      troubleshooting: { steps: ['Rinse the filter under running water.'], evidence: 'THIRD_PARTY_SUPPORTED' },
      research: {
        status: 'COMPLETED',
        confidence: 'THIRD_PARTY_SUPPORTED',
        reused: false,
        sources: [
          { title: 'Drain guide', url: 'https://www.lg.com/a', trust: 'MANUFACTURER', confidence: 'THIRD_PARTY_SUPPORTED' },
        ],
      },
      citations: [
        { title: 'Drain guide', url: 'https://www.lg.com/a', sourceKind: 'MANUFACTURER_PAGE', confidence: 'THIRD_PARTY_SUPPORTED' },
      ],
    });

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', `Bearer ${signAccessToken(userId)}`)
      .send({ requestId, content: 'Still not draining' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.progress.outcome).toBe('READY_FOR_CONFIRMATION');
    expect(response.body.data.troubleshooting.evidence).toBe('THIRD_PARTY_SUPPORTED');
    expect(response.body.data.research.sources[0].trust).toBe('MANUFACTURER');
    expect(response.body.data.citations[0].confidence).toBe('THIRD_PARTY_SUPPORTED');
    // The authenticated user id comes from the token, never the body.
    expect(sendMessageMock).toHaveBeenCalledWith(userId, { id: sessionId }, { requestId, content: 'Still not draining' });
  });

  it('returns a backend safety response with its categories', async () => {
    sendMessageMock.mockResolvedValue({
      userMessage: message('USER'),
      assistantMessage: { ...message('ASSISTANT'), content: 'A gas smell or leak is an emergency.' },
      progress: { status: 'OPEN', verdict: 'TECHNICIAN_REQUIRED', outcome: 'TECHNICIAN_REQUIRED' },
      safety: { categories: ['GAS'] },
      citations: [],
    });

    const response = await request(app)
      .post(`/diagnosis/${sessionId}/messages`)
      .set('Authorization', `Bearer ${signAccessToken(userId)}`)
      .send({ requestId, content: 'I smell gas' });

    expect(response.status).toBe(201);
    expect(response.body.data.safety).toEqual({ categories: ['GAS'] });
    expect(response.body.data.progress.verdict).toBe('TECHNICIAN_REQUIRED');
    expect(response.body.data).not.toHaveProperty('troubleshooting');
  });
});
