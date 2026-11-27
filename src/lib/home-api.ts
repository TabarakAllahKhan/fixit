import { apiRequest } from '@/lib/api';
import type { Appliance, DiagnosisMessage, DiagnosisSession, Paginated } from '@/types/home';

function withQuery(path: string, page: number, limit: number): string {
  return `${path}?page=${page}&limit=${limit}`;
}

// Home uses the same appliance list as the appliance API service. Keeping the
// export here preserves the existing import path and function signature.
export { listAppliances } from '@/lib/appliance-api';

export function listDiagnosisSessions(accessToken: string | null, limit = 5): Promise<Paginated<DiagnosisSession>> {
  return apiRequest<Paginated<DiagnosisSession>>(withQuery('/diagnosis', 1, limit), { accessToken });
}

export function listSessionMessages(
  accessToken: string | null,
  sessionId: string,
  limit = 1,
): Promise<Paginated<DiagnosisMessage>> {
  const path = `/diagnosis/${encodeURIComponent(sessionId)}/messages`;
  return apiRequest<Paginated<DiagnosisMessage>>(withQuery(path, 1, limit), { accessToken });
}

/**
 * The initial user message is `symptom` followed by `errorCode` on a new line
 * when both were supplied; with no symptom, the single line is the error code.
 * This mirrors session.service.ts and avoids inventing a code from symptom text.
 */
export function extractErrorCode(session: DiagnosisSession, firstMessage: string | null): string | null {
  if (!firstMessage) return null;

  const lines = firstMessage
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const symptom = session.symptom?.trim();
  if (symptom) {
    if (lines.length > 1 && lines[0] === symptom) return lines[lines.length - 1];
    return null;
  }

  return lines[0];
}

export function getApplianceDisplayName(appliance: Appliance | undefined): string | null {
  if (!appliance) return null;
  return appliance.nickname?.trim() || appliance.brand.trim() || null;
}

export function attachApplianceNames(
  sessions: DiagnosisSession[],
  appliances: Appliance[],
): (DiagnosisSession & { applianceName: string | null })[] {
  const byId = new Map(appliances.map((appliance) => [appliance.id, appliance]));
  return sessions.map((session) => {
    const name = session.applianceId ? getApplianceDisplayName(byId.get(session.applianceId)) : null;
    return { ...session, applianceName: name } as DiagnosisSession & { applianceName: string | null };
  });
}
