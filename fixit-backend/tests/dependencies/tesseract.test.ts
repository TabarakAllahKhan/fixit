import { describe, expect, it } from 'vitest';
import Tesseract from 'tesseract.js';

// Verifies that the backend-compatible Tesseract.js API imports under the
// project's module settings. No worker is created and no traineddata is fetched.
describe('tesseract.js dependency', () => {
  it('exposes the Node worker API used by the OCR service', () => {
    expect(typeof Tesseract.createWorker).toBe('function');
    expect(Tesseract.OEM.LSTM_ONLY).toBe(1);
    expect(Tesseract.PSM.SPARSE_TEXT).toBe('11');
  });

  it('runs on a Node.js version supported by Tesseract.js v7', () => {
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(16);
  });
});
