import { ApiError } from '@/lib/api';

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';

/** Maps API failures to short, non-technical messages safe to show in the UI. */
export function getApiErrorMessage(error: unknown, fallback: string = DEFAULT_MESSAGE): string {
  if (!(error instanceof ApiError)) return fallback;

  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'Please check the details you entered and try again.';
    case 'APPLIANCE_NOT_FOUND':
      return 'We could not find that appliance. It may have been removed.';
    case 'RATE_LIMITED':
      return 'Too many requests. Wait a moment and try again.';
    case 'NETWORK_ERROR':
      return 'Unable to reach Fix-It right now. Check your connection and try again.';
    case 'API_NOT_CONFIGURED':
      return 'Fix-It is not configured to reach the API yet. Please try again later.';
    case 'UNAUTHORIZED':
      return 'Your session has expired. Please sign in again.';
    default:
      break;
  }

  if (error.status === 401) return 'Your session has expired. Please sign in again.';
  if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
  if (error.status >= 500) return 'Fix-It is having trouble right now. Please try again shortly.';
  return fallback;
}
