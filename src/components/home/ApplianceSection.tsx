import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontFamily, homeClassName, radius, spacing } from '@/constants/theme';
import type { HomeSection } from '@/hooks/useHomeData';
import { getCategoryLabel } from '@/lib/home-presentation';
import type { Appliance } from '@/types/home';

interface Props {
  section: HomeSection<Appliance>;
  onAdd: () => void;
  onSeeAll: () => void;
  onRetry: () => void;
}

const VISIBLE_COUNT = 4;

function displayName(appliance: Appliance): string {
  return appliance.nickname?.trim() || appliance.brand;
}

function displayMeta(appliance: Appliance): string {
  const model = appliance.modelNumber?.trim();
  return model ? `${appliance.brand} · Model ${model}` : getCategoryLabel(appliance.category);
}

/** Horizontal saved-appliance cards with a leading category badge. */
export function ApplianceSection({ section, onAdd, onSeeAll, onRetry }: Props) {
  const visible = section.items.slice(0, VISIBLE_COUNT);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Saved appliances</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all appliances"
          onPress={onSeeAll}
          hitSlop={8}
        >
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>

      {section.loading && (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} className={homeClassName.listCard}>
              <View style={[styles.badge, styles.placeholder]} />
              <View style={styles.copy}>
                <View style={[styles.placeholderLine, styles.placeholderTitle]} />
                <View style={styles.placeholderLine} />
              </View>
            </View>
          ))}
        </View>
      )}

      {!section.loading && section.error && (
        <View style={styles.messageCard}>
          <Text style={styles.messageTitle}>Couldn’t load appliances</Text>
          <Text style={styles.messageBody} numberOfLines={2}>
            {section.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry appliances"
            onPress={onRetry}
            hitSlop={8}
          >
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!section.loading && !section.error && visible.length === 0 && (
        <View style={styles.messageCard}>
          <Text style={styles.messageTitle}>No appliances saved yet</Text>
          <Text style={styles.messageBody}>
            Add one so diagnosis can start with the right appliance details.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save appliance"
            onPress={onAdd}
            hitSlop={8}
          >
            <Text style={styles.link}>Save appliance</Text>
          </Pressable>
        </View>
      )}

      {!section.loading && !section.error && visible.length > 0 && (
        <View style={styles.list}>
          {visible.map((appliance) => (
            <Pressable
              key={appliance.id}
              accessibilityRole="button"
              accessibilityLabel={`${displayName(appliance)}, ${displayMeta(appliance)}`}
              onPress={onSeeAll}
              className={homeClassName.listCard}
              style={({ pressed }) => (pressed ? styles.cardPressed : undefined)}
            >
              <View style={styles.badge}>
                <MaterialCommunityIcons
                  name={appliance.category === 'REFRIGERATOR' ? 'fridge-outline' : 'washing-machine'}
                  size={22}
                  color={colors.forest}
                />
              </View>
              <View style={styles.copy}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {displayName(appliance)}
                </Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {displayMeta(appliance)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.forest} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md, marginBottom: spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22, color: colors.ink },
  seeAll: { fontFamily: fontFamily.semiBold, fontSize: 13, color: colors.forest },
  list: { gap: 10 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontFamily: fontFamily.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  cardSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.bannerSubtitle,
  },
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
