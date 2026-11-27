import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, fontFamily, homeClassName, radius, spacing } from '@/constants/theme';
import type { HomeSection } from '@/hooks/useHomeData';
import { formatSessionDate, getStatusLabel, getVerdictLabel } from '@/lib/home-presentation';
import type { DiagnosisSummary } from '@/types/home';

interface Props {
  section: HomeSection<DiagnosisSummary>;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

/** Horizontal diagnosis-history cards with status and a resume affordance. */
export function RecentDiagnosisSection({ section, onSelect, onRetry }: Props) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recent diagnosis</Text>

      {section.loading && (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} className={homeClassName.listCard}>
              <View style={[styles.badge, styles.placeholder]} />
              <View style={styles.copy}>
                <View style={[styles.placeholderLine, styles.placeholderTitle]} />
                <View style={styles.placeholderLine} />
              </View>
              <View style={[styles.statusPill, styles.placeholder]} />
            </View>
          ))}
        </View>
      )}

      {!section.loading && section.error && (
        <View style={styles.messageCard}>
          <Text style={styles.messageTitle}>Couldn’t load your history</Text>
          <Text style={styles.messageBody} numberOfLines={2}>
            {section.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry diagnosis history"
            onPress={onRetry}
            hitSlop={8}
          >
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!section.loading && !section.error && section.items.length === 0 && (
        <View style={styles.messageCard}>
          <Text style={styles.messageTitle}>No diagnosis history yet</Text>
          <Text style={styles.messageBody}>
            Completed and in-progress checks will be listed here.
          </Text>
        </View>
      )}

      {!section.loading && !section.error && section.items.length > 0 && (
        <View style={styles.list}>
          {section.items.map((item) => {
            const verdict = getVerdictLabel(item.verdict);
            const date = formatSessionDate(item.createdAt);
            const subtitle = [item.applianceName ?? 'Appliance unavailable', verdict, date]
              .filter(Boolean)
              .join(' · ');
            const status = getStatusLabel(item.status);

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Diagnosis ${item.errorCode ?? ''} ${status} ${subtitle}`}
                onPress={() => onSelect(item.id)}
                className={homeClassName.listCard}
                style={({ pressed }) => (pressed ? styles.cardPressed : undefined)}
              >
                <View style={styles.badge}>
                  <Text
                    style={styles.codeText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {item.errorCode ?? '—'}
                  </Text>
                </View>
                <View style={styles.copy}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.errorCode ? `Error ${item.errorCode}` : 'Diagnosis'}
                  </Text>
                  <Text style={styles.cardSubtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                </View>
                <View style={styles.right}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText} numberOfLines={1}>
                      {status}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.forest} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md, marginBottom: spacing.xl },
  sectionTitle: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22, color: colors.ink },
  list: { gap: 10 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    flexShrink: 0,
  },
  codeText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.forest },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontFamily: fontFamily.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  cardSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.bannerSubtitle,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  statusPill: {
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 88,
  },
  statusText: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14, color: colors.forest },
  cardPressed: { backgroundColor: colors.surfaceAlt },
  messageCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
  },
  messageTitle: { fontFamily: fontFamily.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  messageBody: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.bannerSubtitle,
  },
  link: { marginTop: 4, fontFamily: fontFamily.bold, fontSize: 13, color: colors.forest },
  placeholder: { backgroundColor: colors.mist },
  placeholderLine: { height: 8, borderRadius: radius.sm, backgroundColor: colors.mist },
  placeholderTitle: { width: '65%' },
});
