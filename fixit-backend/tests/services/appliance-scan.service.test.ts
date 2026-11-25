import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNREADABLE_MESSAGE,
  buildOcrEvidence,
  classifyEvidence,
  classifyOcrText,
  extractCandidates,
  extractErrorCodeCandidates,
  normalizeErrorCodeToken,
  recognizeErrorCode,
  type OcrEvidence,
  type OcrWordEvidence,
} from '../../src/services/appliance-scan.service.js';

const { createWorkerMock, setParametersMock, recognizeMock, terminateMock } = vi.hoisted(() => ({
  createWorkerMock: vi.fn(),
  setParametersMock: vi.fn(),
  recognizeMock: vi.fn(),
  terminateMock: vi.fn(),
}));

// OCR tests are deterministic and offline: no Tesseract worker or traineddata
// download is started, and no external AI provider is contacted.
vi.mock('tesseract.js', () => ({
  default: {
    createWorker: createWorkerMock,
    OEM: { LSTM_ONLY: 1 },
    PSM: { SPARSE_TEXT: '11' },
  },
}));

function makeWord(text: string, overrides: Partial<OcrWordEvidence> = {}): OcrWordEvidence {
  return {
    text,
    confidence: 80,
    bbox: { x0: 0, y0: 0, x1: 20, y1: 20 },
    lineKey: '0:0',
    blockIndex: 0,
    symbols: [...text].map((symbol) => ({ text: symbol, confidence: 85 })),
    choices: [],
    ...overrides,
  };
}

function evidenceFromWords(words: OcrWordEvidence[], pageConfidence = 80): OcrEvidence {
  return {
    text: words.map((word) => word.text).join(' '),
    pageConfidence,
    words,
    hasBlockMetadata: true,
  };
}

function classifyWords(words: OcrWordEvidence[], pageConfidence = 80) {
  const evidence = evidenceFromWords(words, pageConfidence);
  return classifyEvidence(evidence, extractCandidates(evidence));
}

beforeEach(() => {
  vi.resetAllMocks();
  createWorkerMock.mockResolvedValue({
    setParameters: setParametersMock,
    recognize: recognizeMock,
    terminate: terminateMock,
  });
  setParametersMock.mockResolvedValue(undefined);
  recognizeMock.mockResolvedValue({ data: { text: 'E1', confidence: 80 } });
  terminateMock.mockResolvedValue(undefined);
});

describe('error-code normalization', () => {
  it.each(['E1', 'E03', 'E123', 'F5', 'F01', 'F012', 'FE', 'OE'])(
    'accepts canonical code %s',
    (code) => {
      expect(normalizeErrorCodeToken(code)).toBe(code);
    },
  );

  it.each(['H1', 'C5', 'P3', 'U2', 'A4', 'dE'])('recognizes extended form %s', (code) => {
    expect(normalizeErrorCodeToken(code)).toBe(code);
  });

  it.each([
    ['EI', 'E1'],
    ['FI', 'F1'],
    ['ES', 'E5'],
    ['FS', 'F5'],
    ['EB', 'E8'],
    ['FB', 'F8'],
    ['EO', 'E0'],
    ['0E', 'OE'],
    ['E0I', 'E01'],
  ])('normalizes positional OCR confusion %s to %s', (raw, expected) => {
    expect(normalizeErrorCodeToken(raw)).toBe(expected);
  });

  it.each(['BOSCH', 'WW80T3040WW', 'SN12345678', '12345', 'E', 'XYZ', 'EE', 'FEE', '01', 'S5'])(
    'ignores non-code text %s instead of guessing',
    (token) => {
      expect(normalizeErrorCodeToken(token)).toBeNull();
    },
  );

  it('extracts only code-shaped tokens from mixed appliance text', () => {
    expect(extractErrorCodeCandidates('BOSCH WW80T3040WW  E1  S/N 12345678')).toEqual(['E1']);
  });

  it('ignores code-shaped substrings inside model or serial numbers', () => {
    expect(extractErrorCodeCandidates('MODEL E03F01 S/N 123E450')).toEqual([]);
  });
});

