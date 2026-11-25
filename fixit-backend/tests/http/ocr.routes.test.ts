import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.js';
import { resetRateLimits } from '../../src/middleware/rateLimit.js';
import * as applianceScan from '../../src/services/appliance-scan.service.js';
import { signAccessToken } from '../../src/services/token.service.js';

vi.mock('../../src/services/appliance-scan.service.js', () => ({
  recognizeErrorCode: vi.fn(),
}));

const userId = '00000000-0000-7000-8000-000000000000';
const authHeader = `Bearer ${signAccessToken(userId)}`;
const recognizeErrorCodeMock = vi.mocked(applianceScan.recognizeErrorCode);

const UNREADABLE_MESSAGE =
  "We couldn't clearly read the error code. Please upload a clearer image with the display text in focus.";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([pngSignature, Buffer.alloc(48, 1)]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const oversizedPng = Buffer.concat([pngSignature, Buffer.alloc(5 * 1024 * 1024)]);

function ocrTempFileNames(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('fixit-ocr-'));
}

function authorizedUpload() {
  return request(app).post('/ocr/error-code').set('Authorization', authHeader);
}

function attachImage(buffer: Buffer, filename: string, contentType: string) {
  return authorizedUpload().attach('image', buffer, { filename, contentType });
}

const detectedResult = {
  status: 'DETECTED' as const,
  code: 'E03',
  candidates: ['E03'],
  message: null,
  ocrConfidence: 78,
};

beforeEach(() => {
  resetRateLimits();
  vi.resetAllMocks();
  recognizeErrorCodeMock.mockResolvedValue(detectedResult);
});

afterEach(() => {
  resetRateLimits();
});

describe('OCR endpoint authentication', () => {
  it('requires a bearer token before parsing the upload', async () => {
    const response = await request(app)
      .post('/ocr/error-code')
      .attach('image', png, { filename: 'display.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token', async () => {
    const response = await request(app)
      .post('/ocr/error-code')
      .set('Authorization', 'Bearer not-a-token')
      .attach('image', png, { filename: 'display.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
  });
});

describe('OCR endpoint behaviour', () => {
  it('returns a detected code and deletes the temporary upload', async () => {
    const response = await attachImage(png, 'display.png', 'image/png');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: detectedResult });

    const tempPath = recognizeErrorCodeMock.mock.calls[0][0];
    expect(tempPath).toMatch(/fixit-ocr-[0-9a-f-]+\.png$/);
    await vi.waitFor(() => expect(existsSync(tempPath)).toBe(false));
  });

  it('accepts JPEG and WebP uploads', async () => {
    const jpegResponse = await attachImage(jpeg, 'display.jpg', 'image/jpeg');
    const webpResponse = await attachImage(
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]),
      'display.webp',
      'image/webp',
    );

    expect(jpegResponse.status).toBe(200);
    expect(webpResponse.status).toBe(200);
  });

  it('returns the unreadable result with the required retry message', async () => {
    recognizeErrorCodeMock.mockResolvedValue({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
      ocrConfidence: 12,
    });

    const response = await attachImage(png, 'blurry.png', 'image/png');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
      ocrConfidence: 12,
    });
  });

  it('returns ambiguous candidates without choosing a code', async () => {
    recognizeErrorCodeMock.mockResolvedValue({
      status: 'AMBIGUOUS',
      code: null,
      candidates: ['E1', 'F1'],
      message: 'More than one possible error code was found. Please enter the code shown on the display.',
      ocrConfidence: 64,
    });

    const response = await attachImage(png, 'ambiguous.png', 'image/png');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('AMBIGUOUS');
    expect(response.body.data.code).toBeNull();
    expect(response.body.data.candidates).toEqual(['E1', 'F1']);
  });

  it('deletes the temporary upload when OCR fails', async () => {
    recognizeErrorCodeMock.mockRejectedValueOnce(new Error('OCR unavailable'));

    const response = await attachImage(png, 'display.png', 'image/png');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    const tempPath = recognizeErrorCodeMock.mock.calls[0][0];
    await vi.waitFor(() => expect(existsSync(tempPath)).toBe(false));
  });
});

describe('OCR endpoint validation', () => {
  it('requires the image field', async () => {
    const response = await authorizedUpload().field('other', 'value');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'image: An image file is required',
    });
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
  });

  it('rejects an unexpected upload field as a validation error', async () => {
    const response = await authorizedUpload().attach('photo', png, {
      filename: 'display.png',
      contentType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: "image: Only one file is accepted in the 'image' field",
    });
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported MIME types', async () => {
    const response = await attachImage(Buffer.from('not an image'), 'notes.txt', 'text/plain');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'image: Only JPEG, PNG and WebP images are accepted',
    });
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
  });

  it('rejects files whose content does not match the declared image type and cleans up', async () => {
    const before = new Set(ocrTempFileNames());

    const response = await attachImage(jpeg, 'mislabeled.png', 'image/png');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'image: File content does not match a JPEG, PNG and WebP image',
    });
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ocrTempFileNames().filter((name) => !before.has(name))).toEqual([]));
  });

  it('rejects files larger than 5 MB', async () => {
    const response = await attachImage(oversizedPng, 'huge.png', 'image/png');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'image: File too large. Maximum size is 5 MB',
    });
    expect(recognizeErrorCodeMock).not.toHaveBeenCalled();
  });
});
