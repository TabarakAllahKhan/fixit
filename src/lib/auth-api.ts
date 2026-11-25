import { apiRequest } from '@/lib/api';
import type {
  AuthResult,
  AuthTokens,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@/types/auth';

interface RefreshInFlight {
  refreshToken: string;
  promise: Promise<AuthTokens>;
}

let refreshInFlight: RefreshInFlight | null = null;

export function register(input: RegisterRequest): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/register', {
    method: 'POST',
    body: input,
  });
}

export function login(input: LoginRequest): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/login', {
    method: 'POST',
    body: input,
  });
}

export function getCurrentUser(accessToken: string): Promise<{ user: PublicUser }> {
  return apiRequest<{ user: PublicUser }>('/auth/me', {
    method: 'GET',
    accessToken,
  });
}

export function logout(refreshToken: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/auth/logout', {
    method: 'POST',
    body: { refreshToken },
  });
}

/** Rotates the opaque refresh token. Concurrent callers share one request. */
export function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  if (refreshInFlight?.refreshToken === refreshToken) {
    return refreshInFlight.promise;
  }

  const active = { refreshToken } as RefreshInFlight;

  active.promise = apiRequest<{ tokens: AuthTokens }>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  })
    .then(({ tokens }) => tokens)
    .finally(() => {
      if (refreshInFlight === active) refreshInFlight = null;
    });

  refreshInFlight = active;
  return active.promise;
}
