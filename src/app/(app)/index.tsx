import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveDiagnosisCard } from '@/components/home/ActiveDiagnosisCard';
import { ApplianceSection } from '@/components/home/ApplianceSection';
import { HomeHeader } from '@/components/home/HomeHeader';
import { RecentDiagnosisSection } from '@/components/home/RecentDiagnosisSection';
import { ScanHero } from '@/components/home/ScanHero';
import { colors, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useHomeData } from '@/hooks/useHomeData';
import { getGreeting } from '@/lib/home-presentation';

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const { appliances, diagnoses, refresh } = useHomeData();
  const [greeting, setGreeting] = useState(() => getGreeting());

  useFocusEffect(
    useCallback(() => {
      setGreeting(getGreeting());
    }, []),
  );

  const openScan = useCallback(() => router.push('/scan'), [router]);
  const openAddAppliance = useCallback(() => router.push('/appliances/new'), [router]);
  const openAppliances = useCallback(() => router.push('/appliances'), [router]);
  const openDiagnosis = useCallback((id: string) => router.push(`/diagnose/${id}`), [router]);
  const openProfile = useCallback(() => router.push('/profile'), [router]);

  const activeDiagnosis = diagnoses.items.find((session) => session.status === 'OPEN') ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <HomeHeader user={user} greeting={greeting} onOpenProfile={openProfile} />
        <ScanHero onScan={openScan} onAddAppliance={openAddAppliance} />
        <ActiveDiagnosisCard
          session={activeDiagnosis}
          loading={diagnoses.loading}
          error={diagnoses.error}
          onResume={openDiagnosis}
          onRetry={refresh}
        />
        <ApplianceSection
          section={appliances}
          onAdd={openAddAppliance}
          onSeeAll={openAppliances}
          onRetry={refresh}
        />
        <RecentDiagnosisSection section={diagnoses} onSelect={openDiagnosis} onRetry={refresh} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
});
