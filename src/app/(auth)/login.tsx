import { useRef, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { AuthTextField, PasswordField, type AuthTextInputRef } from '@/components/auth/AuthTextField';
import { FormMessage } from '@/components/auth/FormMessage';
import { useAuth } from '@/context/AuthContext';
import { getAuthErrorMessage } from '@/lib/auth-error';
import {
  isEmailIdentifier,
  normalizeEmail,
  normalizeUsername,
  validateLoginIdentifier,
  validateLoginPassword,
} from '@/lib/auth-validation';
import type { LoginRequest } from '@/types/auth';

type FieldErrors = {
  identifier: string | null;
  password: string | null;
};

const EMPTY_ERRORS: FieldErrors = { identifier: null, password: null };

export default function LoginScreen() {
  const { signIn } = useAuth();
  const passwordRef = useRef<AuthTextInputRef>(null);
  const submittingRef = useRef(false);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>(EMPTY_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryNoticeVisible, setRecoveryNoticeVisible] = useState(false);

  function validate(): boolean {
    const nextErrors: FieldErrors = {
      identifier: validateLoginIdentifier(identifier),
      password: validateLoginPassword(password),
    };
    setErrors(nextErrors);
    return !nextErrors.identifier && !nextErrors.password;
  }

  async function handleSubmit() {
    if (submittingRef.current || !validate()) return;

    const value = identifier.trim().toLowerCase();
    const input: LoginRequest = isEmailIdentifier(value)
      ? { email: normalizeEmail(value), password }
      : { username: normalizeUsername(value), password };

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      await signIn(input);
      Keyboard.dismiss();
    } catch (error) {
      setFormError(getAuthErrorMessage(error, 'We could not sign you in. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const footer = (
    <View className="flex-row flex-wrap items-center justify-center gap-x-1">
      <Text className="font-manrope text-[14px] leading-5 text-secondary">New to Fix-It? </Text>
      <Link href="/signup" asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Create an account"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text className="font-manrope-semibold text-[14px] leading-5 text-primary">
            Create account
          </Text>
        </Pressable>
      </Link>
    </View>
  );

  return (
    <AuthScreenShell
      eyebrow="Account access"
      title="Welcome back"
      subtitle="Sign in to continue."
      footer={footer}
    >
      <AuthTextField
        label="Email or username"
        value={identifier}
        onChangeText={(value) => {
          setIdentifier(value);
          if (errors.identifier) setErrors((current) => ({ ...current, identifier: null }));
          if (formError) setFormError(null);
        }}
        error={errors.identifier}
        placeholder="Enter email or username"
        icon="account-outline"
        autoComplete="username"
        textContentType="username"
        keyboardType="default"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        blurOnSubmit={false}
        editable={!submitting}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />

      <View className="gap-[6px]">
        <PasswordField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors((current) => ({ ...current, password: null }));
            if (formError) setFormError(null);
          }}
          error={errors.password}
          placeholder="Enter password"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          editable={!submitting}
          onSubmitEditing={() => void handleSubmit()}
        />
        <View className="items-end">
          <Pressable
            onPress={() => setRecoveryNoticeVisible((visible) => !visible)}
            accessibilityRole="button"
            accessibilityLabel="Forgot password"
            accessibilityHint="Shows information about password recovery"
            accessibilityState={{ expanded: recoveryNoticeVisible }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            className="min-h-[44px] justify-center"
          >
            <Text className="font-manrope-medium text-[13px] leading-[18px] text-secondary underline">
              Forgot password?
            </Text>
          </Pressable>
        </View>
        {recoveryNoticeVisible ? (
          <Text
            accessibilityLiveRegion="polite"
            className="font-manrope-medium text-[13px] leading-[18px] text-secondary"
          >
            {"Password recovery isn't available yet."}
          </Text>
        ) : null}
      </View>

      {formError ? <FormMessage message={formError} /> : null}

      <AuthPrimaryButton
        label="Sign in"
        loadingLabel="Signing in…"
        loading={submitting}
        onPress={() => void handleSubmit()}
      />
    </AuthScreenShell>
  );
}
