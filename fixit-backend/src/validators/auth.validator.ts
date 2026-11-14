import { z } from 'zod';

// Emails and usernames are normalised here so every lookup (register, login,
// uniqueness checks) uses the same lowercase representation.
const emailSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.email('Enter a valid email address').max(254, 'Email address is too long'),
);

const usernameSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores and hyphens'),
);

// bcrypt only uses the first 72 bytes of a password, so reject longer input
// instead of silently ignoring part of it.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    username: usernameSchema.optional(),
    password: z.string().min(1, 'Password is required').max(72, 'Password is too long'),
  })
  .refine((data) => Boolean(data.email) !== Boolean(data.username), {
    message: 'Provide either email or username, not both',
    path: ['email'],
  });

export const refreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(1, 'Refresh token is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(72, 'Password is too long'),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
