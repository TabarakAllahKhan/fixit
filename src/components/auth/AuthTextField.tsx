import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@/constants/theme';

export type AuthTextInputRef = TextInputInstance;

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string | null;
  helper?: string | null;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  trailing?: ReactNode;
}

export const AuthTextField = forwardRef<AuthTextInputRef, Props>(function AuthTextField(
  { label, error, hint, helper, icon, trailing, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const focusProgress = useMemo(() => new Animated.Value(0), []);
  const hasError = Boolean(error);

  useEffect(() => {
    const animation = Animated.timing(focusProgress, {
      toValue: focused || hasError ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, hasError, focusProgress]);

  const borderColor = hasError
    ? colors.error
    : focusProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.border, colors.primary],
      });
  const backgroundColor = hasError
    ? colors.errorSoft
    : focusProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.surface, colors.primarySoft],
      });
  const iconColor = hasError ? colors.error : focused ? colors.primary : colors.muted;

  return (
    <View className="gap-[7px]">
      <Text
        className={`font-manrope-semibold text-[13px] leading-[18px] ${
          hasError ? 'text-error' : 'text-heading'
        }`}
      >
        {label}
      </Text>
      <View className="min-h-[54px] flex-row items-center overflow-hidden rounded-[14px] px-[14px]">
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { borderWidth: 1.5, borderRadius: 14, borderColor, backgroundColor },
          ]}
        />
        <View className="relative z-10 flex-1 flex-row items-center">
          {icon ? (
            <MaterialCommunityIcons
              name={icon}
              size={20}
              color={iconColor}
              style={styles.leadingIcon}
            />
          ) : null}
          <TextInput
            ref={ref}
            {...props}
            placeholderTextColor={colors.muted}
            selectionColor={colors.primary}
            accessibilityLabel={props.accessibilityLabel ?? label}
            className="min-h-[52px] flex-1 py-[13px] font-manrope-medium text-[16px] leading-[22px] text-heading"
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
          />
          {trailing}
        </View>
      </View>
      {error ? (
        <View className="flex-row items-start gap-1.5">
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.error} />
          <Text className="flex-1 font-manrope-medium text-[13px] leading-[18px] text-error">
            {error}
          </Text>
        </View>
      ) : hint ?? helper ? (
        <Text className="font-manrope-medium text-[13px] leading-[18px] text-secondary">
          {hint ?? helper}
        </Text>
      ) : null}
    </View>
  );
});

interface PasswordProps extends Omit<Props, 'secureTextEntry' | 'trailing'> {
  icon?: Props['icon'];
}

export const PasswordField = forwardRef<AuthTextInputRef, PasswordProps>(function PasswordField(
  { icon = 'lock-outline', ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const toggleOpacity = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    toggleOpacity.setValue(0.45);
    const animation = Animated.timing(toggleOpacity, {
      toValue: 1,
      duration: 140,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, toggleOpacity]);

  return (
    <AuthTextField
      ref={ref}
      {...props}
      icon={icon}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      trailing={
        <Animated.View style={{ opacity: toggleOpacity }}>
          <Pressable
            onPress={() => setVisible((current) => !current)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            android_ripple={{ color: colors.primarySoft, borderless: true }}
            className="ml-1 h-10 w-10 items-center justify-center rounded-full"
          >
            <MaterialCommunityIcons
              name={visible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.secondary}
            />
          </Pressable>
        </Animated.View>
      }
    />
  );
});

const styles = StyleSheet.create({
  leadingIcon: { marginRight: 10 },
});
