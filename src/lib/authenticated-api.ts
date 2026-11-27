import { ApiError, apiRequest } from '@/lib/api';
import { refreshTokens } from '@/lib/auth-api';
import { clearSession, getSession, saveSession, withRefreshedTokens } from '@/lib/token-storage';
import type { AuthTokens, StoredSession } from '@/types/auth';

/**
 * Bridge between lib-level API calls and AuthContext. It lets a 401 retry use
 * the existing refresh/session helpers without introducing a second refresh
 * implementation or a second token store.
 */
export interface AuthSessionHooks {
  onTokensRefreshed: (session: StoredSession) => void;
  onSessionInvalidated: () => void;
}

let sessionHooks: AuthSessionHooks | null = null;

export function setAuthSessionHooks(hooks: AuthSessionHooks | null): void {
  sessionHooks = hooks;
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

async function invalidateSession(): Promise<void> {
  try {
    await clearSession();
  } catch {
    // Native storage failures must not block the redirect to sign-in.
  }
  sessionHooks?.onSessionInvalidated();
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

async function refreshAfterUnauthorized(failedAccessToken: string | null): Promise<StoredSession | null> {
  const stored = await getSession().catch(() => null);
  if (!stored) {
    await invalidateSession();
    return null;
  }

  // A concurrent request may already have rotated the tokens. Reuse that
  // result instead of spending another refresh on the same session.
  if (failedAccessToken && stored.tokens.accessToken !== failedAccessToken) {
    return stored;
  }

  try {
    // Confirm the session was not cleared or replaced while we were waiting.
    const current = await getSession().catch(() => null);
    if (!current) {
      await invalidateSession();
      return null;
    }
    if (current.tokens.refreshToken !== stored.tokens.refreshToken) {
      return current;
    }

    // refreshTokens() shares an in-flight request for the same refresh token,
    // so concurrent 401s do not each trigger their own rotation.
    const tokens: AuthTokens = await refreshTokens(stored.tokens.refreshToken);
    const next = withRefreshedTokens(stored, tokens);
    await saveSession(next);
    sessionHooks?.onTokensRefreshed(next);
    return next;
  } catch {
    // Rejected/reused refresh token, or a failure persisting the rotation.
    await invalidateSession();
    return null;
  }
}

/**
 * Sends an authenticated request once. On 401 it rotates tokens through the
 * existing auth API and retries exactly once with the new access token.
 */
export async function authenticatedRequest<T>(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<T> {
  try {
    return await apiRequest<T>(path, { ...options, accessToken });
  } catch (error) {
    if (!isUnauthorized(error)) throw error;

    const refreshed = await refreshAfterUnauthorized(accessToken);
    if (!refreshed) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    }

    return apiRequest<T>(path, { ...options, accessToken: refreshed.tokens.accessToken });
  }
}
