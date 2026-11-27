import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useAnimatedValue,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, fontFamily, homeClassName, radius } from '@/constants/theme';

interface Props {
  onScan: () => void;
  onAddAppliance: () => void;
}

const SCAN_DURATION = 2400;
const SCAN_TOP = 8;
const SCAN_BOTTOM = 82;

/** Hero with a row-based heading/visual area and two equal action buttons. */
export function ScanHero({ onScan, onAddAppliance }: Props) {
  const scan = useAnimatedValue(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        if (mounted) setReduceMotion(false);
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (mounted) setReduceMotion(enabled);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion !== false) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: SCAN_DURATION,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(scan, {
          toValue: 0,
          duration: SCAN_DURATION,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, scan]);

  const scanStyle = useMemo(
    () => ({
      transform: [
        {
          translateY: scan.interpolate({
            inputRange: [0, 1],
            outputRange: [SCAN_TOP, SCAN_BOTTOM],
          }),
        },
      ],
      opacity: scan.interpolate({
        inputRange: [0, 0.14, 0.86, 1],
        outputRange: [0, 0.6, 0.6, 0],
      }),
    }),
    [scan],
  );

  return (
    <View style={styles.hero}>
      <View style={styles.top}>
        <View style={styles.copy}>
          <Text style={styles.kicker}>DIAGNOSIS</Text>
          <Text style={styles.title}>Start with an error code.</Text>
          <Text style={styles.subtitle}>
            Photograph the sticker or display so we can identify the fault.
          </Text>
        </View>

        <View style={styles.viewfinder} accessible accessibilityLabel="Example error code E4">
          {reduceMotion === false && (
            <Animated.View
              pointerEvents="none"
              style={[styles.scanLine, scanStyle]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          )}
          <View style={styles.bracketRow}>
            <View style={[styles.bracket, styles.bracketTopLeft]} />
            <View style={[styles.bracket, styles.bracketTopRight]} />
          </View>
          <View style={styles.viewfinderCenter}>
            <Text style={styles.code}>E4</Text>
            <Text style={styles.codeCaption}>ERROR CODE</Text>
          </View>
          <View style={styles.bracketRow}>
            <View style={[styles.bracket, styles.bracketBottomLeft]} />
            <View style={[styles.bracket, styles.bracketBottomRight]} />
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan error code"
          onPress={onScan}
          className={`${homeClassName.heroAction} ${homeClassName.heroPrimary}`}
          style={({ pressed }) => (pressed ? styles.primaryPressed : undefined)}
        >
          <Ionicons name="scan-outline" size={15} color={colors.ink} />
          <Text style={styles.primaryActionText}>Scan error code</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add appliance"
          onPress={onAddAppliance}
          className={`${homeClassName.heroAction} ${homeClassName.heroSecondary}`}
          style={({ pressed }) => (pressed ? styles.secondaryPressed : undefined)}
        >
          <Ionicons name="add" size={15} color={colors.white} style={styles.actionIcon} />
          <Text style={styles.secondaryActionText}>Add appliance</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.forest,
    borderRadius: radius.xl,
    padding: 20,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  kicker: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
    color: colors.lime,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 27,
    color: colors.white,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.heroSubtitle,
  },
  viewfinder: {
    width: 96,
    height: 96,
    flexShrink: 0,
    padding: 8,
    justifyContent: 'space-between',
    borderRadius: radius.md,
    backgroundColor: colors.forestDeep,
    overflow: 'hidden',
  },
  scanLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.lime,
    shadowColor: colors.lime,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 2,
  },
  bracketRow: { flexDirection: 'row', justifyContent: 'space-between' },
  bracket: { width: 16, height: 16, borderWidth: 2, borderColor: colors.lime },
  bracketTopLeft: { borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  bracketTopRight: { borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bracketBottomLeft: { borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  bracketBottomRight: { borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  viewfinderCenter: { alignItems: 'center', justifyContent: 'center' },
  code: { fontFamily: fontFamily.bold, fontSize: 26, lineHeight: 30, color: colors.lime },
  codeCaption: {
    fontFamily: fontFamily.semiBold,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 1,
    color: colors.heroSubtitle,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  primaryPressed: { opacity: 0.85 },
  secondaryPressed: { backgroundColor: colors.forestDeep },
  actionIcon: { flexShrink: 0 },
  primaryActionText: {
    flexShrink: 1,
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    textAlign: 'center',
    color: colors.ink,
  },
  secondaryActionText: {
    flexShrink: 1,
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 17,
    textAlign: 'center',
    color: colors.white,
  },
});
