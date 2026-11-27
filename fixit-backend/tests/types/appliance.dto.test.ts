import { describe, expect, it } from 'vitest';
import { ApplianceCategory } from '../../src/generated/prisma/enums.js';
import { applianceDtoSelect, toApplianceDto } from '../../src/types/appliance.dto.js';

const createdAt = new Date('2026-11-20T00:00:00.000Z');
const updatedAt = new Date('2026-11-20T01:00:00.000Z');

// A raw row may still carry legacy columns and ownership data; the DTO select
// and mapper must never copy either into an appliance API response.
const rawAppliance = {
  id: '00000000-0000-7000-8000-000000000001',
  userId: 'secret-user-id',
  category: ApplianceCategory.WASHING_MACHINE,
  brand: 'Bosch',
  modelNumber: 'WGG244Z0GB',
  nickname: 'Main washer',
  createdAt,
  updatedAt,
};

const dtoInput = {
  id: rawAppliance.id,
  brand: rawAppliance.brand,
  modelNumber: rawAppliance.modelNumber,
  createdAt: rawAppliance.createdAt,
  updatedAt: rawAppliance.updatedAt,
};

const PUBLIC_FIELDS = ['id', 'brand', 'modelNumber', 'createdAt', 'updatedAt'] as const;

describe('toApplianceDto', () => {
  it('maps every public field', () => {
    const mapped = toApplianceDto(dtoInput);

    expect(mapped).toEqual({
      id: rawAppliance.id,
      brand: 'Bosch',
      modelNumber: 'WGG244Z0GB',
      createdAt,
      updatedAt,
    });
    expect(Object.keys(mapped)).toEqual([...PUBLIC_FIELDS]);
  });

  it('never exposes the legacy category or nickname columns', () => {
    // The underlying row still has both legacy values; the selected DTO has neither.
    expect(rawAppliance.category).toBe(ApplianceCategory.WASHING_MACHINE);
    expect(rawAppliance.nickname).toBe('Main washer');
    const mapped = toApplianceDto(dtoInput);

    expect(mapped).not.toHaveProperty('category');
    expect(mapped).not.toHaveProperty('nickname');
    expect(applianceDtoSelect).not.toHaveProperty('category');
    expect(applianceDtoSelect).not.toHaveProperty('nickname');
    expect(JSON.stringify(mapped)).not.toContain('WASHING_MACHINE');
    expect(JSON.stringify(mapped)).not.toContain('Main washer');
    expect(JSON.stringify(mapped)).not.toContain('"category"');
    expect(JSON.stringify(mapped)).not.toContain('"nickname"');
  });

  it('never exposes userId', () => {
    const mapped = toApplianceDto(dtoInput);

    expect(mapped).not.toHaveProperty('userId');
    expect(JSON.stringify(mapped)).not.toContain('userId');
    expect(JSON.stringify(mapped)).not.toContain('secret-user-id');
    expect(applianceDtoSelect).not.toHaveProperty('userId');
  });

  it('keeps select and mapper keys aligned', () => {
    const mapped = toApplianceDto(dtoInput);

    expect(Object.keys(applianceDtoSelect)).toEqual([...PUBLIC_FIELDS]);
    expect(Object.keys(applianceDtoSelect)).toEqual(Object.keys(mapped));
    for (const selected of Object.values(applianceDtoSelect)) {
      expect(selected).toBe(true);
    }
  });

  it('preserves a null modelNumber as null without adding legacy fields', () => {
    const mapped = toApplianceDto({ ...dtoInput, modelNumber: null });

    expect(mapped.modelNumber).toBeNull();
    expect(Object.keys(mapped)).toEqual([...PUBLIC_FIELDS]);
    expect(mapped).not.toHaveProperty('nickname');
    expect(JSON.parse(JSON.stringify(mapped))).toEqual({
      id: rawAppliance.id,
      brand: 'Bosch',
      modelNumber: null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  });
});