describe('canonical pattern extraction', () => {
  it.each(['E1', 'E03', 'E123', 'F5', 'F01', 'F012', 'FE', 'OE'])(
    'detects %s from text-only OCR',
    (code) => {
      expect(classifyOcrText(code, 80)).toEqual({
        status: 'DETECTED',
        code,
        candidates: [code],
        message: null,
        ocrConfidence: 80,
      });
    },
  );

  it('detects a canonical code embedded in surrounding text', () => {
    expect(classifyOcrText('Display says E03\nDoor locked', 72.6)).toEqual({
      status: 'DETECTED',
      code: 'E03',
      candidates: ['E03'],
      message: null,
      ocrConfidence: 73,
    });
  });
});

describe('extended pattern extraction', () => {
  it.each(['H1', 'C5', 'P3', 'U2', 'A4'])(
    'detects isolated extended form %s with block evidence',
    (code) => {
      expect(classifyWords([makeWord(code)])).toMatchObject({
        status: 'DETECTED',
        code,
        candidates: [code],
      });
    },
  );

  it('preserves the meaningful casing of dE', () => {
    expect(classifyWords([makeWord('dE')])).toMatchObject({
      status: 'DETECTED',
      code: 'dE',
      candidates: ['dE'],
    });
    expect(classifyWords([makeWord('dE')]).code).not.toBe('0E');
    expect(classifyWords([makeWord('dE')]).code).not.toBe('OE');
  });

  it('does not promote extended forms without spatial evidence', () => {
    expect(classifyOcrText('H1', 80).status).toBe('UNREADABLE');
    expect(classifyWords([makeWord('H1', { bbox: null })])).toMatchObject({
      status: 'UNREADABLE',
      candidates: [],
    });
    expect(classifyWords([makeWord('H1', { lineKey: null })])).toMatchObject({
      status: 'UNREADABLE',
      candidates: [],
    });
  });

  it('requires extended forms to be isolated on the display line', () => {
    const words = [
      makeWord('H1', { bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } }),
      makeWord('X', { bbox: { x0: 25, y0: 0, x1: 40, y1: 20 } }),
    ];

    expect(classifyWords(words).status).toBe('UNREADABLE');
  });
});

