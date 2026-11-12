import { Router } from 'express';
import { checkDatabase } from '../config/database.js';
import {sendError,sendSuccess} from '../utils/apiResponse.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  try {
    await checkDatabase();
    sendSuccess(res,{status:"ok",database:"connected"});
  } catch (error) {
    // Log the real reason on the server only; never send it to the client.
    console.error('Health check failed:', error instanceof Error ? error.message : error);
    sendError(res,503,'DATABASE_UNAVAILABLE','DATABASE connection failed');
  }
});