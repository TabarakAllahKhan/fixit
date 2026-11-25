import { describe, expect, it } from 'vitest';
import {
  buildOcrEvidence,
  classifyEvidence,
  classifyOcrText,
  extractCandidates,
  normalizeErrorCodeToken,
  UNREADABLE_MESSAGE,
  type OcrEvidence,
  type OcrWordEvidence,
} from '../../src/services/appliance-scan.service.js';

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

function classifyWords(words: OcrWordEvidence[], pageConfidence = 80) {
  const evidence: OcrEvidence = {
    text: words.map((word) => word.text).join(' '),
    pageConfidence,
    words,
    hasBlockMetadata: true,
  };
  return classifyEvidence(evidence, extractCandidates(evidence));
}

function beside(left: OcrWordEvidence, right: OcrWordEvidence): OcrWordEvidence[] {
  const gap = left.bbox!.x1 + 6;
  return [
    left,
    { ...right, bbox: { ...right.bbox!, x0: gap, x1: gap + (right.bbox!.x1 - right.bbox!.x0) } },
  ];
}

describe('general numeric candidates', () => {
  it.each(['83', '01', '123'])('detects isolated numeric display %s', (code) => {
    expect(classifyWords([makeWord(code)])).toMatchObject({ status: 'DETECTED', code, candidates: [code] });
  });

  it('uses explicit error wording to anchor a number in text-only OCR', () => {
    expect(classifyOcrText('Error 83', 80)).toMatchObject({ status: 'DETECTED', code: '83' });
    expect(classifyOcrText('Fault: 01', 80)).toMatchObject({ status: 'DETECTED', code: '01' });
  });

  it.each(['83', '123', 'Display 83', '1', '12345'])(
    'does not invent a numeric code from unanchored text %s',
    (text) => {
      expect(classifyOcrText(text, 80)).toMatchObject({ status: 'UNREADABLE', code: null, candidates: [] });
    },
  );

  it('rejects a numeric candidate with weak symbol evidence', () => {
    const word = makeWord('83', {
      symbols: [
        { text: '8', confidence: 88 },
        { text: '3', confidence: 20 },
      ],
    });
    expect(classifyWords([word])).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });
});

describe('general alphabetic and alphanumeric candidates', () => {
  it.each(['FE', 'OE'])('detects canonical two-letter code %s from text only', (code) => {
    expect(classifyOcrText(code, 80)).toMatchObject({ status: 'DETECTED', code });
  });

  it.each([
    ['dE', 'dE'],
    ['DE', 'dE'],
    ['de', 'dE'],
    ['LE', 'LE'],
    ['HE', 'HE'],
    ['CE', 'CE'],
  ])('detects isolated two-letter code %s as %s with spatial evidence', (raw, expected) => {
    expect(classifyWords([makeWord(raw)])).toMatchObject({ status: 'DETECTED', code: expected });
  });

  it.each(['E1', 'E03', 'E123', 'F5', 'F01', 'F012', 'E83'])(
    'detects canonical alphanumeric code %s from text only',
    (code) => {
      expect(classifyOcrText(code, 80)).toMatchObject({ status: 'DETECTED', code, candidates: [code] });
    },
  );

  it.each([
    ['H1', 'H1'],
    ['H12', 'H12'],
    ['H123', 'H123'],
    ['C5', 'C5'],
    ['P3', 'P3'],
    ['U2', 'U2'],
    ['A4', 'A4'],
    ['h12', 'H12'],
  ])('detects isolated extended prefix code %s as %s', (raw, expected) => {
    expect(classifyWords([makeWord(raw)])).toMatchObject({ status: 'DETECTED', code: expected });
  });

  it.each(['E', 'FEED', 'EE', 'S5', 'XY', 'ON', 'OFF', 'MODE', '83E', '123E450'])(
    'does not treat %s as an error code',
    (token) => {
      expect(normalizeErrorCodeToken(token)).toBeNull();
    },
  );

  it.each([
    ['e03', 'E03'],
    ['f012', 'F012'],
    ['De', 'dE'],
    ['h12', 'H12'],
  ])('normalizes safe casing variation %s to %s', (raw, expected) => {
    expect(normalizeErrorCodeToken(raw)).toBe(expected);
  });
});

