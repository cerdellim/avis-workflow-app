export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    if (fields) {
      this.fields = fields;
    }
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET';
  const writes = method !== 'GET' && method !== 'HEAD';
  const headers = new Headers();
  if (writes) {
    headers.set('Content-Type', 'application/json');
    headers.set('X-Volontari-Request', '1');
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: writes ? JSON.stringify(init?.body ?? {}) : null,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toError(response.status, payload);
  }
  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  return "Non riesco a completare l'operazione. Riprova.";
}

function toError(status: number, payload: unknown): ApiClientError {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const record = error as { code?: unknown; message?: unknown; fields?: unknown };
      const fields = isFieldMap(record.fields) ? record.fields : undefined;
      return new ApiClientError(
        status,
        typeof record.code === 'string' ? record.code : 'request_failed',
        typeof record.message === 'string' ? record.message : 'Richiesta non riuscita.',
        fields,
      );
    }
  }
  return new ApiClientError(status, 'request_failed', 'Richiesta non riuscita.');
}

function isFieldMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === 'string');
}
