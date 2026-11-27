import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { ApiError } from '@/lib/api';
import { setAuthSessionHooks } from '@/lib/authenticated-api';
import {
  getCurrentUser,
  login as loginApi,
  logout as logoutApi,
  refreshTokens,
  register as registerApi,
} from '@/lib/auth-api';
import {
  clearSession,
  createStoredSession,
  getSession,
  isSessionNearExpiry,
  saveSession,
  withRefreshedTokens,
} from '@/lib/token-storage';
import type {
  AuthResult,
  LoginRequest,
  PublicUser,
  RegisterRequest,
  StoredSession,
} from '@/types/auth';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  accessToken: string | null;
  signIn: (input: LoginRequest) => Promise<AuthResult>;
  signUp: (input: RegisterRequest) => Promise<AuthResult>;
  finishSignUp: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isAuthRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const statusRef = useRef<AuthStatus>('loading');

  const updateStatus = useCallback((next: AuthStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const applySignedOut = useCallback(async () => {
    try {
      await clearSession();
    } catch {
      // Local sign-out must still succeed if native storage is unavailable.
    }
    setUser(null);
    setAccessToken(null);
    updateStatus('unauthenticated');
  }, [updateStatus]);

  const applyStoredSession = useCallback(async (session: StoredSession) => {
    await saveSession(session);
    setUser(session.user);
    setAccessToken(session.tokens.accessToken);
  }, []);

  const applyRefreshedSession = useCallback(async (session: StoredSession) => {
    // A late refresh must not resurrect a session the user already signed out of.
    if (statusRef.current !== 'authenticated') return;
    await saveSession(session);
    setUser(session.user);
    setAccessToken(session.tokens.accessToken);
  }, []);

  const handleSessionInvalidated = useCallback(async () => {
    if (statusRef.current !== 'authenticated') return;
    await applySignedOut();
  }, [applySignedOut]);

  useEffect(() => {
    setAuthSessionHooks({
      onTokensRefreshed: (session) => {
        void applyRefreshedSession(session);
      },
      onSessionInvalidated: () => {
        void handleSessionInvalidated();
      },
    });
    return () => setAuthSessionHooks(null);
  }, [applyRefreshedSession, handleSessionInvalidated]);

  useEffect(() => {
    let mounted = true;

    async function restore() {
      try {
        const stored = await getSession();
        if (!stored) {
          if (mounted) await applySignedOut();
          return;
        }

        let active = stored;

        if (isSessionNearExpiry(active)) {
          const tokens = await refreshTokens(active.tokens.refreshToken);
          active = withRefreshedTokens(active, tokens);
          await saveSession(active);
        }

        try {
          const me = await getCurrentUser(active.tokens.accessToken);
          active = { ...active, user: me.user };
          await saveSession(active);
        } catch (error) {
          if (!isAuthRejection(error)) {
            // Offline or transient failure: keep the cached user and tokens.
            // The next authenticated request can still trigger a refresh.
          } else {
            const tokens = await refreshTokens(active.tokens.refreshToken);
            active = withRefreshedTokens(active, tokens);
            const me = await getCurrentUser(active.tokens.accessToken);
            active = { ...active, user: me.user };
            await saveSession(active);
          }
        }

        if (!mounted) return;
        setUser(active.user);
        setAccessToken(active.tokens.accessToken);
        updateStatus('authenticated');
      } catch (error) {
        if (!mounted) return;
        if (isAuthRejection(error)) {
          await applySignedOut();
          return;
        }
        // Unexpected local failure: fall back to the cached session when present.
        const cached = await getSession();
        if (cached) {
          setUser(cached.user);
          setAccessToken(cached.tokens.accessToken);
          updateStatus('authenticated');
        } else {
          await applySignedOut();
        }
      }
    }

    void restore();
    return () => {
      mounted = false;
    };
  }, [applySignedOut, updateStatus]);

  const signIn = useCallback(
    async (input: LoginRequest) => {
      const result = await loginApi(input);
      await applyStoredSession(createStoredSession(result.user, result.tokens));
      updateStatus('authenticated');
      return result;
    },
    [applyStoredSession, updateStatus],
  );

  const signUp = useCallback(
    async (input: RegisterRequest) => {
      const result = await registerApi(input);
      // Status changes only in finishSignUp so the screen can show its success
      // state before protected routes take over.
      await applyStoredSession(createStoredSession(result.user, result.tokens));
      return result;
    },
    [applyStoredSession],
  );

  const finishSignUp = useCallback(() => {
    updateStatus('authenticated');
  }, [updateStatus]);

  const signOut = useCallback(async () => {
    const stored = await getSession();
    if (stored) {
      try {
        await logoutApi(stored.tokens.refreshToken);
      } catch {
        // Revocation is best-effort; always clear the local session.
      }
    }
    await applySignedOut();
  }, [applySignedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, accessToken, signIn, signUp, finishSignUp, signOut }),
    [status, user, accessToken, signIn, signUp, finishSignUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
