const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9._-]+$/i;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return 'Enter your email address.';
  if (email.length > 254) return 'Email address is too long.';
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (!username) return 'Choose a username.';
  if (username.length < 3) return 'Use at least 3 characters.';
  if (username.length > 30) return 'Use 30 characters or fewer.';
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use letters, numbers, dots, underscores or hyphens only.';
  }
  return null;
}

export function validateLoginPassword(value: string): string | null {
  if (!value) return 'Enter your password.';
  if (value.length > 72) return 'Password is too long.';
  return null;
}

export function validateSignupPassword(value: string): string | null {
  if (!value) return 'Create a password.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (value.length > 72) return 'Use 72 characters or fewer.';
  return null;
}
