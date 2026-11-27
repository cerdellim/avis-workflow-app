export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

type ApiErrorOptions = {
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
};

export class ApiError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(status: ErrorStatus, code: string, message: string, options?: ApiErrorOptions) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options?.fields) {
      this.fields = options.fields;
    }
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

const INTERNAL_MESSAGE = 'Si è verificato un errore. Riprova.';

export function errorBody(error: unknown): { status: ErrorStatus; body: ErrorBody } {
  if (error instanceof ApiError) {
    const payload = error.fields
      ? { code: error.code, message: error.message, fields: error.fields }
      : { code: error.code, message: error.message };
    return {
      status: error.status,
      body: { error: payload },
    };
  }

  return {
    status: 500,
    body: { error: { code: 'internal_error', message: INTERNAL_MESSAGE } },
  };
}
