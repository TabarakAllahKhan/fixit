import { forwardRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontFamily } from '@/constants/theme';

export type AuthTextInputRef = TextInputInstance;

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string | null;
  helper?: string | null;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  trailing?: ReactNode;
  hasVisibilityToggle?: boolean;
}

export const AuthTextField = forwardRef<AuthTextInputRef, Props>(function AuthTextField(
  { label, error, hint, helper, icon, trailing, secureTextEntry, hasVisibilityToggle, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isSecure = Boolean(secureTextEntry) && !revealed;
  const hasError = Boolean(error);
  const borderColor = hasError ? colors.error : focused ? colors.primary : colors.border;
  const backgroundColor = hasError ? colors.errorSoft : focused ? colors.surface : colors.surfaceAlt;
  const resolvedTrailing = trailing ?? (hasVisibilityToggle && secureTextEntry ? (
    <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={revealed ? 'Hide password' : 'Show password'} style={styles.eyeBtn}>
      <MaterialCommunityIcons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.secondary} />
    </Pressable>
  ) : null);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, hasError && styles.labelError]}>{label}</Text>
      <View style={[styles.field, { borderColor, backgroundColor }]}>
        {icon ? (
          <MaterialCommunityIcons
            name={icon}
            size={20}
            color={hasError ? colors.error : focused ? colors.primary : colors.muted}
            style={styles.leadingIcon}
          />
        ) : null}
        <TextInput
          ref={ref}
          {...props}
          secureTextEntry={isSecure}
          placeholderTextColor={colors.muted}
          selectionColor={colors.primary}
          accessibilityLabel={props.accessibilityLabel ?? label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
          ]}
        />
        {resolvedTrailing}
      </View>
      {error ? (
        <View style={styles.messageRow}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.error} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (hint ?? helper) ? (
        <Text style={styles.hint}>{hint ?? helper}</Text>
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
  return (
    <AuthTextField
      ref={ref}
      {...props}
      icon={icon}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      trailing={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          style={styles.eyeBtn}
        >
          <MaterialCommunityIcons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={colors.secondary}
          />
        </Pressable>
      }
    />
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.heading,
    letterSpacing: 0.1,
  },
  labelError: { color: colors.error },
  field: {
    minHeight: 54,
    borderWidth: 1.5,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  leadingIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    paddingVertical: 14,
  },
  eyeBtn: { marginLeft: 8, padding: 2 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  error: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
  },
  hint: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondary,
  },
});
