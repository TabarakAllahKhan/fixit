// An error that is safe to expose to the client. Services throw this for
// expected failures (bad credentials, duplicate account, expired token), and
// the central error handler maps it to the standard error envelope. Unknown
// errors still become a generic 500 so internals are never leaked.
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
