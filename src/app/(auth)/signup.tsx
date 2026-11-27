import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { AuthTextField, PasswordField, type AuthTextInputRef } from '@/components/auth/AuthTextField';
import { FormMessage } from '@/components/auth/FormMessage';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';
import { getAuthErrorMessage } from '@/lib/auth-error';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateSignupPassword,
  validateUsername,
} from '@/lib/auth-validation';

type FieldErrors = {
  email: string | null;
  username: string | null;
  password: string | null;
};

const EMPTY_ERRORS: FieldErrors = { email: null, username: null, password: null };

export default function SignupScreen() {
  const { signUp, finishSignUp } = useAuth();
  const usernameRef = useRef<AuthTextInputRef>(null);
  const passwordRef = useRef<AuthTextInputRef>(null);
  const submittingRef = useRef(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>(EMPTY_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  const clearFormError = useCallback(() => {
    if (formError) setFormError(null);
  }, [formError]);

  function validate(): boolean {
    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      username: validateUsername(username),
      password: validateSignupPassword(password),
    };
    setErrors(nextErrors);
    return !nextErrors.email && !nextErrors.username && !nextErrors.password;
  }

  async function handleSubmit() {
    if (submittingRef.current || !validate()) return;

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      await signUp({
        email: normalizeEmail(email),
        username: normalizeUsername(username),
        password,
      });
      Keyboard.dismiss();
      setSucceeded(true);
      successTimer.current = setTimeout(() => finishSignUp(), 900);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_EXISTS') {
        setErrors((current) => ({
          ...current,
          email: 'An account with this email already exists.',
        }));
      } else if (error instanceof ApiError && error.code === 'USERNAME_ALREADY_EXISTS') {
        setErrors((current) => ({
          ...current,
          username: 'That username is already taken.',
        }));
      } else {
        setFormError(getAuthErrorMessage(error, 'We could not create your account. Please try again.'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const footer = (
    <View className="flex-row flex-wrap items-center justify-center gap-x-1">
      <Text className="font-manrope text-[14px] leading-5 text-secondary">
        Already have an account?{' '}
      </Text>
      <Link href="/login" asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Sign in"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text className="font-manrope-semibold text-[14px] leading-5 text-primary">Sign in</Text>
        </Pressable>
      </Link>
    </View>
  );

  if (succeeded) {
    return (
      <AuthScreenShell
        eyebrow="All set"
        title="Account created"
        subtitle="Your Fix-It account is ready."
        footer={footer}
      >
        <FormMessage message="Account created. Opening Fix-It…" tone="success" />
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell
      eyebrow="Get started"
      title="Create Account"
      subtitle="Set up your Fix-It account."
      footer={footer}
    >
      <AuthTextField
        label="Email"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (errors.email) setErrors((current) => ({ ...current, email: null }));
          clearFormError();
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
        onSubmitEditing={() => usernameRef.current?.focus()}
      />

      <AuthTextField
        ref={usernameRef}
        label="Username"
        value={username}
        onChangeText={(value) => {
          setUsername(value);
          if (errors.username) setErrors((current) => ({ ...current, username: null }));
          clearFormError();
        }}
        error={errors.username}
        placeholder="yourname"
        icon="account-outline"
        autoComplete="username"
        textContentType="username"
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
          clearFormError();
        }}
        error={errors.password}
        placeholder="At least 8 characters"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        editable={!submitting}
        onSubmitEditing={() => void handleSubmit()}
      />

      {formError ? <FormMessage message={formError} /> : null}

      <AuthPrimaryButton
        label="Create Account"
        loadingLabel="Creating account…"
        loading={submitting}
        onPress={() => void handleSubmit()}
      />
    </AuthScreenShell>
  );
}
