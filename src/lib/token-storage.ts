import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, PublicUser, StoredSession } from '@/types/auth';

const SESSION_KEY = 'fixit.auth.session';
const TOKEN_REFRESH_SKEW_MS = 30_000;

let secureStoreAvailable: boolean | null = null;

async function canUseSecureStore(): Promise<boolean> {
  if (secureStoreAvailable !== null) return secureStoreAvailable;
  try {
    secureStoreAvailable = await SecureStore.isAvailableAsync();
  } catch {
    secureStoreAvailable = false;
  }
  return secureStoreAvailable;
}

function isPublicUser(value: unknown): value is PublicUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.username === 'string' &&
    typeof user.createdAt === 'string' &&
    typeof user.updatedAt === 'string'
  );
}

function isAuthTokens(value: unknown): value is AuthTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Record<string, unknown>;
  return (
    typeof tokens.accessToken === 'string' &&
    typeof tokens.refreshToken === 'string' &&
    tokens.tokenType === 'Bearer' &&
    typeof tokens.expiresIn === 'number'
  );
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return (
    isPublicUser(session.user) &&
    isAuthTokens(session.tokens) &&
    typeof session.expiresAt === 'number'
  );
}

export function createStoredSession(user: PublicUser, tokens: AuthTokens): StoredSession {
  return {
    user,
    tokens,
    expiresAt: Date.now() + Math.max(0, tokens.expiresIn) * 1000,
  };
}

export function withRefreshedTokens(session: StoredSession, tokens: AuthTokens): StoredSession {
  return { ...session, tokens, expiresAt: Date.now() + Math.max(0, tokens.expiresIn) * 1000 };
}

export function isSessionNearExpiry(session: StoredSession): boolean {
  return session.expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS;
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (!(await canUseSecureStore())) return;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function getSession(): Promise<StoredSession | null> {
  if (!(await canUseSecureStore())) return null;

  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (!(await canUseSecureStore())) return;
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
