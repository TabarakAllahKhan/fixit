// Explicit DTO boundary for appliance responses. A raw Prisma record is never
// returned: the select loads only public columns, and the mapper copies them
// one by one so a later schema addition cannot leak ownership data.

import type { Appliance } from '../generated/prisma/client.js';
import type { PaginatedDto } from './diagnosis.dto.js';

export const applianceDtoSelect = {
  id: true,
  category: true,
  brand: true,
  modelNumber: true,
  nickname: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ApplianceRecord = Pick<Appliance, keyof typeof applianceDtoSelect>;

export type ApplianceDto = {
  id: string;
  category: Appliance['category'];
  brand: string;
  modelNumber: string | null;
  nickname: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Reuse the shared pagination envelope rather than defining a second shape.
export type PaginatedApplianceDto = PaginatedDto<ApplianceDto>;

export function toApplianceDto(appliance: ApplianceRecord): ApplianceDto {
  return {
    id: appliance.id,
    category: appliance.category,
    brand: appliance.brand,
    modelNumber: appliance.modelNumber,
    nickname: appliance.nickname,
    createdAt: appliance.createdAt,
    updatedAt: appliance.updatedAt,
  };
}
