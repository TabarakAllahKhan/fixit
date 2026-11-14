import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const ACCESS_TOKEN_TYPE = 'access';
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'fixit-api';
const JWT_AUDIENCE = 'fixit-app';

export type AccessTokenPayload = JwtPayload & {
  sub: string;
  type: typeof ACCESS_TOKEN_TYPE;
};

export function signAccessToken(userId: string): string {
  return jwt.sign({ type: ACCESS_TOKEN_TYPE }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  let payload: string | JwtPayload;

  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch {
    // Expired, malformed and wrong-signature tokens are all the same failure
    // from the client's perspective. Do not echo the library's reason.
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
  }

  if (
    typeof payload === 'string' ||
    payload.type !== ACCESS_TOKEN_TYPE ||
    typeof payload.sub !== 'string'
  ) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
  }

  return payload as AccessTokenPayload;
}

// Refresh tokens are opaque random values, not JWTs. Only their hash is stored,
// so the database can validate them without ever holding a usable credential.
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// A family groups every refresh token produced by one login. Reuse detection
// revokes the whole family so a stolen token cannot survive a rotation.
export function generateTokenFamilyId(): string {
  return randomUUID();
}

export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
