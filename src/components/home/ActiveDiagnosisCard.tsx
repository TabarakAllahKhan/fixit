import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, fontFamily, homeClassName, spacing } from '@/constants/theme';
import type { DiagnosisSummary } from '@/types/home';

interface Props {
  session: DiagnosisSummary | null;
  loading: boolean;
  error: string | null;
  onResume: (id: string) => void;
  onRetry: () => void;
}

export function ActiveDiagnosisCard({ session, loading, error, onResume, onRetry }: Props) {
  const subtitleParts = session
    ? [session.applianceName ?? 'Saved appliance']
    : [];
  if (session?.errorCode) subtitleParts.push(`Error ${session.errorCode}`);
  const subtitle = subtitleParts.join(' · ');

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Active diagnosis</Text>

      {loading && (
        <View style={[styles.card, styles.simpleCard]}>
          <Text style={styles.cardTitle}>Checking for an active diagnosis…</Text>
        </View>
      )}

      {!loading && error && (
        <View style={[styles.card, styles.simpleCard]}>
          <View style={styles.simpleCopy}>
            <Text style={styles.cardTitle}>Couldn’t load your diagnosis</Text>
            <Text style={styles.cardBody} numberOfLines={2}>
              {error}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry diagnosis" onPress={onRetry} hitSlop={8}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && session && (
        <View style={[styles.card, styles.banner]}>
          <View style={styles.left}>
            <View style={styles.amberCircle}>
              <View style={styles.amberDot} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                Diagnosis in progress
              </Text>
              <Text style={styles.cardBody} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Resume diagnosis${session.errorCode ? ` for ${session.errorCode}` : ''}`}
            onPress={() => onResume(session.id)}
            className={homeClassName.chevronTouch}
            style={({ pressed }) => (pressed ? styles.chevronPressed : undefined)}
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.forest} />
          </Pressable>
        </View>
      )}

      {!loading && !error && !session && (
        <View style={[styles.card, styles.simpleCard]}>
          <View style={styles.simpleCopy}>
            <Text style={styles.cardTitle}>No active diagnosis</Text>
            <Text style={styles.cardBody}>Start a scan and you can pick it up right here.</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18, gap: spacing.md, marginBottom: spacing.xl },
  sectionTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    padding: 14,
  },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  simpleCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  amberCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bannerAmberSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  amberDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.bannerAmber },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  simpleCopy: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  cardBody: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.bannerSubtitle,
  },
  chevronPressed: { opacity: 0.55 },
  retry: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.forest },
});
