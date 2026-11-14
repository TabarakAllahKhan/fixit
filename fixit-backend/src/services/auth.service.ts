import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
} from '../validators/auth.validator.js';
import { HttpError } from '../utils/httpError.js';
import { hashPassword, verifyPassword } from './password.service.js';
import {
  generateRefreshToken,
  generateTokenFamilyId,
  getRefreshTokenExpiry,
  hashRefreshToken,
  signAccessToken,
} from './token.service.js';

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  createdAt: true,
  updatedAt: true,
} as const;

type UserRecord = {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicUser = UserRecord;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

export type AuthResult = {
  user: PublicUser;
  tokens: AuthTokens;
};

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function buildTokenPair(userId: string, refreshToken: string): AuthTokens {
  return {
    accessToken: signAccessToken(userId),
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

// Prisma reports a unique-index violation as P2002. The target tells us which
// field collided, but its shape differs between adapters, so handle both.
function uniqueConstraintTarget(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') {
    return null;
  }

  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.join(',');
  }

  return typeof target === 'string' ? target : '';
}

function duplicateAccountError(error: unknown): HttpError | null {
  const target = uniqueConstraintTarget(error);
  if (target === null) {
    return null;
  }

  if (target.includes('email')) {
    return new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
  }

  if (target.includes('username')) {
    return new HttpError(409, 'USERNAME_ALREADY_EXISTS', 'This username is already taken');
  }

  return new HttpError(409, 'ACCOUNT_ALREADY_EXISTS', 'An account with these details already exists');
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.email }, { username: input.username }],
    },
    select: {
      email: true,
      username: true,
    },
  });

  if (existing) {
    if (existing.email === input.email) {
      throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }
    throw new HttpError(409, 'USERNAME_ALREADY_EXISTS', 'This username is already taken');
  }

  const passwordHash = await hashPassword(input.password);
  const refreshToken = generateRefreshToken();
  const tokenFamilyId = generateTokenFamilyId();

  try {
    // Create the user and their first refresh token together: a user without a
    // token could never authenticate, so registration must not half-succeed.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          username: input.username,
          passwordHash,
        },
        select: publicUserSelect,
      });

      await tx.refreshToken.create({
        data: {
          userId: created.id,
          familyId: tokenFamilyId,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: getRefreshTokenExpiry(),
        },
      });

      return created;
    });

    return {
      user,
      tokens: buildTokenPair(user.id, refreshToken),
    };
  } catch (error) {
    const duplicate = duplicateAccountError(error);
    if (duplicate) {
      throw duplicate;
    }
    throw error;
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: input.email ? { email: input.email } : { username: input.username! },
  });

  // Use the same error for an unknown account and a bad password so the
  // response cannot be used to enumerate registered emails or usernames.
  if (!user) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email/username or password is incorrect');
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email/username or password is incorrect');
  }

  const refreshToken = generateRefreshToken();
  const tokenFamilyId = generateTokenFamilyId();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId: tokenFamilyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  return {
    user: toPublicUser(user),
    tokens: buildTokenPair(user.id, refreshToken),
  };
}

async function revokeTokenFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: {
      familyId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function refresh(rawRefreshToken: string): Promise<AuthTokens> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawRefreshToken) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!stored) {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  // Presenting a token that was already rotated (or revoked by logout/password
  // change) means the credential has leaked or been replayed. Kill every token
  // in the family, not just this one, so a stolen successor cannot be used.
  if (stored.revokedAt) {
    await revokeTokenFamily(stored.familyId);
    throw new HttpError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  const nextRefreshToken = generateRefreshToken();
  const nextExpiry = getRefreshTokenExpiry();

  // The conditional update is the atomic gate: only one concurrent request can
  // flip revokedAt from NULL to a timestamp and create the successor. A loser
  // waits for the winner's row lock, then gets count 0.
  const rotated = await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: {
        id: stored.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    if (revoked.count !== 1) {
      return false;
    }

    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        familyId: stored.familyId,
        tokenHash: hashRefreshToken(nextRefreshToken),
        expiresAt: nextExpiry,
      },
    });

    return true;
  });

  if (!rotated) {
    // This request lost the race (or the token expired between read/update).
    // Revoke the family after the winning transaction commits, including the
    // successor it just created, then reject the replay.
    await revokeTokenFamily(stored.familyId);
    throw new HttpError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used');
  }

  return buildTokenPair(stored.userId, nextRefreshToken);
}

export async function logout(rawRefreshToken: string): Promise<void> {
  // Logout is deliberately idempotent: an unknown, expired or already-revoked
  // token still returns success so the endpoint does not leak token state.
  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: hashRefreshToken(rawRefreshToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
  }

  const currentMatches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  // Compare against the verified current password so a user cannot "change" to
  // the same secret and keep sessions alive.
  if (input.newPassword === input.currentPassword) {
    throw new HttpError(
      400,
      'PASSWORD_UNCHANGED',
      'New password must be different from the current password',
    );
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  // Password update and refresh-token revocation must succeed together. Every
  // active session is revoked so the new password must be used to log in again.
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    if (updated.count !== 1) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
    }

    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  });
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    // The access token was valid but the account has since been deleted.
    throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
  }

  return user;
}
