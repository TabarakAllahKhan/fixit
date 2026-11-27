import { useCallback, useEffect } from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ApplianceListView } from '@/components/appliances/ApplianceListView';
import { useAppliances } from '@/hooks/useAppliances';

export default function Appliances() {
  const router = useRouter();
  const params = useLocalSearchParams<{ created?: string }>();
  const createdId = Array.isArray(params.created) ? params.created[0] : params.created;
  const { items, initialLoading, refreshing, error, refresh } = useAppliances();

  // Phase 3 registers `appliances/[id]`; rows already point at that route.
  const openDetail = useCallback((id: string) => router.push(`/appliances/${id}` as Href), [router]);
  const openCreate = useCallback(() => router.push('/appliances/new'), [router]);

  // A successful create navigates here with the new record's id. Reuse the
  // refresh from useAppliances so the list is guaranteed to show it.
  useEffect(() => {
    if (createdId) void refresh();
  }, [createdId, refresh]);

  return (
    <ApplianceListView
      items={items}
      initialLoading={initialLoading}
      refreshing={refreshing}
      error={error}
      onRefresh={refresh}
      onRetry={refresh}
      onSelect={openDetail}
      onAdd={openCreate}
    />
  );
}