describe('position-aware OCR confusions', () => {
  it.each([
    ['EI', 'E1'],
    ['El', 'E1'],
    ['EO', 'E0'],
    ['ES', 'E5'],
    ['EB', 'E8'],
    ['EZ', 'E2'],
    ['EG', 'E6'],
    ['FI', 'F1'],
    ['F0I', 'F01'],
    ['0E', 'OE'],
  ])('normalizes %s to %s using digit-position confusions', (raw, expected) => {
    expect(normalizeErrorCodeToken(raw)).toBe(expected);
    expect(classifyWords([makeWord(raw)])).toMatchObject({ status: 'DETECTED', code: expected });
  });

  it('does not apply confusions in the prefix position', () => {
    expect(normalizeErrorCodeToken('SZ5')).toBeNull();
    expect(normalizeErrorCodeToken('GS5')).toBeNull();
  });

  it('uses a close Tesseract choice as a genuine alternative', () => {
    expect(
      classifyWords([makeWord('E03', { choices: [{ text: 'E05', confidence: 79 }] })]),
    ).toMatchObject({ status: 'AMBIGUOUS', code: null, candidates: ['E03', 'E05'] });
  });

  it('keeps multiple plausible readings ambiguous rather than guessing', () => {
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
    });
  });

  it('ignores distant or low-confidence choices', () => {
    expect(
      classifyWords([makeWord('E1', { confidence: 90, choices: [{ text: 'ES', confidence: 30 }] })]),
    ).toMatchObject({ status: 'DETECTED', code: 'E1' });
  });
});

