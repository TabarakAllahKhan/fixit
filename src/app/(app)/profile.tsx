import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamily, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { getInitials } from '@/lib/home-presentation';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const goBack = useCallback(() => router.back(), [router]);
  const handleSignOut = useCallback(() => void signOut(), [signOut]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={18} color={colors.forest} />
          <Text style={styles.backText}>Back to home</Text>
        </Pressable>

        <View style={styles.identityCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(user?.username)}</Text>
          </View>
          <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
          <Text style={styles.name} numberOfLines={2}>
            {user?.username ?? 'Unavailable'}
          </Text>
          <Text style={styles.email} numberOfLines={2}>
            {user?.email ?? 'Unavailable'}
          </Text>
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>Account details</Text>
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="person-outline" size={18} color={colors.forest} />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Username</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {user?.username ?? 'Unavailable'}
              </Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="mail-outline" size={18} color={colors.forest} />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Email</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {user?.email ?? 'Unavailable'}
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={handleSignOut}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
        >
          <Ionicons name="log-out-outline" size={19} color={colors.white} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
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
    gap: spacing.lg,
  },
  pressed: { opacity: 0.8 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backText: { fontFamily: fontFamily.semiBold, fontSize: 14, color: colors.forest },
  identityCard: {
    backgroundColor: colors.forest,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { fontFamily: fontFamily.bold, fontSize: 20, color: colors.ink },
  eyebrow: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
    color: colors.lime,
  },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.white,
    textAlign: 'center',
  },
  email: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.heroSubtitle,
    textAlign: 'center',
  },
  detailsCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailsTitle: { fontFamily: fontFamily.bold, fontSize: 17, color: colors.ink },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  detailCopy: { flex: 1, minWidth: 0, gap: 2 },
  detailLabel: { fontFamily: fontFamily.medium, fontSize: 12, color: colors.bannerSubtitle },
  detailValue: { fontFamily: fontFamily.semiBold, fontSize: 15, color: colors.ink },
  signOutButton: {
    minHeight: 52,
    borderRadius: radius.card,
    backgroundColor: colors.forestDeep,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  signOutText: { fontFamily: fontFamily.bold, fontSize: 16, color: colors.white },
});
