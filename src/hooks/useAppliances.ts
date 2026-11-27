import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { getApiErrorMessage } from '@/lib/api-error';
import { listAppliances } from '@/lib/appliance-api';
import type { Appliance } from '@/types/appliance';

/** The backend's maximum page size; page 1 matches the Home appliance list. */
const APPLIANCES_LIMIT = 100;
const FALLBACK_ERROR = 'Couldn’t load your appliances. Please try again.';

export interface AppliancesState {
  items: Appliance[];
  /** True only until the first page resolves, so an empty state cannot flash. */
  initialLoading: boolean;
  refreshing: boolean;
  error: string | null;
}

interface InFlightRequest {
  accessToken: string | null;
  requestId: number;
  promise: Promise<void>;
}

/** Owner-scoped appliance list with focus refresh, pull-to-refresh and retry. */
export function useAppliances() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<AppliancesState>({
    items: [],
    initialLoading: true,
    refreshing: false,
    error: null,
  });
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef<InFlightRequest | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback((): Promise<void> => {
    // Focus and pull-to-refresh can fire together. Share the current request
    // unless the active session's token changed.
    const inFlight = inFlightRef.current;
    if (inFlight && inFlight.accessToken === accessToken) {
      return inFlight.promise;
    }

    const requestId = ++requestIdRef.current;
    setState((previous) => ({
      items: previous.items,
      // Keep an already-loaded list visible; only the first load shows skeletons.
      initialLoading: previous.items.length === 0,
      refreshing: previous.items.length > 0,
      error: null,
    }));

    const promise = (async () => {
      try {
        const page = await listAppliances(accessToken, APPLIANCES_LIMIT);
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setState({ items: page.items, initialLoading: false, refreshing: false, error: null });
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setState((previous) => ({
          items: previous.items,
          initialLoading: false,
          refreshing: false,
          error: getApiErrorMessage(error, FALLBACK_ERROR),
        }));
      } finally {
        if (inFlightRef.current?.requestId === requestId) {
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = { accessToken, requestId, promise };
    return promise;
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { ...state, refresh };
}
