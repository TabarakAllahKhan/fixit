// Client-side contracts mirroring the backend DTOs. Dates arrive as ISO strings
// after JSON serialization, so the frontend never treats them as Date objects.

export type ApplianceCategory = 'WASHING_MACHINE' | 'REFRIGERATOR';

export interface Appliance {
  id: string;
  category: ApplianceCategory;
  brand: string;
  modelNumber: string | null;
  nickname: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DiagnosisStatus = 'OPEN' | 'COMPLETED' | 'ABANDONED';

export type DiagnosisVerdict = 'FIXED' | 'NEEDS_PART' | 'TECHNICIAN_REQUIRED' | 'UNRESOLVED';

export interface DiagnosisSession {
  id: string;
  applianceId: string | null;
  symptom: string | null;
  status: DiagnosisStatus;
  verdict: DiagnosisVerdict | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiagnosisMessage {
  id: string;
  sessionId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * A session enriched for display only. The backend has no errorCode column;
 * the code is recovered from the first user message and the appliance name is
 * resolved from the owner's saved appliances.
 */
export interface DiagnosisSummary extends DiagnosisSession {
  errorCode: string | null;
  applianceName: string | null;
}
