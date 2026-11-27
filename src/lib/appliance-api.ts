import { authenticatedRequest } from '@/lib/authenticated-api';
import { normalizeCreateAppliance, normalizeUpdateAppliance } from '@/lib/appliance-validation';
import type { Appliance, CreateApplianceInput, UpdateApplianceInput } from '@/types/appliance';
import type { Paginated } from '@/types/home';

function appliancePath(id: string): string {
  return `/appliances/${encodeURIComponent(id)}`;
}

/** Page 1 with the backend's maximum page size, matching the existing Home list. */
export function listAppliances(accessToken: string | null, limit = 100): Promise<Paginated<Appliance>> {
  return authenticatedRequest<Paginated<Appliance>>(
    `/appliances?page=1&limit=${limit}`,
    { method: 'GET' },
    accessToken,
  );
}

export function getAppliance(accessToken: string | null, id: string): Promise<Appliance> {
  return authenticatedRequest<Appliance>(appliancePath(id), { method: 'GET' }, accessToken);
}

export function createAppliance(
  accessToken: string | null,
  input: CreateApplianceInput,
): Promise<Appliance> {
  return authenticatedRequest<Appliance>(
    '/appliances',
    { method: 'POST', body: normalizeCreateAppliance(input) },
    accessToken,
  );
}

export function updateAppliance(
  accessToken: string | null,
  id: string,
  input: UpdateApplianceInput,
): Promise<Appliance> {
  return authenticatedRequest<Appliance>(
    appliancePath(id),
    { method: 'PATCH', body: normalizeUpdateAppliance(input) },
    accessToken,
  );
}

export function deleteAppliance(accessToken: string | null, id: string): Promise<{ message: string }> {
  return authenticatedRequest<{ message: string }>(
    appliancePath(id),
    { method: 'DELETE' },
    accessToken,
  );
}
