import { cookies } from 'next/headers';
import { getDatabase } from '@/db/binding';

const COOKIE_NAME = 'cota_dagua_session';
const SESSION_DAYS = 7;
const ITERATIONS = 210_000;

export type LocalUser = {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role: 'admin' | 'client';
  active: number;
};

export async function hashPassword(password: string, salt?: string) {
  if (password.length < 8)
    throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const saltBytes = salt
    ? fromBase64(salt)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations: ITERATIONS,
    },
    key,
    256,
  );
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(saltBytes) };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
) {
  const result = await hashPassword(password, salt);
  return timingSafeEqual(fromBase64(result.hash), fromBase64(expectedHash));
}

export async function createSession(userId: string) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(tokenBytes);
  const tokenHash = await sha256(token);
  const now = Date.now();
  await getDatabase()
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(tokenHash, userId, now + SESSION_DAYS * 86400000, now)
    .run();
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token)
    await getDatabase()
      .prepare("DELETE FROM sessions WHERE token_hash = $1")
      .bind(await sha256(token))
      .run();
  jar.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 0,
  });
}

export async function getSessionUser(): Promise<LocalUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const now = Date.now();
  const db = getDatabase();
  const user = await db
    .prepare(
      "SELECT a.id, a.username, a.name, a.phone, a.role, a.active FROM sessions s JOIN accounts a ON a.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2 AND a.active = 1 LIMIT 1",
    )
    .bind(await sha256(token), now)
    .first<LocalUser>();
  if (!user) return null;
  return user;
}

export async function setupRequired() {
  const row = await getDatabase()
    .prepare(
      "SELECT COUNT(*) AS \"total\" FROM accounts WHERE role = 'admin' AND password_hash IS NOT NULL",
    )
    .first<{ total: number }>();
  return Number(row?.total ?? 0) === 0;
}

export function normalizeUsername(value: unknown) {
  const username = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username))
    throw new Error(
      'O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, traço ou sublinhado.',
    );
  return username;
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return toBase64Url(new Uint8Array(bytes));
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function toBase64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function fromBase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