describe('separated token extraction', () => {
  it('combines E and 03 when bboxes are close and aligned', () => {
    const words = [
      makeWord('E', { bbox: { x0: 10, y0: 0, x1: 20, y1: 20 } }),
      makeWord('03', { bbox: { x0: 26, y0: 0, x1: 56, y1: 20 } }),
    ];

    expect(classifyWords(words)).toMatchObject({
      status: 'DETECTED',
      code: 'E03',
      candidates: ['E03'],
    });
  });

  it('does not combine E and 03 separated by a large gap', () => {
    const words = [
      makeWord('E', { bbox: { x0: 10, y0: 0, x1: 20, y1: 20 } }),
      makeWord('03', { bbox: { x0: 200, y0: 0, x1: 230, y1: 20 } }),
    ];

    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('does not combine E and 03 from different lines', () => {
    const words = [
      makeWord('E', { bbox: { x0: 10, y0: 0, x1: 20, y1: 20 }, lineKey: '0:0' }),
      makeWord('03', { bbox: { x0: 26, y0: 50, x1: 56, y1: 70 }, lineKey: '0:1' }),
    ];

    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('never reorders the reported 83 E case', () => {
    const words = [
      makeWord('83', { bbox: { x0: 10, y0: 0, x1: 40, y1: 20 } }),
      makeWord('E', { bbox: { x0: 46, y0: 0, x1: 56, y1: 20 } }),
    ];

    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
    expect(classifyOcrText('83 E', 80)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('does not turn the single token 83E into a code', () => {
    expect(classifyOcrText('83E', 80)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('can consider an actual E83 reading independently', () => {
    expect(classifyOcrText('E83', 80)).toMatchObject({ status: 'DETECTED', code: 'E83' });
  });
});

describe('false-positive prevention', () => {
  it.each([
    'MODEL E03F01 S/N 123E450',
    'BOSCH WW80T3040WW E03F01',
    'SN12345678',
    '24°C',
    '36.5',
    '12:05',
    '1:30',
    '83 E',
    '83E',
  ])('returns unreadable for unrelated display text %s', (text) => {
    expect(classifyOcrText(text, 80)).toMatchObject({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
    });
  });

  it('suppresses a code-shaped token next to serial-number context', () => {
    const words = [
      makeWord('SN', { bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } }),
      makeWord('12345678', { bbox: { x0: 25, y0: 0, x1: 100, y1: 20 } }),
      makeWord('E03', { bbox: { x0: 105, y0: 0, x1: 130, y1: 20 } }),
    ];

    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('suppresses a code-shaped token next to a long model-like identifier', () => {
    const words = [
      makeWord('MODEL', { bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }),
      makeWord('WW80T3040WW', { bbox: { x0: 55, y0: 0, x1: 150, y1: 20 } }),
      makeWord('F01', { bbox: { x0: 155, y0: 0, x1: 180, y1: 20 } }),
    ];

    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('does not report more than ten candidates as a usable reading', () => {
    const noisyText = 'E1 E2 E3 E4 E5 E6 E7 E8 E9 F1 F2';

    expect(classifyOcrText(noisyText, 90)).toMatchObject({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
    });
  });
});

describe('evidence-based normalization', () => {
  it.each([
    ['EI', 'E1'],
    ['ES', 'E5'],
    ['EB', 'E8'],
    ['EO', 'E0'],
    ['FI', 'F1'],
  ])('normalizes %s to %s using positional rules', (raw, expected) => {
    expect(classifyWords([makeWord(raw)])).toMatchObject({
      status: 'DETECTED',
      code: expected,
      candidates: [expected],
    });
  });

  it('uses a close Tesseract word choice as an alternative reading', () => {
    const word = makeWord('EI', {
      confidence: 70,
      choices: [{ text: 'E1', confidence: 68 }],
    });

    expect(classifyWords([word])).toMatchObject({ status: 'DETECTED', code: 'E1' });
  });

  it('returns AMBIGUOUS when close alternatives remain plausible', () => {
    const word = makeWord('EI', {
      confidence: 70,
      choices: [
        { text: 'E1', confidence: 69 },
        { text: 'ES', confidence: 67 },
      ],
    });

    expect(classifyWords([word])).toMatchObject({
      status: 'AMBIGUOUS',
      code: null,
      candidates: ['E1', 'E5'],
      message: 'More than one possible error code was found. Please enter the code shown on the display.',
    });
  });

  it('does not use a distant or weak word choice', () => {
    const word = makeWord('EI', {
      confidence: 90,
      choices: [{ text: 'ES', confidence: 30 }],
    });

    expect(classifyWords([word])).toMatchObject({ status: 'DETECTED', code: 'E1' });
  });
});

describe('OCR evidence handling', () => {
  it('preserves raw text, confidence, boxes, lines, symbols and choices internally', () => {
    const evidence = buildOcrEvidence(
      'E1',
      72.6,
      [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    {
                      text: 'E1',
                      confidence: 80,
                      bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
                      symbols: [
                        { text: 'E', confidence: 79 },
                        { text: '1', confidence: 81 },
                      ],
                      choices: [{ text: 'EI', confidence: 70 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    );

    expect(evidence.text).toBe('E1');
    expect(evidence.pageConfidence).toBe(73);
    expect(evidence.hasBlockMetadata).toBe(true);
    expect(evidence.words).toHaveLength(1);
    expect(evidence.words[0]).toMatchObject({
      text: 'E1',
      confidence: 80,
      bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
      lineKey: '0:0',
      blockIndex: 0,
      symbols: [
        { text: 'E', confidence: 79 },
        { text: '1', confidence: 81 },
      ],
      choices: [{ text: 'EI', confidence: 70 }],
    });
  });

  it('falls back to raw tokens when block metadata is missing or malformed', () => {
    const evidence = buildOcrEvidence('Display E1', 80, { paragraphs: 'bad' });

    expect(evidence.hasBlockMetadata).toBe(false);
    expect(evidence.words.map((word) => word.text)).toEqual(['Display', 'E1']);
    expect(evidence.words[1]).toMatchObject({
      confidence: null,
      bbox: null,
      lineKey: null,
      blockIndex: null,
      symbols: [],
      choices: [],
    });
    expect(classifyEvidence(evidence, extractCandidates(evidence))).toMatchObject({
      status: 'DETECTED',
      code: 'E1',
    });
  });

  it('handles a missing word confidence conservatively', () => {
    expect(classifyWords([makeWord('E1', { confidence: null, symbols: [] })])).toMatchObject({
      status: 'DETECTED',
      code: 'E1',
    });
  });

  it('handles missing bounding boxes without inventing spatial evidence', () => {
    expect(classifyWords([makeWord('E1', { bbox: null })])).toMatchObject({
      status: 'DETECTED',
      code: 'E1',
    });
  });

  it('returns unreadable for empty OCR output', () => {
    expect(classifyOcrText('   \n  ', 61)).toEqual({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
      ocrConfidence: 61,
    });
  });

  it('keeps the existing low page-confidence guard', () => {
    expect(classifyOcrText('E1', 9)).toMatchObject({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
    });
  });

  it('does not detect a code with low word confidence', () => {
    expect(classifyWords([makeWord('E1', { confidence: 15, symbols: [] })])).toMatchObject({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
    });
  });

  it('does not detect a code with a low-confidence symbol', () => {
    const word = makeWord('E1', {
      symbols: [
        { text: 'E', confidence: 10 },
        { text: '1', confidence: 90 },
      ],
    });

    expect(classifyWords([word])).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('returns all distinct candidates when the reading is ambiguous', () => {
    expect(classifyOcrText('E1 / F1 / E1', 65)).toMatchObject({
      status: 'AMBIGUOUS',
      code: null,
      candidates: ['E1', 'F1'],
      message: 'More than one possible error code was found. Please enter the code shown on the display.',
    });
  });

  it('deduplicates repeated candidates', () => {
    expect(classifyOcrText('E1 E1 E1', 65)).toMatchObject({
      status: 'DETECTED',
      code: 'E1',
      candidates: ['E1'],
    });
  });

  it('keeps confidence inside the documented 0-100 range', () => {
    expect(classifyOcrText('E1', -1).ocrConfidence).toBe(0);
    expect(classifyOcrText('E1', 150).ocrConfidence).toBe(100);
    expect(classifyOcrText('E1', Number.NaN).ocrConfidence).toBe(0);
  });
});

describe('recognizeErrorCode', () => {
  it('runs local OCR with block output and terminates the worker after a successful read', async () => {
    const result = await recognizeErrorCode('C:\\temp\\display.png');

    expect(createWorkerMock).toHaveBeenCalledWith('eng', 1, expect.objectContaining({ cachePath: expect.any(String) }));
    expect(setParametersMock).toHaveBeenCalledWith({ tessedit_pageseg_mode: '11' });
    expect(recognizeMock).toHaveBeenCalledWith('C:\\temp\\display.png', {}, { blocks: true });
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'DETECTED', code: 'E1' });
  });

  it('classifies from block evidence when raw text is empty', async () => {
    recognizeMock.mockResolvedValueOnce({
      data: {
        text: '',
        confidence: 80,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      {
                        text: 'F012',
                        confidence: 85,
                        bbox: { x0: 0, y0: 0, x1: 40, y1: 20 },
                        symbols: [],
                        choices: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await expect(recognizeErrorCode('C:\\temp\\display.png')).resolves.toMatchObject({
      status: 'DETECTED',
      code: 'F012',
    });
  });

  it('terminates the worker when OCR fails', async () => {
    recognizeMock.mockRejectedValueOnce(new Error('worker failed'));

    await expect(recognizeErrorCode('C:\\temp\\display.png')).rejects.toThrow('worker failed');
    expect(terminateMock).toHaveBeenCalledTimes(1);
  });

  it('propagates worker startup failures without a worker to terminate', async () => {
    createWorkerMock.mockRejectedValueOnce(new Error('traineddata unavailable'));

    await expect(recognizeErrorCode('C:\\temp\\display.png')).rejects.toThrow('traineddata unavailable');
    expect(terminateMock).not.toHaveBeenCalled();
  });
});
