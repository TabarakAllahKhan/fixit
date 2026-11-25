import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Tesseract from 'tesseract.js';
import type { OcrDetectionData } from '../types/ocr.dto.js';

export const UNREADABLE_MESSAGE =
  "We couldn't clearly read the error code. Please upload a clearer image with the display text in focus.";

const AMBIGUOUS_MESSAGE = 'More than one possible error code was found. Please enter the code shown on the display.';

// Kept from the existing implementation. It is a coarse garbage filter only,
// never a way to rank or choose between candidate codes.
const MIN_PAGE_CONFIDENCE = 20;
// Word/symbol confidence below this is treated as unreliable.
const MIN_WORD_CONFIDENCE = 40;
// Numeric-only readings have no letter to anchor them, so they need stronger
// evidence than E/F-style codes before they can be reported.
const MIN_NUMERIC_CONFIDENCE = 60;
// A Tesseract word alternative is considered genuinely ambiguous only when it
// is close to the top reading and itself plausible.
const CHOICE_CONFIDENCE_FLOOR = 20;
const CHOICE_CONFIDENCE_GAP = 15;
const MAX_CANDIDATES = 10;
// A rendered space plus Tesseract's word padding is a little over one glyph
// high. Beyond that, tokens are treated as unrelated parts of the display.
const MAX_SEPARATED_GAP_RATIO = 1.25;
const MAX_SEPARATED_MISALIGNMENT_RATIO = 0.6;

const TESSDATA_CACHE_DIR = join(tmpdir(), 'fixit-ocr-tessdata');

// ---------------------------------------------------------------------------
// Internal OCR evidence. This never leaves the service.
// ---------------------------------------------------------------------------

export interface OcrBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrSymbolEvidence {
  text: string;
  confidence: number | null;
}

export interface OcrChoiceEvidence {
  text: string;
  confidence: number;
}

export interface OcrWordEvidence {
  text: string;
  confidence: number | null;
  bbox: OcrBbox | null;
  lineKey: string | null;
  blockIndex: number | null;
  symbols: OcrSymbolEvidence[];
  choices: OcrChoiceEvidence[];
}

export interface OcrEvidence {
  text: string;
  pageConfidence: number;
  words: OcrWordEvidence[];
  // True only when usable block/line metadata was supplied by Tesseract.
  hasBlockMetadata: boolean;
}

export type CandidateTier = 1 | 2 | 3 | 4;

export interface OcrCandidate {
  value: string;
  tier: CandidateTier;
  confidence: number | null;
  minSymbolConfidence: number | null;
  // Distinct normalized readings for the same source word, including `value`.
  variants: string[];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampConfidence(value: unknown): number {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.min(100, Math.max(0, Math.round(number)));
}

function parseBbox(value: unknown): OcrBbox | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const x0 = finiteNumber(raw.x0);
  const y0 = finiteNumber(raw.y0);
  const x1 = finiteNumber(raw.x1);
  const y1 = finiteNumber(raw.y1);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  return { x0, y0, x1, y1 };
}

function parseSymbols(value: unknown): OcrSymbolEvidence[] {
  if (!Array.isArray(value)) return [];
  const symbols: OcrSymbolEvidence[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== 'string' || item.text.length === 0) continue;
    symbols.push({ text: item.text, confidence: finiteNumber(item.confidence) });
  }
  return symbols;
}

function parseChoices(value: unknown): OcrChoiceEvidence[] {
  if (!Array.isArray(value)) return [];
  const choices: OcrChoiceEvidence[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== 'string' || item.text.length === 0) continue;
    const confidence = finiteNumber(item.confidence);
    if (confidence === null) continue;
    choices.push({ text: item.text, confidence: clampConfidence(confidence) });
  }
  return choices;
}

