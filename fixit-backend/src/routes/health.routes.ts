import { Router } from 'express';
import { checkDatabase } from '../config/database.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

export const healthRouter = Router();

// Liveness intentionally avoids the database: a process that can answer is
// running, even if a dependency is temporarily unavailable.
healthRouter.get('/live', (_req, res) => {
  sendSuccess(res, { status: 'ok' });
});

async function readiness(_req: unknown, res: Parameters<typeof sendSuccess>[0]): Promise<void> {
  try {
    await checkDatabase();
    sendSuccess(res, { status: 'ok', database: 'connected' });
  } catch (error) {
    // Log the real reason on the server only; never send it to the client.
    console.error('Health check failed:', error instanceof Error ? error.message : error);
    sendError(res, 503, 'DATABASE_UNAVAILABLE', 'DATABASE connection failed');
  }
}

healthRouter.get('/ready', (req, res) => {
  void readiness(req, res);
});

// Backward-compatible readiness endpoint for existing deployment probes.
healthRouter.get('/', (req, res) => {
  void readiness(req, res);
});