describe('separated-token geometry', () => {
  it.each([
    ['E', '03', 'E03'],
    ['F', '5', 'F5'],
    ['H', '123', 'H123'],
  ])('composes %s + %s in reading order as %s', (prefix, digits, expected) => {
    const words = beside(makeWord(prefix), makeWord(digits, { bbox: { x0: 0, y0: 0, x1: 30, y1: 20 } }));
    expect(classifyWords(words)).toMatchObject({ status: 'DETECTED', code: expected, candidates: [expected] });
  });

  it('rejects a large horizontal gap', () => {
    const words = [
      makeWord('E', { bbox: { x0: 10, y0: 0, x1: 20, y1: 20 } }),
      makeWord('03', { bbox: { x0: 200, y0: 0, x1: 230, y1: 20 } }),
    ];
    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('rejects tokens on different lines', () => {
    const words = [
      makeWord('E', { bbox: { x0: 10, y0: 0, x1: 20, y1: 20 }, lineKey: '0:0' }),
      makeWord('03', { bbox: { x0: 26, y0: 50, x1: 56, y1: 70 }, lineKey: '0:1' }),
    ];
    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('rejects visibly misaligned tokens', () => {
    const words = [
      makeWord('E', { bbox: { x0: 10, y0: 0, x1: 20, y1: 20 } }),
      makeWord('03', { bbox: { x0: 26, y0: 20, x1: 56, y1: 40 } }),
    ];
    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it.each([
    ['83 E', '83 E'],
    ['83E', '83E'],
  ])('never reorders numeric-first reading %s', (_label, text) => {
    expect(classifyOcrText(text, 80)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('never composes numeric-first tokens with valid geometry', () => {
    const words = beside(
      makeWord('83', { bbox: { x0: 10, y0: 0, x1: 40, y1: 20 } }),
      makeWord('E', { bbox: { x0: 0, y0: 0, x1: 12, y1: 20 } }),
    );
    expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });
});

describe('false-positive protection', () => {
  it.each([
    'MODEL E03F01 S/N 123E450',
    'BOSCH WW80T3040WW E03F01',
    'SN12345678',
    'WW80T3040WW',
    'MODEL12345',
    'BOSCH',
    '83 E',
    '83E',
  ])('rejects identifier text %s', (text) => {
    expect(classifyOcrText(text, 80)).toMatchObject({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
      message: UNREADABLE_MESSAGE,
    });
  });

  it.each(['24°C', '36.5', '12:05', '1:30', '2026-11-24', '230V', '1400 W', '50 Hz', '1200 rpm'])(
    'rejects measurement-like text %s',
    (text) => {
      expect(classifyOcrText(text, 80)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
    },
  );

  it.each(['SN', 'S/N', 'SERIAL', 'MODEL', 'PN', 'PART', 'ID', 'LOT', 'REV', 'VER'])(
    'suppresses a code next to identifier label %s',
    (label) => {
      const words = [
        makeWord(label, { bbox: { x0: 0, y0: 0, x1: 30, y1: 20 } }),
        makeWord('12345678', { bbox: { x0: 35, y0: 0, x1: 95, y1: 20 } }),
        makeWord('E03', { bbox: { x0: 100, y0: 0, x1: 130, y1: 20 } }),
      ];
      expect(classifyWords(words)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
    },
  );

  it('suppresses an identifier on the immediately adjacent line but not a distant one', () => {
    const code = makeWord('E03', { bbox: { x0: 10, y0: 0, x1: 40, y1: 20 }, lineKey: '0:0' });
    const nearLabel = makeWord('SERIAL', { bbox: { x0: 10, y0: 25, x1: 60, y1: 45 }, lineKey: '0:1' });
    const farLabel = makeWord('SERIAL', { bbox: { x0: 10, y0: 85, x1: 60, y1: 105 }, lineKey: '0:3' });

    expect(classifyWords([code, nearLabel])).toMatchObject({ status: 'UNREADABLE', candidates: [] });
    expect(classifyWords([code, farLabel])).toMatchObject({ status: 'DETECTED', code: 'E03' });
  });

  it('suppresses numeric tokens next to units but keeps a genuine code on the same line', () => {
    const numeric = makeWord('24', { bbox: { x0: 0, y0: 0, x1: 25, y1: 20 } });
    const unit = makeWord('C', { bbox: { x0: 30, y0: 0, x1: 40, y1: 20 } });
    expect(classifyWords([numeric, unit])).toMatchObject({ status: 'UNREADABLE', candidates: [] });

    const code = makeWord('E03', { bbox: { x0: 60, y0: 0, x1: 90, y1: 20 } });
    expect(classifyWords([numeric, unit, code])).toMatchObject({ status: 'DETECTED', code: 'E03' });
  });

  it('does not reject a genuine numeric code merely because it has digits', () => {
    const words = beside(
      makeWord('Err', { bbox: { x0: 10, y0: 0, x1: 40, y1: 20 } }),
      makeWord('83', { bbox: { x0: 0, y0: 0, x1: 30, y1: 20 } }),
    );
    expect(classifyWords(words)).toMatchObject({ status: 'DETECTED', code: '83' });
  });
});

describe('missing and malformed metadata', () => {
  it('does not compose separated tokens without boxes', () => {
    expect(classifyOcrText('E 03', 80)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
  });

  it('does not promote extended codes without a line and box', () => {
    expect(classifyOcrText('H1', 80)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
    expect(classifyWords([makeWord('H1', { bbox: null })])).toMatchObject({ status: 'UNREADABLE' });
    expect(classifyWords([makeWord('H1', { lineKey: null })])).toMatchObject({ status: 'UNREADABLE' });
  });

  it('still reads canonical codes when block metadata is malformed', () => {
    const evidence = buildOcrEvidence('Display E03', 80, { paragraphs: 'invalid' });
    expect(evidence.hasBlockMetadata).toBe(false);
    expect(classifyEvidence(evidence, extractCandidates(evidence))).toMatchObject({
      status: 'DETECTED',
      code: 'E03',
    });
  });

  it('does not treat a malformed bbox as spatial evidence for numeric codes', () => {
    const evidence = buildOcrEvidence('83', 80, [
      {
        paragraphs: [{ lines: [{ words: [{ text: '83', confidence: 90, bbox: { x0: 'bad' } }] }] }],
      },
    ]);
    expect(evidence.words[0].bbox).toBeNull();
    expect(classifyEvidence(evidence, extractCandidates(evidence))).toMatchObject({
      status: 'UNREADABLE',
      candidates: [],
    });
  });
});

describe('Phase 1 regression cases remain intact', () => {
  it.each(['E1', 'E03', 'E123', 'F5', 'F01', 'F012', 'FE', 'OE'])(
    'still detects Phase 1 code %s',
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

  it('still detects a code embedded in surrounding text', () => {
    expect(classifyOcrText('Display says E03\nDoor locked', 72.6)).toMatchObject({
      status: 'DETECTED',
      code: 'E03',
    });
  });

  it('still preserves user-confirmable ambiguity and noise gates', () => {
    expect(classifyOcrText('E1 / F1 / E1', 65)).toMatchObject({
      status: 'AMBIGUOUS',
      code: null,
      candidates: ['E1', 'F1'],
    });
    expect(classifyOcrText('E1 E1 E1', 65)).toMatchObject({ status: 'DETECTED', code: 'E1' });
    expect(classifyOcrText('E1 E2 E3 E4 E5 E6 E7 E8 E9 F1 F2', 90)).toMatchObject({
      status: 'UNREADABLE',
      code: null,
      candidates: [],
    });
  });

  it('keeps the existing page and word confidence gates', () => {
    expect(classifyOcrText('E1', 9)).toMatchObject({ status: 'UNREADABLE', candidates: [] });
    expect(classifyWords([makeWord('E1', { confidence: 15, symbols: [] })])).toMatchObject({
      status: 'UNREADABLE',
      candidates: [],
    });
  });
});
