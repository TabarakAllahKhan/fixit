import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { AuthTextField, PasswordField, type AuthTextInputRef } from '@/components/auth/AuthTextField';
import { FormMessage } from '@/components/auth/FormMessage';
import { colors, fontFamily } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { getAuthErrorMessage } from '@/lib/auth-error';
import {
  normalizeEmail,
  validateEmail,
  validateLoginPassword,
} from '@/lib/auth-validation';

type FieldErrors = {
  email: string | null;
  password: string | null;
};

const EMPTY_ERRORS: FieldErrors = { email: null, password: null };

export default function LoginScreen() {
  const { signIn } = useAuth();
  const passwordRef = useRef<AuthTextInputRef>(null);
  const submittingRef = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>(EMPTY_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validateLoginPassword(password),
    };
    setErrors(nextErrors);
    return !nextErrors.email && !nextErrors.password;
  }

  async function handleSubmit() {
    if (submittingRef.current || !validate()) return;

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      await signIn({ email: normalizeEmail(email), password });
      Keyboard.dismiss();
    } catch (error) {
      setFormError(getAuthErrorMessage(error, 'We could not sign you in. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const footer = (
    <View style={styles.footerRow}>
      <Text style={styles.footerText}>New to Fix-It? </Text>
      <Link href="/signup" style={styles.footerLink}>
        Create an account
      </Link>
    </View>
  );

  return (
    <AuthScreenShell
      eyebrow="Sign in"
      title="Welcome back"
      subtitle="Sign in to keep your appliance fixes moving."
      footer={footer}
    >
      <AuthTextField
        label="Email address"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (errors.email) setErrors((current) => ({ ...current, email: null }));
          if (formError) setFormError(null);
        }}
        error={errors.email}
        placeholder="you@example.com"
        icon="email-outline"
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        blurOnSubmit={false}
        editable={!submitting}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />

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
        placeholder="Enter your password"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        editable={!submitting}
        onSubmitEditing={() => void handleSubmit()}
      />

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

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  footerText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.secondary,
  },
  footerLink: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.primary,
  },
});
