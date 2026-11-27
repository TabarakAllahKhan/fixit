import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthLogoAnimation } from '@/components/auth/AuthLogoAnimation';
import { colors, fontFamily, homeClassName } from '@/constants/theme';
import { capitalizeUsername, getInitials } from '@/lib/home-presentation';
import type { PublicUser } from '@/types/auth';

interface Props {
  user: PublicUser | null;
  greeting: string;
  onOpenProfile: () => void;
}

/** Single-row brand header. The avatar opens the dedicated Profile route. */
export function HomeHeader({ user, greeting, onOpenProfile }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.left}>
        <View style={styles.brandBadge}>
          <AuthLogoAnimation size={36} speed={0.58} loop />
        </View>
        <View style={styles.copy}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.username} numberOfLines={1}>
            {capitalizeUsername(user?.username)}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open profile"
        onPress={onOpenProfile}
        className={homeClassName.avatar}
        style={({ pressed }) => (pressed ? styles.avatarPressed : undefined)}
        hitSlop={6}
      >
        <Text style={styles.avatarText}>{getInitials(user?.username)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  brandBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  greeting: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
    color: colors.forest,
  },
  username: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 25,
    color: colors.ink,
  },
  avatarPressed: { opacity: 0.8 },
  avatarText: { fontFamily: fontFamily.bold, fontSize: 14, color: colors.ink },
});
