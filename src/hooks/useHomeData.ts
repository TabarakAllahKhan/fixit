import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import {
  attachApplianceNames,
  extractErrorCode,
  listAppliances,
  listDiagnosisSessions,
  listSessionMessages,
} from '@/lib/home-api';
import { getErrorMessage } from '@/lib/home-presentation';
import type { Appliance, DiagnosisSummary } from '@/types/home';

export interface HomeSection<T> {
  items: T[];
  loading: boolean;
  error: string | null;
}

const INITIAL_APPLIANCES: HomeSection<Appliance> = { items: [], loading: true, error: null };
const INITIAL_DIAGNOSES: HomeSection<DiagnosisSummary> = { items: [], loading: true, error: null };

/** Loads only the authenticated user's own appliances and diagnosis sessions. */
export function useHomeData() {
  const { accessToken } = useAuth();
  const [appliances, setAppliances] = useState<HomeSection<Appliance>>(INITIAL_APPLIANCES);
  const [diagnoses, setDiagnoses] = useState<HomeSection<DiagnosisSummary>>(INITIAL_DIAGNOSES);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const token = accessToken;
      // Retry increments `attempt`; referencing it here keeps the effect in
      // sync with the explicit refresh trigger.
      void attempt;

      setAppliances({ items: [], loading: true, error: null });
      setDiagnoses({ items: [], loading: true, error: null });

      void (async () => {
        const [applianceResult, sessionResult] = await Promise.allSettled([
          listAppliances(token),
          listDiagnosisSessions(token),
        ]);
        if (!active) return;

        const applianceItems = applianceResult.status === 'fulfilled' ? applianceResult.value.items : [];

        if (applianceResult.status === 'fulfilled') {
          setAppliances({ items: applianceItems, loading: false, error: null });
        } else {
          setAppliances({ items: [], loading: false, error: getErrorMessage(applianceResult.reason) });
        }

        if (sessionResult.status !== 'fulfilled') {
          setDiagnoses({ items: [], loading: false, error: getErrorMessage(sessionResult.reason) });
          return;
        }

        const withNames = attachApplianceNames(sessionResult.value.items, applianceItems);
        const summaries = await Promise.all(
          withNames.map(async (session) => {
            // A missing code is legitimate; an individual message failure must
            // not blank the whole recent list.
            let errorCode: string | null = null;
            try {
              const messages = await listSessionMessages(token, session.id);
              errorCode = extractErrorCode(session, messages.items[0]?.content ?? null);
            } catch {
              errorCode = null;
            }
            return { ...session, errorCode } satisfies DiagnosisSummary;
          }),
        );

        if (!active) return;
        setDiagnoses({ items: summaries, loading: false, error: null });
      })();

      return () => {
        active = false;
      };
    }, [accessToken, attempt]),
  );

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  return { appliances, diagnoses, refresh };
}
