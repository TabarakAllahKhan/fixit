import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontFamily, homeClassName, radius } from '@/constants/theme';
import { getCategoryLabel } from '@/lib/home-presentation';
import type { Appliance } from '@/types/appliance';

interface Props {
  appliance: Appliance;
  onPress: () => void;
}

function displayName(appliance: Appliance): string {
  return appliance.nickname?.trim() || appliance.brand.trim();
}

function displayMeta(appliance: Appliance): string {
  const nickname = appliance.nickname?.trim();
  const brand = appliance.brand.trim();
  const model = appliance.modelNumber?.trim();
  const parts: string[] = [];

  // The title already carries the brand when there is no nickname.
  if (nickname && nickname !== brand) parts.push(brand);
  if (model) parts.push(`Model ${model}`);
  parts.push(getCategoryLabel(appliance.category));
  return parts.join(' · ');
}

/** Compact saved-appliance row, styled like the Home appliance cards. */
export function ApplianceRow({ appliance, onPress }: Props) {
  const name = displayName(appliance);
  const meta = displayMeta(appliance);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${meta}`}
      onPress={onPress}
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
        <Text style={styles.title} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.forest} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  title: { fontFamily: fontFamily.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  meta: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: colors.bannerSubtitle },
  cardPressed: { backgroundColor: colors.surfaceAlt },
});