function parseWordsFromBlocks(blocks: unknown): OcrWordEvidence[] {
  const words: OcrWordEvidence[] = [];
  if (!Array.isArray(blocks)) return words;

  blocks.forEach((rawBlock: unknown, blockIndex: number) => {
    if (!rawBlock || typeof rawBlock !== 'object') return;
    const block = rawBlock as Record<string, unknown>;
    const paragraphs = Array.isArray(block.paragraphs) ? block.paragraphs : [];

    paragraphs.forEach((rawParagraph: unknown) => {
      if (!rawParagraph || typeof rawParagraph !== 'object') return;
      const paragraph = rawParagraph as Record<string, unknown>;
      const lines = Array.isArray(paragraph.lines) ? paragraph.lines : [];

      lines.forEach((rawLine: unknown, lineIndex: number) => {
        if (!rawLine || typeof rawLine !== 'object') return;
        const line = rawLine as Record<string, unknown>;
        const lineWords = Array.isArray(line.words) ? line.words : [];

        lineWords.forEach((rawWord: unknown) => {
          if (!rawWord || typeof rawWord !== 'object') return;
          const word = rawWord as Record<string, unknown>;
          if (typeof word.text !== 'string') return;
          const text = word.text.trim();
          if (!text) return;

          words.push({
            text,
            confidence: finiteNumber(word.confidence),
            bbox: parseBbox(word.bbox),
            lineKey: `${blockIndex}:${lineIndex}`,
            blockIndex,
            symbols: parseSymbols(word.symbols),
            choices: parseChoices(word.choices),
          });
        });
      });
    });
  });

  return words;
}

function parseWordsFromText(text: string): OcrWordEvidence[] {
  const matches = text.match(/[A-Za-z0-9]+/g) ?? [];
  return matches.map((token) => ({
    text: token,
    confidence: null,
    bbox: null,
    lineKey: null,
    blockIndex: null,
    symbols: [],
    choices: [],
  }));
}

