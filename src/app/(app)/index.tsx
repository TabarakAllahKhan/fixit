import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { colors, fontFamily } from '@/constants/theme';

export default function Home() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Fix-It</Text>
        <Text style={styles.title}>Is it a 5-minute fix?</Text>
        <Text style={styles.sub}>
          Snap the model sticker or the error display, then get clear next steps.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/scan')}
        style={({ pressed }) => [styles.primaryAction, pressed && styles.primaryActionPressed]}
      >
        <Text style={styles.primaryActionText}>Scan sticker / error code</Text>
      </Pressable>

      <View style={styles.accountCard}>
        <Text style={styles.accountLabel}>Signed in as</Text>
        <Text style={styles.accountValue}>{user?.email ?? 'your account'}</Text>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, gap: 20 },
  header: { gap: 8, paddingTop: 8 },
  eyebrow: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: colors.heading,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.secondary,
  },
  primaryAction: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryActionPressed: { backgroundColor: colors.primaryPressed },
  primaryActionText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    color: colors.white,
  },
  accountCard: {
    marginTop: 'auto',
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  accountLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.secondary,
  },
  accountValue: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    color: colors.heading,
  },
  signOut: {
    marginTop: 8,
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    color: colors.primary,
  },
});
