import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';
import { ApiError } from '../shared/errors';
import type { AppEnv } from './types';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertCsrf(c: Context<AppEnv>): void {
  if (!WRITE_METHODS.has(c.req.method)) {
    return;
  }
  const contentType = (c.req.header('content-type') ?? '').toLowerCase();
  const origin = c.req.header('origin');
  const marker = c.req.header('x-volontari-request');
  const expected = new URL(c.req.url).origin;
  if (marker !== '1' || origin !== expected || !contentType.startsWith('application/json')) {
    throw new ApiError(
      403,
      'csrf_rejected',
      'La richiesta non è stata accettata. Ricarica la pagina e riprova.',
    );
  }
}

export function queryOf<T extends ZodType>(schema: T) {
  return zValidator('query', schema, (result) => {
    if (!result.success) {
      const fields = fieldsFromZod(result.error as unknown as IssueCollection);
      if (Object.keys(fields).length > 0) {
        throw new ApiError(400, 'validation_error', 'Controlla i campi evidenziati.', { fields });
      }
      throw new ApiError(400, 'validation_error', 'Controlla i campi evidenziati.');
    }
  });
}

export function jsonBody<T extends ZodType>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      const fields = fieldsFromZod(result.error as unknown as IssueCollection);
      if (Object.keys(fields).length > 0) {
        throw new ApiError(400, 'validation_error', 'Controlla i campi evidenziati.', { fields });
      }
      throw new ApiError(400, 'validation_error', 'Controlla i campi evidenziati.');
    }
  });
}

export function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ApiError(400, 'validation_error', 'Identificativo non valido.');
  }
  return value.toLowerCase();
}

export function linkWithFragment(request: Request, pathname: string, token: string): string {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  url.hash = token;
  return url.href;
}

type IssueCollection = {
  issues: readonly {
    code: string;
    message: string;
    path: readonly PropertyKey[];
    keys?: readonly PropertyKey[];
  }[];
};

function fieldsFromZod(error: IssueCollection): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys' && 'keys' in issue && Array.isArray(issue.keys)) {
      for (const key of issue.keys) {
        if (typeof key === 'string' && !fields[key]) {
          fields[key] = 'Campo non previsto.';
        }
      }
      continue;
    }
    const key = issue.path.map((part) => String(part)).join('.') || 'body';
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}