export function buildOcrEvidence(text: unknown, confidence: unknown, blocks: unknown): OcrEvidence {
  const rawText = typeof text === 'string' ? text : '';
  const blockWords = parseWordsFromBlocks(blocks);

  return {
    text: rawText,
    pageConfidence: clampConfidence(confidence),
    words: blockWords.length > 0 ? blockWords : parseWordsFromText(rawText),
    hasBlockMetadata: blockWords.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Reusable extraction rules. Each rule is small and independently testable;
// no huge regex and no manufacturer-specific code catalogue.
// ---------------------------------------------------------------------------

// Seven-segment/low-resolution confusions. They are applied only in a digit
// tail position of an otherwise well-formed code, at most one per reading,
// and only to characters Tesseract actually emitted in that position.
const DIGIT_CONFUSIONS: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
// Letters that may introduce an error-code on displays. E/F are the canonical
// family; the rest require spatial isolation (tier 2) rather than text alone.
const CODE_PREFIXES = new Set(['E', 'F', 'H', 'C', 'P', 'U', 'A', 'L', 'O']);
const ALPHA_CODE_PREFIXES = new Set([...CODE_PREFIXES, 'D']);
const IDENTIFIER_LABELS = new Set([
  'SN', 'S/N', 'SERIAL', 'SER', 'SERIALNO', 'SERIALNUMBER', 'MODEL', 'MOD', 'NO',
  'PN', 'P/N', 'PART', 'ID', 'LOT', 'REV', 'VER', 'VERSION', 'SKU', 'REF',
]);
// Short display words that are states or settings, not error codes.
const NON_CODE_LABELS = new Set([
  'ON', 'OFF', 'HI', 'LOW', 'LO', 'OK', 'MODE', 'AUTO', 'SET', 'LOCK', 'SELECT',
  'START', 'STOP', 'RESET', 'MENU', 'TIME', 'DATE', 'TEMP', 'POWER', 'WASH',
  'SPIN', 'RINSE', 'DRY', 'PAUSE', 'YES', 'NO', 'AMP', 'VOLT',
]);
const UNIT_LABELS = new Set([
  'C', 'F', 'V', 'A', 'W', 'HZ', 'MA', 'KW', 'KWH', 'RPM', 'MIN', 'SEC', 'H',
  'HR', 'HRS', 'KG', 'L', 'ML', 'PCT', 'DEG', '°C', '°F',
]);
const ERROR_CONTEXT_RE = /\b(err|error|fault|faulty|code|alarm|fail|failure)\b/i;
// Decimal values, clock times, dates, temperatures and measurements.
const NON_ERROR_VALUE_RE =
  /\d+\s*[.:/-]\s*\d+|\b\d+\s*(?:°|deg)?\s*[cf]\b|\b\d+\s*(?:v|a|w|hz|ma|kw|kwh|rpm|min|sec|kg|l|h|hr|hrs|%)\b/i;

type ReadingKind = 'canonical' | 'extended' | 'numeric' | 'none';

interface TokenReading {
  kind: ReadingKind;
  tier: CandidateTier | null;
  values: string[];
}

const NO_READING: TokenReading = { kind: 'none', tier: null, values: [] };

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// Maps a digit tail to digits, allowing at most one seven-segment confusion so
// that a noisy token does not turn into an arbitrary number. Z/2 and G/6 are
// included, but only in this position-aware context.
function parseDigitTail(raw: string): string[] {
  const upper = raw.trim().toUpperCase();
  if (!/^[0-9ISBOZGL]{1,3}$/.test(upper)) return [];
  if (/^[0-9]{1,3}$/.test(upper)) return [upper];

  const values = new Set<string>();
  for (let index = 0; index < upper.length; index += 1) {
    const digit = DIGIT_CONFUSIONS[upper[index]];
    if (!digit) continue;
    values.add(`${upper.slice(0, index)}${digit}${upper.slice(index + 1)}`);
  }
  return [...values];
}

// Normalizes one OCR token without inventing a reading. Choices are handled
// separately so that evidence-backed alternatives stay visible as variants.
function parseDisplayToken(raw: string): TokenReading {
  const token = raw.trim();
  if (!token || /[^A-Za-z0-9]/.test(token)) return NO_READING;

  // dE is meaningful casing on some displays; never rewrite it to OE/0E.
  if (/^[dD][eE]$/.test(token)) return { kind: 'extended', tier: 2, values: ['dE'] };

  const upper = token.toUpperCase();
  if (upper === '0E' || upper === 'OE') return { kind: 'canonical', tier: 1, values: ['OE'] };
  if (upper === 'FE' || /^[EF][0-9]{1,3}$/.test(upper)) {
    return { kind: 'canonical', tier: 1, values: [upper] };
  }

  const canonicalTail = /^([EF])([0-9ISBOZGL]{1,3})$/.exec(upper);
  if (canonicalTail) {
    const values = parseDigitTail(canonicalTail[2]).map((digits) => `${canonicalTail[1]}${digits}`);
    if (values.length > 0) return { kind: 'canonical', tier: 1, values };
  }

  // "EE" is not a display code; the meaningful two-letter forms have a
  // distinct first character (FE/OE/LE/dE and the like).
  if (/^[A-Z]{2}$/.test(upper) && ALPHA_CODE_PREFIXES.has(upper[0]) && upper[0] !== 'E' && upper[1] === 'E') {
    return { kind: 'extended', tier: 2, values: [upper] };
  }

  if (/^[A-Z][0-9]{1,3}$/.test(upper) && CODE_PREFIXES.has(upper[0])) {
    return { kind: 'extended', tier: 2, values: [upper] };
  }

  const extendedTail = /^([A-Z])([0-9ISBOZGL]{1,3})$/.exec(upper);
  if (extendedTail && CODE_PREFIXES.has(extendedTail[1])) {
    const values = parseDigitTail(extendedTail[2]).map((digits) => `${extendedTail[1]}${digits}`);
    if (values.length > 0) return { kind: 'extended', tier: 2, values };
  }

  if (/^[0-9]{2,3}$/.test(upper)) return { kind: 'numeric', tier: 4, values: [upper] };

  return NO_READING;
}

function eligibleChoices(word: OcrWordEvidence): OcrChoiceEvidence[] {
  const wordConfidence = word.confidence;
  if (wordConfidence === null) return [];
  return word.choices.filter(
    (choice) =>
      choice.confidence >= CHOICE_CONFIDENCE_FLOOR &&
      Math.abs(choice.confidence - wordConfidence) <= CHOICE_CONFIDENCE_GAP,
  );
}

// Direct OCR readings plus close Tesseract alternatives for the requested
// tiers. Alternatives are never invented: each must itself be a valid code.
function variantsForTiers(word: OcrWordEvidence, tiers: CandidateTier[]): string[] {
  const readings = [parseDisplayToken(word.text), ...eligibleChoices(word).map((choice) => parseDisplayToken(choice.text))];
  return unique(
    readings
      .filter((reading) => reading.tier !== null && tiers.includes(reading.tier))
      .flatMap((reading) => reading.values),
  );
}

function wordHeight(word: OcrWordEvidence): number {
  if (!word.bbox) return 0;
  return Math.abs(word.bbox.y1 - word.bbox.y0);
}

function horizontalGap(left: OcrWordEvidence, right: OcrWordEvidence): number | null {
  if (!left.bbox || !right.bbox) return null;
  return right.bbox.x0 - left.bbox.x1;
}

function isNearby(left: OcrWordEvidence, right: OcrWordEvidence, maxGapRatio: number): boolean {
  const height = Math.max(wordHeight(left), wordHeight(right));
  if (height <= 0) return false;
  const forward = horizontalGap(left, right);
  const backward = horizontalGap(right, left);
  const tolerance = height * 0.2;
  return (
    (forward !== null && forward >= -tolerance && forward <= height * maxGapRatio) ||
    (backward !== null && backward >= -tolerance && backward <= height * maxGapRatio)
  );
}

function isVerticallyAligned(left: OcrWordEvidence, right: OcrWordEvidence, ratio: number): boolean {
  if (!left.bbox || !right.bbox) return false;
  const height = Math.max(wordHeight(left), wordHeight(right));
  if (height <= 0) return false;
  const leftCenter = (left.bbox.y0 + left.bbox.y1) / 2;
  const rightCenter = (right.bbox.y0 + right.bbox.y1) / 2;
  return Math.abs(leftCenter - rightCenter) <= height * ratio;
}

function isIsolated(word: OcrWordEvidence, words: OcrWordEvidence[]): boolean {
  if (!word.bbox || word.lineKey === null) return false;
  return !words.some(
    (other) => other !== word && other.lineKey === word.lineKey && isNearby(word, other, 0.5),
  );
}

function isIdentifierLike(text: string): boolean {
  const upper = text.toUpperCase();
  return (
    IDENTIFIER_LABELS.has(upper) ||
    (/^[A-Z0-9]{5,}$/.test(upper) && /[A-Z]/.test(upper) && /[0-9]/.test(upper)) ||
    /^[0-9]{6,}$/.test(upper)
  );
}

// Labels and long identifiers are considered on the same line and on an
// immediately adjacent line of the same block, never across distant layout.
function hasIdentifierContext(word: OcrWordEvidence, words: OcrWordEvidence[]): boolean {
  const lineKey = word.lineKey;
  if (!word.bbox || lineKey === null) return false;

  return words.some((other) => {
    if (other === word || !other.bbox) return false;
    if (other.lineKey === null) return false;
    if (other.lineKey === lineKey) return isNearby(word, other, 1.5) && isIdentifierLike(other.text);

    const [block, line] = lineKey.split(':').map(Number);
    const [otherBlock, otherLine] = other.lineKey.split(':').map(Number);
    if (block !== otherBlock || Math.abs(line - otherLine) !== 1) return false;
    return isVerticallyAligned(word, other, 1.5) && isIdentifierLike(other.text);
  });
}

function hasConfusingContext(
  word: OcrWordEvidence,
  words: OcrWordEvidence[],
  ignore: OcrWordEvidence | null = null,
): boolean {
  if (!word.bbox || word.lineKey === null) return false;

  return words.some((other) => {
    // The prefix of a composed code is not a nearby unit label (F/H can also
    // mean degrees Fahrenheit/hours when they appear on their own).
    if (other === word || other === ignore || other.lineKey !== word.lineKey || !other.bbox) return false;
    if (!isNearby(word, other, 2)) return false;
    const text = other.text.toUpperCase();
    return UNIT_LABELS.has(text) || NON_CODE_LABELS.has(text) || /\d+\s*[.:/-]\s*\d+/.test(other.text);
  });
}

function lineTextFor(word: OcrWordEvidence, words: OcrWordEvidence[]): string {
  if (word.lineKey === null) return words.map((item) => item.text).join(' ');
  return words.filter((item) => item.lineKey === word.lineKey).map((item) => item.text).join(' ');
}

function numericContextAllows(word: OcrWordEvidence, evidence: OcrEvidence): boolean {
  const line = lineTextFor(word, evidence.words);
  if (NON_ERROR_VALUE_RE.test(line)) return false;
  if (ERROR_CONTEXT_RE.test(line)) return true;

  // Without block metadata, only explicit error wording can anchor a bare
  // number; an isolated "83" in raw text may be any counter or measurement.
  if (!word.bbox || word.lineKey === null) return false;
  // A lone numeric token on a display is a plausible numeric code.
  return evidence.words.length === 1;
}

function isAdjacentToPrefix(word: OcrWordEvidence, words: OcrWordEvidence[]): boolean {
  if (!word.bbox || word.lineKey === null) return false;
  return words.some(
    (other) =>
      other !== word &&
      other.lineKey === word.lineKey &&
      /^[A-Za-z]$/.test(other.text) &&
      CODE_PREFIXES.has(other.text.toUpperCase()) &&
      isNearby(word, other, MAX_SEPARATED_GAP_RATIO),
  );
}

function minSymbolConfidence(word: OcrWordEvidence): number | null {
  const values = word.symbols
    .map((symbol) => symbol.confidence)
    .filter((value): value is number => value !== null);
  return values.length > 0 ? Math.min(...values) : null;
}

function combinedSymbolConfidence(words: OcrWordEvidence[]): number | null {
  const values = words
    .map((word) => minSymbolConfidence(word))
    .filter((value): value is number => value !== null);
  return values.length > 0 ? Math.min(...values) : null;
}

function makeCandidate(
  word: OcrWordEvidence,
  tier: CandidateTier,
  variants: string[],
  symbolConfidence: number | null = minSymbolConfidence(word),
): OcrCandidate {
  return {
    value: variants[0],
    tier,
    confidence: word.confidence,
    minSymbolConfidence: symbolConfidence,
    variants: unique(variants),
  };
}

function extractWordCandidates(evidence: OcrEvidence): OcrCandidate[] {
  const candidates: OcrCandidate[] = [];

  for (const word of evidence.words) {
    if (hasIdentifierContext(word, evidence.words)) continue;

    const canonical = variantsForTiers(word, [1]);
    if (canonical.length > 0) candidates.push(makeCandidate(word, 1, canonical));

    // Extended formats require spatial evidence and isolation: a bare token
    // from text-only OCR is not enough to promote it to a candidate.
    if (word.bbox && word.lineKey !== null && isIsolated(word, evidence.words)) {
      const extended = variantsForTiers(word, [2]);
      if (extended.length > 0) candidates.push(makeCandidate(word, 2, extended));
    }
  }

  return candidates;
}

function extractNumericCandidates(evidence: OcrEvidence): OcrCandidate[] {
  const candidates: OcrCandidate[] = [];

  for (const word of evidence.words) {
    if (parseDisplayToken(word.text).kind !== 'numeric') continue;
    if (word.confidence !== null && word.confidence < MIN_NUMERIC_CONFIDENCE) continue;
    const symbolConfidence = minSymbolConfidence(word);
    if (symbolConfidence !== null && symbolConfidence < MIN_NUMERIC_CONFIDENCE) continue;
    if (hasIdentifierContext(word, evidence.words) || hasConfusingContext(word, evidence.words)) continue;
    // A number next to a prefix letter is composed as a prefixed code instead.
    if (isAdjacentToPrefix(word, evidence.words)) continue;
    if (!numericContextAllows(word, evidence)) continue;

    const variants = variantsForTiers(word, [4]);
    if (variants.length > 0) candidates.push(makeCandidate(word, 4, variants));
  }

  return candidates;
}

function prefixVariants(word: OcrWordEvidence): string[] {
  const values: string[] = [];
  if (/^[A-Za-z]$/.test(word.text) && CODE_PREFIXES.has(word.text.toUpperCase())) {
    values.push(word.text.toUpperCase());
  }
  for (const choice of eligibleChoices(word)) {
    if (/^[A-Za-z]$/.test(choice.text) && CODE_PREFIXES.has(choice.text.toUpperCase())) {
      values.push(choice.text.toUpperCase());
    }
  }
  return unique(values);
}

function tailVariants(word: OcrWordEvidence): string[] {
  return unique([...parseDigitTail(word.text), ...eligibleChoices(word).flatMap((choice) => parseDigitTail(choice.text))]);
}

function extractCompositeCandidates(evidence: OcrEvidence): OcrCandidate[] {
  const lines = new Map<string, OcrWordEvidence[]>();

  // Words keep Tesseract's reported reading order: only adjacent tokens in
  // that order are considered, and the left token must also be left in space.
  for (const word of evidence.words) {
    if (!word.bbox || word.lineKey === null) continue;
    const line = lines.get(word.lineKey) ?? [];
    line.push(word);
    lines.set(word.lineKey, line);
  }

  const candidates: OcrCandidate[] = [];
  for (const line of lines.values()) {
    for (let index = 0; index < line.length - 1; index += 1) {
      const prefixWord = line[index];
      const digitWord = line[index + 1];
      const prefixes = prefixVariants(prefixWord);
      if (prefixes.length === 0) continue;
      const tails = tailVariants(digitWord);
      if (tails.length === 0) continue;
      if (hasIdentifierContext(prefixWord, evidence.words) || hasIdentifierContext(digitWord, evidence.words)) continue;
      if (hasConfusingContext(digitWord, evidence.words, prefixWord)) continue;

      const height = Math.max(wordHeight(prefixWord), wordHeight(digitWord));
      const gap = horizontalGap(prefixWord, digitWord);
      if (height <= 0 || gap === null || gap < -height * 0.2 || gap > height * MAX_SEPARATED_GAP_RATIO) continue;
      // Never join tokens from different lines or visibly misaligned baselines.
      if (!isVerticallyAligned(prefixWord, digitWord, MAX_SEPARATED_MISALIGNMENT_RATIO)) continue;

      const confidence =
        prefixWord.confidence !== null && digitWord.confidence !== null
          ? Math.min(prefixWord.confidence, digitWord.confidence)
          : prefixWord.confidence ?? digitWord.confidence;
      const variants = unique(prefixes.flatMap((prefix) => tails.map((tail) => `${prefix}${tail}`)));
      if (variants.length === 0) continue;

      const candidate = makeCandidate(prefixWord, 3, variants, combinedSymbolConfidence([prefixWord, digitWord]));
      candidate.confidence = confidence;
      candidates.push(candidate);
    }
  }

  return candidates;
}

export function extractCandidates(evidence: OcrEvidence): OcrCandidate[] {
  return [
    ...extractWordCandidates(evidence),
    ...extractNumericCandidates(evidence),
    ...extractCompositeCandidates(evidence),
  ];
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

function unreadable(pageConfidence: number): OcrDetectionData {
  return {
    status: 'UNREADABLE',
    code: null,
    candidates: [],
    message: UNREADABLE_MESSAGE,
    ocrConfidence: pageConfidence,
  };
}

function ambiguous(values: string[], pageConfidence: number): OcrDetectionData {
  return {
    status: 'AMBIGUOUS',
    code: null,
    candidates: values.slice(0, MAX_CANDIDATES),
    message: AMBIGUOUS_MESSAGE,
    ocrConfidence: pageConfidence,
  };
}

function dedupeCandidates(candidates: OcrCandidate[]): OcrCandidate[] {
  const byValue = new Map<string, OcrCandidate>();

  for (const candidate of candidates) {
    const existing = byValue.get(candidate.value);
    if (!existing) {
      byValue.set(candidate.value, { ...candidate, variants: [...candidate.variants] });
      continue;
    }
    existing.variants = unique([...existing.variants, ...candidate.variants]);
    if ((candidate.confidence ?? -1) > (existing.confidence ?? -1)) {
      existing.confidence = candidate.confidence;
    }
    if (
      candidate.minSymbolConfidence !== null &&
      (existing.minSymbolConfidence === null || candidate.minSymbolConfidence > existing.minSymbolConfidence)
    ) {
      existing.minSymbolConfidence = candidate.minSymbolConfidence;
    }
  }

  return [...byValue.values()];
}

export function classifyEvidence(evidence: OcrEvidence, candidates: OcrCandidate[]): OcrDetectionData {
  const pageConfidence = evidence.pageConfidence;
  const distinct = dedupeCandidates(candidates);

  // Absolute evidence gates, not a ranking: a candidate with weak word or
  // symbol evidence is discarded before any DETECTED/AMBIGUOUS decision.
  const reliable = distinct.filter(
    (candidate) =>
      (candidate.confidence === null || candidate.confidence >= MIN_WORD_CONFIDENCE) &&
      (candidate.minSymbolConfidence === null || candidate.minSymbolConfidence >= MIN_WORD_CONFIDENCE),
  );

  if (
    pageConfidence < MIN_PAGE_CONFIDENCE ||
    distinct.length > MAX_CANDIDATES ||
    reliable.length === 0 ||
    reliable.length > MAX_CANDIDATES
  ) {
    return unreadable(pageConfidence);
  }

  if (reliable.length > 1) {
    return ambiguous(
      reliable.map((candidate) => candidate.value),
      pageConfidence,
    );
  }

  const candidate = reliable[0];
  if (candidate.variants.length > 1) {
    return ambiguous(candidate.variants, pageConfidence);
  }

  return {
    status: 'DETECTED',
    code: candidate.value,
    candidates: [candidate.value],
    message: null,
    ocrConfidence: pageConfidence,
  };
}

// ---------------------------------------------------------------------------
// Backwards-compatible text-only helpers and the OCR worker.
// ---------------------------------------------------------------------------

export function normalizeErrorCodeToken(token: string): string | null {
  const reading = parseDisplayToken(token);
  return reading.tier === 1 || reading.tier === 2 ? reading.values[0] ?? null : null;
}

export function extractErrorCodeCandidates(text: string): string[] {
  const evidence = buildOcrEvidence(text, 100, undefined);
  return extractCandidates(evidence)
    .filter((candidate) => candidate.tier === 1)
    .map((candidate) => candidate.value);
}

export function classifyOcrText(text: string, confidence: number): OcrDetectionData {
  const evidence = buildOcrEvidence(text, confidence, undefined);
  return classifyEvidence(evidence, extractCandidates(evidence));
}

// Runs local, backend-only OCR on a temporary upload. The worker is terminated
// for every request, including failed recognitions.
export async function recognizeErrorCode(filePath: string): Promise<OcrDetectionData> {
  await mkdir(TESSDATA_CACHE_DIR, { recursive: true });
  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    cachePath: TESSDATA_CACHE_DIR,
  });

  try {
    // SPARSE_TEXT (11) was kept after comparing PSM 3/6/7/8/11 on the same
    // representative images: 6/7/11 gave identical outcomes, 3 produced the
    // same tokens/boxes but weaker word confidence on separated text, and 8
    // regressed separated tokens and two-code images. No single-image tuning.
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const result = await worker.recognize(filePath, {}, { blocks: true });
    const data = result?.data;
    const evidence = buildOcrEvidence(data?.text, data?.confidence, data?.blocks);
    return classifyEvidence(evidence, extractCandidates(evidence));
  } finally {
    await worker.terminate();
  }
}
