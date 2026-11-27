import type { Appliance as HomeAppliance, ApplianceCategory as HomeApplianceCategory } from '@/types/home';

// Reuse the Home DTOs as the single source of truth for the appliance shape.
export type Appliance = HomeAppliance;
export type ApplianceCategory = HomeApplianceCategory;

/** Editable fields only. Ownership is derived from the access token by the backend. */
export interface CreateApplianceInput {
  category: ApplianceCategory;
  brand: string;
  modelNumber?: string | null;
  nickname?: string | null;
}

/** Every field is optional for PATCH; omitted fields stay unchanged. */
export interface UpdateApplianceInput {
  category?: ApplianceCategory;
  brand?: string;
  modelNumber?: string | null;
  nickname?: string | null;
}
