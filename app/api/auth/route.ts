import { NextResponse } from 'next/server';
import {
  createSession,
  destroySession,
  hashPassword,
  normalizeUsername,
  setupRequired,
  verifyPassword,
} from '@/app/local-auth';
import { getDatabase } from '@/db/binding';

export async function GET() {
  return NextResponse.json({ setupRequired: await setupRequired() });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  }
  const action = String(body.action ?? '');
  const db = getDatabase();
  try {
    if (action === 'setup') {
      if (!(await setupRequired()))
        return NextResponse.json(
          { error: 'O administrador já foi cadastrado.' },
          { status: 409 },
        );
      const name = required(body.name, 80);
      const username = normalizeUsername(body.username);
      const phone = clean(body.phone, 24);
      const password = required(body.password, 200);
      const credentials = await hashPassword(password);
      const id = `admin_${crypto.randomUUID()}`;
      await db
        .prepare(
          "INSERT INTO accounts (id, username, name, phone, role, active, password_hash, password_salt, created_at) VALUES ($1, $2, $3, $4, 'admin', 1, $5, $6, $7)",
        )
        .bind(
          id,
          username,
          name,
          normalizePhone(phone),
          credentials.hash,
          credentials.salt,
          Date.now(),
        )
        .run();
      await db
        .prepare(
          "INSERT INTO settings (id, total_bottles, full_bottles, bottle_price_cents, alert_threshold, next_queue_position, updated_at) VALUES (1, 0, 0, 2000, 3, 1, $1) ON CONFLICT (id) DO NOTHING",
        )
        .bind(Date.now())
        .run();
      await createSession(id);
      return NextResponse.json({
        ok: true,
        message: 'Administrador cadastrado.',
      });
    }

    if (action === 'login') {
      const username = normalizeUsername(body.username);
      const password = required(body.password, 200);
      const user = await db
        .prepare(
          "SELECT id, password_hash AS \"passwordHash\", password_salt AS \"passwordSalt\", active FROM accounts WHERE username = $1 LIMIT 1",
        )
        .bind(username)
        .first<{
          id: string;
          passwordHash: string | null;
          passwordSalt: string | null;
          active: number;
        }>();
      const valid = Boolean(
        user?.active &&
        user.passwordHash &&
        user.passwordSalt &&
        (await verifyPassword(password, user.passwordHash, user.passwordSalt)),
      );
      if (!valid || !user)
        return NextResponse.json(
          { error: 'Usuário ou senha incorretos.' },
          { status: 401 },
        );
      await db
        .prepare("DELETE FROM sessions WHERE expires_at <= $1")
        .bind(Date.now())
        .run();
      await createSession(user.id);
      return NextResponse.json({ ok: true, message: 'Login realizado.' });
    }

    if (action === 'logout') {
      await destroySession();
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Não foi possível continuar.';
    return NextResponse.json(
      {
        error: (message.includes('UNIQUE') || (error as { code?: string })?.code === '23505')
          ? 'Este nome de usuário já está em uso.'
          : message,
      },
      { status: 400 },
    );
  }
}

function clean(value: unknown, max: number) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
function required(value: unknown, max: number) {
  const text = clean(value, max);
  if (!text) throw new Error('Preencha todos os campos obrigatórios.');
  return text;
}
function normalizePhone(value: string) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}
