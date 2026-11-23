import { describe, expect, it } from 'vitest';
import { ApplianceCategory } from '../../src/generated/prisma/enums.js';
import { applianceDtoSelect, toApplianceDto } from '../../src/types/appliance.dto.js';

const createdAt = new Date('2026-11-20T00:00:00.000Z');
const updatedAt = new Date('2026-11-20T01:00:00.000Z');

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

const PUBLIC_FIELDS = [
  'id',
  'category',
  'brand',
  'modelNumber',
  'nickname',
  'createdAt',
  'updatedAt',
];

describe('toApplianceDto', () => {
  it('maps every public field', () => {
    const mapped = toApplianceDto(rawAppliance);

    expect(mapped).toEqual({
      id: rawAppliance.id,
      category: ApplianceCategory.WASHING_MACHINE,
      brand: 'Bosch',
      modelNumber: 'WGG244Z0GB',
      nickname: 'Main washer',
      createdAt,
      updatedAt,
    });
    expect(Object.keys(mapped).sort()).toEqual([...PUBLIC_FIELDS].sort());
  });

  it('never exposes userId', () => {
    const mapped = toApplianceDto(rawAppliance);

    expect(mapped).not.toHaveProperty('userId');
    expect(JSON.stringify(mapped)).not.toContain('userId');
    expect(JSON.stringify(mapped)).not.toContain('secret-user-id');
    expect(applianceDtoSelect).not.toHaveProperty('userId');
  });

  it('keeps select and mapper keys aligned', () => {
    const mapped = toApplianceDto(rawAppliance);

    expect(Object.keys(applianceDtoSelect).sort()).toEqual(Object.keys(mapped).sort());
    expect(Object.keys(applianceDtoSelect).sort()).toEqual([...PUBLIC_FIELDS].sort());
    for (const selected of Object.values(applianceDtoSelect)) {
      expect(selected).toBe(true);
    }
  });

  it('preserves null nullable values as null', () => {
    const mapped = toApplianceDto({ ...rawAppliance, modelNumber: null, nickname: null });

    expect(mapped.modelNumber).toBeNull();
    expect(mapped.nickname).toBeNull();
    expect(Object.keys(mapped)).toContain('modelNumber');
    expect(Object.keys(mapped)).toContain('nickname');
    expect(JSON.parse(JSON.stringify(mapped))).toMatchObject({ modelNumber: null, nickname: null });
  });
});
