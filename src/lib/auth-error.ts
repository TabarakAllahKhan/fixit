import { ApiError } from '@/lib/api';

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'That email, username, or password does not match an account.';
    case 'EMAIL_ALREADY_EXISTS':
      return 'An account with this email already exists. Try signing in.';
    case 'USERNAME_ALREADY_EXISTS':
      return 'That username is already taken. Try another one.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    case 'API_NOT_CONFIGURED':
      return 'Fix-It cannot reach the API yet. Please try again later.';
    case 'NETWORK_ERROR':
      return error.message;
    default:
      return error.message || fallback;
  }
}
