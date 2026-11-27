// Explicit DTO boundary for appliance responses. A raw Prisma record is never
// returned: the select loads only public columns, and the mapper copies them
// one by one so a later schema addition cannot leak ownership data or legacy
// database columns (category, nickname) into the appliance API.

import type { Appliance } from '../generated/prisma/client.js';
import type { PaginatedDto } from './diagnosis.dto.js';

export const applianceDtoSelect = {
  id: true,
  brand: true,
  modelNumber: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ApplianceRecord = Pick<Appliance, keyof typeof applianceDtoSelect>;

export type ApplianceDto = {
  id: string;
  brand: string;
  modelNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Reuse the shared pagination envelope rather than defining a second shape.
export type PaginatedApplianceDto = PaginatedDto<ApplianceDto>;

export function toApplianceDto(appliance: ApplianceRecord): ApplianceDto {
  return {
    id: appliance.id,
    brand: appliance.brand,
    modelNumber: appliance.modelNumber,
    createdAt: appliance.createdAt,
    updatedAt: appliance.updatedAt,
  };
}
