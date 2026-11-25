import { unlink } from 'node:fs/promises';
import type { NextFunction, Request, Response } from 'express';
import * as applianceScan from '../services/appliance-scan.service.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

export async function scanErrorCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = req.file;
  if (!file) {
    sendError(res, 400, 'VALIDATION_ERROR', 'image: An image file is required');
    return;
  }

  try {
    const result = await applianceScan.recognizeErrorCode(file.path);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  } finally {
    // The upload is never persisted; remove it after every attempt.
    await unlink(file.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.warn('Failed to remove temporary OCR upload', error);
    });
  }
}
