import { type ReactNode } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthLogoAnimation } from '@/components/auth/AuthLogoAnimation';
import { colors } from '@/constants/theme';

interface Props {
  eyebrow: string;
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
}

const MAX_CONTENT_WIDTH = 440;

/**
 * Shared Login/Signup shell. The animated Fix-It logo is horizontally centered
 * in a stable top slot and keeps its size when the keyboard opens. Android uses
 * keyboard padding so the submit button stays reachable. The logo component
 * owns playback and reduced-motion behavior.
 */
export function AuthScreenShell({ eyebrow, title, subtitle, footer, children }: Props) {
  const { width } = useWindowDimensions();
  const shortViewport = Dimensions.get('screen').height < 720;
  const horizontalPadding = Math.min(24, Math.max(20, Math.round(width * 0.06)));
  const logoSize = shortViewport ? 112 : 128;
  const headerGap = shortViewport ? 18 : 24;
  const sectionGap = shortViewport ? 14 : 18;
  const topPadding = shortViewport ? 12 : 20;
  const bottomPadding = shortViewport ? 20 : 28;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'android' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: horizontalPadding,
              paddingTop: topPadding,
              paddingBottom: bottomPadding,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          bounces={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <AuthLogoAnimation size={logoSize} />

            <View style={{ marginTop: headerGap }}>
              <Text className="font-manrope-semibold text-[12px] uppercase leading-4 tracking-[1px] text-primary">
                {eyebrow}
              </Text>
              <Text className="mt-2 font-manrope-bold text-[30px] leading-[36px] tracking-[-0.7px] text-heading">
                {title}
              </Text>
              <Text className="mt-2 font-manrope text-[15px] leading-[22px] text-secondary">
                {subtitle}
              </Text>

              <View style={{ marginTop: sectionGap, gap: shortViewport ? 12 : 14 }}>
                {children}
              </View>

              {footer ? (
                <View
                  style={{
                    marginTop: sectionGap,
                    paddingTop: sectionGap,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  }}
                >
                  {footer}
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    flexGrow: 1,
  },
});
