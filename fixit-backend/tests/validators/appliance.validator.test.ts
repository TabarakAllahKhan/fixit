import { describe, expect, it } from 'vitest';
import {
  applianceIdParamSchema,
  createApplianceSchema,
  listAppliancesQuerySchema,
  updateApplianceSchema,
} from '../../src/validators/appliance.validator.js';

const VALID_CREATE = { brand: 'Bosch' };

describe('createApplianceSchema', () => {
  it('accepts valid create input', () => {
    expect(
      createApplianceSchema.parse({
        brand: 'LG',
        modelNumber: 'GBB72NSDFN',
      }),
    ).toEqual({ brand: 'LG', modelNumber: 'GBB72NSDFN' });
  });

  it('rejects missing required fields', () => {
    expect(createApplianceSchema.safeParse({}).success).toBe(false);
    expect(createApplianceSchema.safeParse({ modelNumber: 'GBB72NSDFN' }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ category: 'WASHING_MACHINE' }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ nickname: 'Kitchen fridge' }).success).toBe(false);
  });

  it('rejects an empty brand', () => {
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: '' }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: '   ' }).success).toBe(false);
  });

  it('enforces brand length boundaries after trimming', () => {
    expect(createApplianceSchema.safeParse({ brand: 'a'.repeat(120) }).success).toBe(true);
    expect(createApplianceSchema.safeParse({ brand: 'a'.repeat(121) }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ brand: ` ${'a'.repeat(120)} ` }).success).toBe(true);
  });

  it('enforces modelNumber length boundaries', () => {
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, modelNumber: 'm'.repeat(80) }).success).toBe(true);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, modelNumber: 'm'.repeat(81) }).success).toBe(false);
  });

  it('trims brand and modelNumber', () => {
    expect(
      createApplianceSchema.parse({
        brand: '  Bosch  ',
        modelNumber: '  WGG244  ',
      }),
    ).toEqual({ brand: 'Bosch', modelNumber: 'WGG244' });
  });

  it('normalizes empty optional strings to null', () => {
    expect(createApplianceSchema.parse({ ...VALID_CREATE, modelNumber: '' })).toEqual({
      brand: 'Bosch',
      modelNumber: null,
    });
    expect(createApplianceSchema.parse({ ...VALID_CREATE, modelNumber: '   ' })).toEqual({
      brand: 'Bosch',
      modelNumber: null,
    });
  });

  it('accepts an omitted or explicit null modelNumber', () => {
    expect(createApplianceSchema.parse(VALID_CREATE)).toEqual(VALID_CREATE);
    expect(createApplianceSchema.parse({ ...VALID_CREATE, modelNumber: null })).toEqual({
      brand: 'Bosch',
      modelNumber: null,
    });
  });

  it.each(['brand', 'modelNumber'] as const)(
    'rejects control characters in %s (including NUL)',
    (field) => {
      for (const control of ['\u0000', '\n', '\t', '\u007F', '\u0085']) {
        const input = { ...VALID_CREATE, [field]: `bad${control}value` };
        expect(createApplianceSchema.safeParse(input).success).toBe(false);
      }
    },
  );

  it('strips unknown properties', () => {
    expect(
      createApplianceSchema.parse({ ...VALID_CREATE, color: 'white' }),
    ).toEqual(VALID_CREATE);
  });

  it('strips legacy category and nickname', () => {
    expect(
      createApplianceSchema.parse({
        ...VALID_CREATE,
        category: 'REFRIGERATOR',
        nickname: 'Kitchen fridge',
      }),
    ).toEqual(VALID_CREATE);
  });

  it('strips a userId injection attempt', () => {
    expect(
      createApplianceSchema.parse({ ...VALID_CREATE, userId: 'another-users-id' }),
    ).toEqual(VALID_CREATE);
  });

  it('strips an id injection attempt', () => {
    expect(
      createApplianceSchema.parse({ ...VALID_CREATE, id: 'client-chosen-id' }),
    ).toEqual(VALID_CREATE);
  });

  it('strips timestamp injection attempts', () => {
    expect(
      createApplianceSchema.parse({
        ...VALID_CREATE,
        createdAt: '1999-01-01T00:00:00.000Z',
        updatedAt: '1999-01-01T00:00:00.000Z',
      }),
    ).toEqual(VALID_CREATE);
  });
});

describe('updateApplianceSchema', () => {
  it('accepts a PATCH with one editable field', () => {
    expect(updateApplianceSchema.parse({ brand: 'Samsung' })).toEqual({ brand: 'Samsung' });
    expect(updateApplianceSchema.parse({ modelNumber: 'WW80T3040WW' })).toEqual({ modelNumber: 'WW80T3040WW' });
  });

  it('accepts a PATCH with multiple editable fields and strips legacy/server fields', () => {
    expect(
      updateApplianceSchema.parse({
        brand: ' LG ',
        modelNumber: ' GBB72 ',
        category: 'REFRIGERATOR',
        nickname: null,
        userId: 'another-users-id',
        id: 'client-chosen-id',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({ brand: 'LG', modelNumber: 'GBB72' });
  });

  it('rejects an empty PATCH body', () => {
    expect(updateApplianceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a PATCH containing only unknown or server-managed properties', () => {
    for (const body of [
      { color: 'white' },
      { userId: 'another-users-id' },
      { id: 'client-chosen-id' },
      { category: 'REFRIGERATOR' },
      { nickname: 'Kitchen fridge' },
      { createdAt: '2026-01-01T00:00:00.000Z' },
    ]) {
      expect(updateApplianceSchema.safeParse(body).success).toBe(false);
    }
  });

  it('applies create validation rules to PATCH', () => {
    expect(updateApplianceSchema.safeParse({ brand: '  ' }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ brand: 'a'.repeat(121) }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ modelNumber: 'm'.repeat(81) }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ modelNumber: 'bad\u0000value' }).success).toBe(false);
  });

  it('clears nullable fields on explicit null or empty input and strips server fields', () => {
    expect(
      updateApplianceSchema.parse({
        modelNumber: '   ',
        nickname: null,
        userId: 'another-users-id',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({ modelNumber: null });
    expect(updateApplianceSchema.parse({ modelNumber: null })).toEqual({ modelNumber: null });
  });
});

describe('applianceIdParamSchema', () => {
  it('accepts a UUID id', () => {
    const id = crypto.randomUUID();
    expect(applianceIdParamSchema.parse({ id })).toEqual({ id });
  });

  it('rejects an invalid appliance UUID with a path usable by the validation middleware', () => {
    for (const id of ['not-a-uuid', '', '12345']) {
      const result = applianceIdParamSchema.safeParse({ id });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(['id']);
      }
    }
  });
});

describe('listAppliancesQuerySchema', () => {
  it('applies the shared pagination defaults', () => {
    expect(listAppliancesQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('accepts pagination minimum and maximum boundaries', () => {
    expect(listAppliancesQuerySchema.parse({ page: '1', limit: '1' })).toEqual({ page: 1, limit: 1 });
    expect(listAppliancesQuerySchema.parse({ page: '5', limit: '100' })).toEqual({ page: 5, limit: 100 });
  });

  it.each([
    { page: 0 },
    { limit: 0 },
    { limit: 101 },
    { page: -1 },
    { page: 1.5 },
    { page: 'abc' },
    { limit: 'abc' },
  ])('rejects invalid pagination values %j', (query) => {
    expect(listAppliancesQuerySchema.safeParse(query).success).toBe(false);
  });
});
