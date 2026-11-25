import type { ApiErrorBody, ApiSuccess } from '@/types/auth';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

/** Null until a public API URL is provided. Never fall back to a hardcoded server. */
export const API_BASE_URL = configuredUrl || null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  accessToken?: string | null;
};

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.success !== false || !record.error || typeof record.error !== 'object') return false;
  const error = record.error as Record<string, unknown>;
  return typeof error.code === 'string' && typeof error.message === 'string';
}

function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.success === true && 'data' in record;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError(
      0,
      'API_NOT_CONFIGURED',
      'Fix-It is not configured to reach the API yet. Please try again later.',
    );
  }

  const { body, accessToken, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');

  if (body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  let response: Response;

  try {
    response = await fetch(url, {
      ...rest,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to reach Fix-It right now. Check your connection and try again.',
    );
  }

  let payload: unknown = null;
  try {
    const text = await response.text();
    if (text) payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError(response.status, payload.error.code, payload.error.message);
    }
    throw new ApiError(response.status, 'REQUEST_FAILED', 'Something went wrong. Please try again.');
  }

  if (isApiSuccess<T>(payload)) {
    return payload.data;
  }

  throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.');
}
