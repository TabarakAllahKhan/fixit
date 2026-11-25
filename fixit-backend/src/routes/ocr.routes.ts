import { Router } from 'express';
import { env } from '../config/env.js';
import { scanErrorCode } from '../controllers/ocr.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { uploadImage, validateImageFile } from '../middleware/upload.js';

export const ocrRouter = Router();

// OCR is comparatively expensive, so it reuses the configured auth write budget.
// Authentication runs first so anonymous callers cannot spend a bucket.
const ocrRateLimit = rateLimit({
  name: 'ocr-scan',
  max: env.RATE_LIMIT_AUTH_MAX,
  key: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

ocrRouter.post('/error-code', requireAuth, ocrRateLimit, uploadImage, validateImageFile, scanErrorCode);
