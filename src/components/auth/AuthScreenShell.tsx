import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { colors, fontFamily, spacing, type as typography } from '@/constants/theme';

interface Props {
  eyebrow: string;
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthScreenShell({ eyebrow, title, subtitle, footer, children }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.inner}>
            <View style={styles.brandRow}>
              <Image
                source={require('@/assets/images/splash-icon.png')}
                style={styles.mark}
                contentFit="contain"
                accessibilityLabel="Fix-It logo"
              />
              <View style={styles.brandText}>
                <Text style={styles.brandName}>Fix-It</Text>
                <Text style={styles.brandTag}>Appliance care, made clear</Text>
              </View>
            </View>

            <View style={styles.accentBar} />
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.form}>{children}</View>

            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xl,
  },
  inner: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  mark: {
    width: 42,
    height: 42,
  },
  brandText: {
    flex: 1,
  },
  brandName: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.4,
    color: colors.heading,
  },
  brandTag: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondary,
    marginTop: 1,
  },
  accentBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.title,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.7,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.subtitle,
    maxWidth: 340,
  },
  form: {
    marginTop: spacing.xxl,
    gap: spacing.lg,
  },
  footer: {
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
