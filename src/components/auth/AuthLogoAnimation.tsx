import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';

// Intrinsic composition size from lottie/lotte.json (184 x 238). `size` is the
// rendered height; the width is derived so the mark keeps its proportions.
const LOGO_ASPECT_RATIO = 184 / 238;

interface Props {
  /** Rendered logo height in density-independent pixels. */
  size?: number;
  /** Playback rate. 0.58 stretches the 1.2s composition to roughly 2.1s. */
  speed?: number;
  /** Auth screens play once; Home keeps the mark alive while it is visible. */
  loop?: boolean;
}

/**
 * Shared Login/Signup logo. The Lottie composition contains the full Fix-It
 * identity, so no separate wordmark is rendered. Size and speed stay
 * configurable by the parent while playback remains owned by this component.
 */
export function AuthLogoAnimation({ size = 128, speed = 0.58, loop = false }: Props) {
  const animationRef = useRef<LottieView>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    // Wait for the preference before starting, so reduced-motion users never
    // see an animation frame play.
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

  // Playback is controlled here rather than in the screens, so typing,
  // validation errors, loading state and keyboard changes never restart it.
  // Auth rests on the final frame; Home opts into a continuous loop.
  useEffect(() => {
    if (reduceMotion === false) {
      animationRef.current?.play();
    } else if (reduceMotion === true) {
      animationRef.current?.pause();
      animationRef.current?.reset();
    }
  }, [reduceMotion, loop]);

  const logoStyle = useMemo(
    () => ({ width: size * LOGO_ASPECT_RATIO, height: size }),
    [size],
  );

  return (
    <View style={styles.slot} accessibilityRole="image" accessibilityLabel="Fix-It logo">
      <LottieView
        ref={animationRef}
        source={require('../../../lottie/lotte.json')}
        autoPlay={false}
        loop={loop}
        speed={speed}
        resizeMode="contain"
        style={logoStyle}
        testID="auth-logo-animation"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
