import type { ApplianceCategory, DiagnosisStatus, DiagnosisVerdict } from '@/types/home';

/** Device-local greeting; the hour comes from the user's own clock. */
export function getGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

/** Capitalize for display only; the stored/auth username is never changed. */
export function capitalizeUsername(username: string | null | undefined): string {
  const value = username?.trim();
  if (!value) return 'there';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Derive two initials from a username without falling back to an email. */
export function getInitials(username: string | null | undefined): string {
  const value = username?.trim();
  if (!value) return '?';

  const parts = value.split(/[^a-z0-9]+/i).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export function getCategoryLabel(category: ApplianceCategory): string {
  return category === 'REFRIGERATOR' ? 'Refrigerator' : 'Washing machine';
}

export function getStatusLabel(status: DiagnosisStatus): string {
  switch (status) {
    case 'OPEN':
      return 'IN PROGRESS';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'ABANDONED':
      return 'ABANDONED';
  }
}

export function getVerdictLabel(verdict: DiagnosisVerdict | null): string | null {
  switch (verdict) {
    case 'FIXED':
      return 'Fixed';
    case 'NEEDS_PART':
      return 'Part needed';
    case 'TECHNICIAN_REQUIRED':
      return 'Technician required';
    case 'UNRESOLVED':
      return 'Unresolved';
    default:
      return null;
  }
}

export function formatSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Fix-It could not load this right now. Please try again.';
}
