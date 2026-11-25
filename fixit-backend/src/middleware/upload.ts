import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { sendError } from '../utils/apiResponse.js';
import { HttpError } from '../utils/httpError.js';

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const MIME_TYPE_LIST = 'JPEG, PNG and WebP';

function hasSupportedSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

// Uploads go straight to the OS temp directory with an unpredictable name.
// Nothing is written under the project, and the controller removes the file in
// a finally block after OCR (including on failures).
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpdir()),
    filename: (_req, file, cb) => {
      const extension = ALLOWED_MIME_TYPES.get(file.mimetype) ?? '.tmp';
      cb(null, `fixit-ocr-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new HttpError(400, 'VALIDATION_ERROR', `image: Only ${MIME_TYPE_LIST} images are accepted`));
      return;
    }
    cb(null, true);
  },
});

const singleImage = upload.single('image');

export function uploadImage(req: Request, res: Response, next: NextFunction): void {
  singleImage(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new HttpError(
            400,
            'VALIDATION_ERROR',
            `image: File too large. Maximum size is ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)} MB`,
          ),
        );
        return;
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
        next(new HttpError(400, 'VALIDATION_ERROR', "image: Only one file is accepted in the 'image' field"));
        return;
      }
      next(new HttpError(400, 'VALIDATION_ERROR', 'image: Invalid upload'));
      return;
    }
    next(error);
  });
}

// MIME types are client-supplied, so also check the file signature before OCR.
// A rejected file is removed here because the controller will not be reached.
export async function validateImageFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = req.file;
  if (!file) {
    sendError(res, 400, 'VALIDATION_ERROR', 'image: An image file is required');
    return;
  }

  const buffer = await readFile(file.path);
  if (!hasSupportedSignature(buffer, file.mimetype)) {
    await unlink(file.path).catch(() => undefined);
    sendError(res, 400, 'VALIDATION_ERROR', `image: File content does not match a ${MIME_TYPE_LIST} image`);
    return;
  }

  next();
}
