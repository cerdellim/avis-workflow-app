import { base64Url, equalDigests, fromBase64Url, randomSalt } from './crypto.ts';

export const PASSWORD_ITERATIONS = 10_000;

const HASH_BYTES = 32;
const SALT_BYTES = 16;
const encoder = new TextEncoder();
const DUMMY_SALT = new Uint8Array(SALT_BYTES);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomSalt();
  const hash = await derive(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${base64Url(salt)}$${base64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$') ?? [];
  const salt = parts.length === 4 ? fromBase64Url(parts[2] ?? '') : null;
  const expected = parts.length === 4 ? fromBase64Url(parts[3] ?? '') : null;
  const iterations = Number(parts[1]);
  const usable =
    parts[0] === 'pbkdf2-sha256' &&
    iterations === PASSWORD_ITERATIONS &&
    salt?.byteLength === SALT_BYTES &&
    expected?.byteLength === HASH_BYTES;

  if (!usable || !salt || !expected) {
    await derive(password, DUMMY_SALT, PASSWORD_ITERATIONS);
    return false;
  }

  const actual = await derive(password, salt, PASSWORD_ITERATIONS);
  return equalDigests(actual, expected);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}
