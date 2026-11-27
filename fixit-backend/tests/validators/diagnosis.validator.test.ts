import { describe, expect, it } from 'vitest';
import { createSessionSchema } from '../../src/validators/diagnosis.validator.js';

const applianceId = '00000000-0000-7000-8000-000000000001';

function parseSymptom(symptom: string) {
  return createSessionSchema.safeParse({ applianceId, symptom });
}

describe('createSessionSchema symptom', () => {
  it.each([
    ['LF line breaks', 'Not draining\nWater stays in the drum'],
    ['CRLF line breaks', 'Not draining\r\nWater stays in the drum'],
    ['CR line breaks', 'Not draining\rWater stays in the drum'],
    ['blank lines between paragraphs', 'Not draining\n\nStarted after a power cut'],
  ])('accepts ordinary multiline text with %s', (_label, symptom) => {
    const parsed = parseSymptom(symptom);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.symptom).toBe(symptom);
  });

  it('trims surrounding line breaks while keeping interior ones', () => {
    const parsed = parseSymptom('\r\n  Not draining\nLoud hum  \n');
    expect(parsed.success).toBe(true);
    expect(parsed.data?.symptom).toBe('Not draining\nLoud hum');
  });

  it('rejects a symptom made only of line breaks', () => {
    expect(parseSymptom('\n\r\n').success).toBe(false);
  });

  it.each([
    ['NUL', 'broken\u0000clue'],
    ['bell', 'broken\u0007clue'],
    ['tab', 'broken\tclue'],
    ['vertical tab', 'broken\u000Bclue'],
    ['form feed', 'broken\u000Cclue'],
    ['escape', 'broken\u001Bclue'],
    ['DEL', 'broken\u007Fclue'],
    ['C1 next line', 'broken\u0085clue'],
    ['C1 range end', 'broken\u009Fclue'],
    ['NUL alongside a line break', 'Not draining\n\u0000'],
  ])('rejects the unsafe control character %s', (_label, symptom) => {
    const parsed = parseSymptom(symptom);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('Symptom contains control characters');
  });

  it('still rejects control characters in the brand and error code', () => {
    expect(
      createSessionSchema.safeParse({ brand: 'L\nG', symptom: 'Not draining' }).success,
    ).toBe(false);
    expect(
      createSessionSchema.safeParse({ applianceId, symptom: 'Not draining', errorCode: 'F\nE' }).success,
    ).toBe(false);
  });
});
