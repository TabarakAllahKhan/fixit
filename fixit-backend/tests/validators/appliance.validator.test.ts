import { describe, expect, it } from 'vitest';
import {
  applianceIdParamSchema,
  createApplianceSchema,
  listAppliancesQuerySchema,
  updateApplianceSchema,
} from '../../src/validators/appliance.validator.js';

const VALID_CREATE = { category: 'WASHING_MACHINE', brand: 'Bosch' };

describe('createApplianceSchema', () => {
  it('accepts valid create input', () => {
    expect(
      createApplianceSchema.parse({
        category: 'REFRIGERATOR',
        brand: 'LG',
        modelNumber: 'GBB72NSDFN',
        nickname: 'Kitchen fridge',
      }),
    ).toEqual({
      category: 'REFRIGERATOR',
      brand: 'LG',
      modelNumber: 'GBB72NSDFN',
      nickname: 'Kitchen fridge',
    });
  });

  it('rejects missing required fields', () => {
    expect(createApplianceSchema.safeParse({}).success).toBe(false);
    expect(createApplianceSchema.safeParse({ brand: 'Bosch' }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ category: 'WASHING_MACHINE' }).success).toBe(false);
  });

  it('rejects categories outside the Prisma enum', () => {
    for (const category of ['DISHWASHER', 'washing_machine', '', null]) {
      expect(createApplianceSchema.safeParse({ ...VALID_CREATE, category }).success).toBe(false);
    }
  });

  it('rejects an empty brand', () => {
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: '' }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: '   ' }).success).toBe(false);
  });

  it('enforces brand length boundaries after trimming', () => {
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: 'a'.repeat(120) }).success).toBe(true);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: 'a'.repeat(121) }).success).toBe(false);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, brand: ` ${'a'.repeat(120)} ` }).success).toBe(true);
  });

  it('enforces modelNumber length boundaries', () => {
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, modelNumber: 'm'.repeat(80) }).success).toBe(true);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, modelNumber: 'm'.repeat(81) }).success).toBe(false);
  });

  it('enforces nickname length boundaries', () => {
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, nickname: 'n'.repeat(100) }).success).toBe(true);
    expect(createApplianceSchema.safeParse({ ...VALID_CREATE, nickname: 'n'.repeat(101) }).success).toBe(false);
  });

  it('trims brand, modelNumber and nickname', () => {
    expect(
      createApplianceSchema.parse({
        category: 'WASHING_MACHINE',
        brand: '  Bosch  ',
        modelNumber: '  WGG244  ',
        nickname: '  Main washer  ',
      }),
    ).toEqual({
      category: 'WASHING_MACHINE',
      brand: 'Bosch',
      modelNumber: 'WGG244',
      nickname: 'Main washer',
    });
  });

  it('normalizes empty optional strings to null', () => {
    expect(
      createApplianceSchema.parse({ ...VALID_CREATE, modelNumber: '', nickname: '   ' }),
    ).toEqual({ ...VALID_CREATE, modelNumber: null, nickname: null });
  });

  it('accepts explicit null for optional fields', () => {
    expect(
      createApplianceSchema.parse({ ...VALID_CREATE, modelNumber: null, nickname: null }),
    ).toEqual({ ...VALID_CREATE, modelNumber: null, nickname: null });
  });

  it.each(['brand', 'modelNumber', 'nickname'] as const)(
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
});

describe('updateApplianceSchema', () => {
  it('accepts a PATCH with one editable field', () => {
    expect(updateApplianceSchema.parse({ brand: 'Samsung' })).toEqual({ brand: 'Samsung' });
  });

  it('accepts a PATCH with multiple editable fields', () => {
    expect(
      updateApplianceSchema.parse({
        category: 'REFRIGERATOR',
        brand: ' LG ',
        modelNumber: ' GBB72 ',
        nickname: null,
      }),
    ).toEqual({
      category: 'REFRIGERATOR',
      brand: 'LG',
      modelNumber: 'GBB72',
      nickname: null,
    });
  });

  it('rejects an empty PATCH body', () => {
    expect(updateApplianceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a PATCH containing only unknown properties', () => {
    for (const body of [{ color: 'white' }, { userId: 'another-users-id' }, { id: 'client-chosen-id' }]) {
      expect(updateApplianceSchema.safeParse(body).success).toBe(false);
    }
  });

  it('applies create validation rules to PATCH', () => {
    expect(updateApplianceSchema.safeParse({ category: 'DISHWASHER' }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ brand: '  ' }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ brand: 'a'.repeat(121) }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ modelNumber: 'm'.repeat(81) }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ nickname: 'n'.repeat(101) }).success).toBe(false);
    expect(updateApplianceSchema.safeParse({ nickname: 'bad\u0000name' }).success).toBe(false);
  });

  it('clears nullable fields on explicit null or empty input and strips server fields', () => {
    expect(
      updateApplianceSchema.parse({
        modelNumber: '   ',
        nickname: null,
        userId: 'another-users-id',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({ modelNumber: null, nickname: null });
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
