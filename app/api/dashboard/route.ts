import { NextResponse } from 'next/server';
import {
  getSessionUser,
  hashPassword,
  normalizeUsername,
} from '@/app/local-auth';
import { getDatabase, getWhatsAppConfig } from '@/db/binding';

type Member = {
  id: string;
  name: string;
  phone: string | null;
  queuePosition: number;
  creditCents: number;
  active: number;
};

async function currentAccount() {
  const account = await getSessionUser();
  if (!account) return null;
  const db = getDatabase();
  await db
    .prepare(
      `INSERT OR IGNORE INTO settings (id, total_bottles, full_bottles, bottle_price_cents, alert_threshold, next_queue_position, updated_at) VALUES (1, 0, 0, 2000, 3, 1, ?)`,
    )
    .bind(Date.now())
    .run();
  return account;
}

export async function GET() {
  const account = await currentAccount();
  if (!account)
    return NextResponse.json(
      { error: 'Faça login para continuar.' },
      { status: 401 },
    );
  const db = getDatabase();
  const [settings, members, payments, events, notifications] = await db.batch([
    db.prepare(
      'SELECT total_bottles AS totalBottles, full_bottles AS fullBottles, bottle_price_cents AS bottlePriceCents, alert_threshold AS alertThreshold, next_queue_position AS nextQueuePosition FROM settings WHERE id = 1',
    ),
    db.prepare(
      `SELECT u.id, u.name, u.phone, u.queue_position AS queuePosition, u.credit_cents AS creditCents, u.active, (SELECT p.status FROM payments p WHERE p.member_id = u.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS paymentStatus FROM users u WHERE u.role = 'client' ORDER BY u.queue_position, u.name`,
    ),
    db.prepare(
      `SELECT p.id, p.member_id AS memberId, u.name AS memberName, p.bottles, p.total_cents AS totalCents, p.credit_used_cents AS creditUsedCents, p.paid_cents AS paidCents, p.status, p.paid_at AS paidAt, p.created_at AS createdAt FROM payments p JOIN users u ON u.id = p.member_id ORDER BY p.created_at DESC LIMIT 12`,
    ),
    db.prepare(
      `SELECT e.id, e.kind, e.quantity, e.note, e.created_at AS createdAt, a.name AS userName FROM bottle_events e JOIN accounts a ON a.id = e.account_id ORDER BY e.created_at DESC LIMIT 12`,
    ),
    db.prepare(
      `SELECT n.id, n.status, n.message, n.created_at AS createdAt, u.name AS memberName FROM notifications n JOIN users u ON u.id = n.member_id ORDER BY n.created_at DESC LIMIT 8`,
    ),
  ]);
  const accounts =
    account.role === 'admin'
      ? (
          await db
            .prepare(
              `SELECT id, username, name, phone, role, active, created_at AS createdAt FROM accounts ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name`,
            )
            .all()
        ).results
      : [];
  return NextResponse.json({
    account,
    accounts,
    settings: settings.results[0],
    members: members.results,
    payments: payments.results,
    events: events.results,
    notifications: notifications.results,
  });
}

export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account)
    return NextResponse.json(
      { error: 'Faça login para continuar.' },
      { status: 401 },
    );
  const db = getDatabase();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  }
  const action = String(body.action ?? '');
  const adminOnly = [
    'add_member',
    'add_account',
    'set_stock',
    'add_credit',
    'edit_credit',
    'record_payment',
    'send_notification',
    'charge_member',
  ];
  if (adminOnly.includes(action) && account.role !== 'admin')
    return NextResponse.json(
      { error: 'Somente o administrador pode realizar esta ação.' },
      { status: 403 },
    );

  try {
    if (action === 'report_empty') {
      const quantity = positiveInt(body.quantity, 1, 100);
      const current = await db
        .prepare(
          'SELECT full_bottles AS fullBottles FROM settings WHERE id = 1',
        )
        .first<{ fullBottles: number }>();
      if (quantity > Number(current?.fullBottles ?? 0))
        return NextResponse.json(
          { error: 'A quantidade vazia é maior que o estoque cheio.' },
          { status: 400 },
        );
      await db.batch([
        db
          .prepare(
            'UPDATE settings SET full_bottles = MAX(0, full_bottles - ?), updated_at = ? WHERE id = 1',
          )
          .bind(quantity, Date.now()),
        db
          .prepare(
            `INSERT INTO bottle_events (account_id, kind, quantity, note, created_at) VALUES (?, 'empty', ?, ?, ?)`,
          )
          .bind(account.id, quantity, cleanText(body.note, 180), Date.now()),
      ]);
      return NextResponse.json({
        ok: true,
        message: `${quantity} garrafão(ões) informado(s) ao administrador.`,
      });
    }

    if (action === 'set_stock') {
      const total = positiveInt(body.total, 0, 10000);
      const full = positiveInt(body.full, 0, total);
      const priceCents = moneyToCents(body.price);
      const threshold = positiveInt(body.threshold, 0, total);
      await db
        .prepare(
          'UPDATE settings SET total_bottles = ?, full_bottles = ?, bottle_price_cents = ?, alert_threshold = ?, updated_at = ? WHERE id = 1',
        )
        .bind(total, full, priceCents, threshold, Date.now())
        .run();
      await db
        .prepare(
          `INSERT INTO bottle_events (account_id, kind, quantity, note, created_at) VALUES (?, 'adjustment', ?, ?, ?)`,
        )
        .bind(
          account.id,
          full,
          'Estoque configurado pelo administrador',
          Date.now(),
        )
        .run();
      return NextResponse.json({ ok: true, message: 'Estoque atualizado.' });
    }

    if (action === 'add_member') {
      const name = requiredText(body.name, 80);
      const phone = requiredText(body.phone, 24);
      const max = await db
        .prepare(
          `SELECT COALESCE(MAX(queue_position), 0) AS maxPosition FROM users WHERE role = 'client'`,
        )
        .first<{ maxPosition: number }>();
      const id = `member_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO users (id, email, name, phone, role, queue_position, credit_cents, active, created_at) VALUES (?, ?, ?, ?, 'client', ?, 0, 1, ?)`,
        )
        .bind(
          id,
          `${id}@pessoa.cota`,
          name,
          normalizePhone(phone),
          Number(max?.maxPosition ?? 0) + 1,
          Date.now(),
        )
        .run();
      return NextResponse.json({
        ok: true,
        message: `${name} entrou na cota.`,
      });
    }

    if (action === 'add_account') {
      const name = requiredText(body.name, 80);
      const username = normalizeUsername(body.username);
      const password = requiredText(body.password, 200);
      const phone = cleanText(body.phone, 24);
      const credentials = await hashPassword(password);
      const id = `account_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO accounts (id, username, password_hash, password_salt, name, phone, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 'client', 1, ?)`,
        )
        .bind(
          id,
          username,
          credentials.hash,
          credentials.salt,
          name,
          normalizePhone(phone),
          Date.now(),
        )
        .run();
      return NextResponse.json({
        ok: true,
        message: `Usuário ${username} criado com acesso de cliente.`,
      });
    }

    if (action === 'add_credit') {
      const memberId = requiredText(body.memberId, 100);
      const amountCents = moneyToCents(body.amount);
      const member = await db
        .prepare(`SELECT id FROM users WHERE id = ? AND role = 'client'`)
        .bind(memberId)
        .first<{ id: string }>();
      if (!member) throw new Error('Pessoa da cota não encontrada.');
      await db.batch([
        db
          .prepare(
            'UPDATE users SET credit_cents = credit_cents + ? WHERE id = ?',
          )
          .bind(amountCents, memberId),
        db
          .prepare(
            `INSERT INTO credit_transactions (member_id, amount_cents, kind, note, created_at) VALUES (?, ?, 'credit', ?, ?)`,
          )
          .bind(
            memberId,
            amountCents,
            cleanText(body.note, 180) ||
              'Crédito adicionado pelo administrador',
            Date.now(),
          ),
      ]);
      return NextResponse.json({
        ok: true,
        message: 'Crédito lançado com sucesso.',
      });
    }

    if (action === 'edit_credit') {
      const memberId = requiredText(body.memberId, 100);
      const newBalance = nonNegativeMoneyToCents(body.amount);
      const member = await db
        .prepare(
          `SELECT id, name, credit_cents AS creditCents FROM users WHERE id = ? AND role = 'client'`,
        )
        .bind(memberId)
        .first<{ id: string; name: string; creditCents: number }>();
      if (!member) throw new Error('Pessoa da cota não encontrada.');
      const difference = newBalance - Number(member.creditCents);
      if (difference !== 0) {
        await db.batch([
          db
            .prepare(
              `UPDATE users SET credit_cents = ? WHERE id = ? AND role = 'client'`,
            )
            .bind(newBalance, memberId),
          db
            .prepare(
              `INSERT INTO credit_transactions (member_id, amount_cents, kind, note, created_at) VALUES (?, ?, 'adjustment', ?, ?)`,
            )
            .bind(
              memberId,
              difference,
              cleanText(body.note, 180) ||
                'Saldo de crédito corrigido pelo administrador',
              Date.now(),
            ),
        ]);
      }
      return NextResponse.json({
        ok: true,
        message: `Crédito de ${member.name} atualizado para ${formatMoney(newBalance)}.`,
      });
    }

    if (action === 'record_payment') {
      const memberId = requiredText(body.memberId, 100);
      const bottles = positiveInt(body.bottles, 1, 100);
      const [member, config] = await Promise.all([
        db
          .prepare(
            `SELECT id, name, credit_cents AS creditCents, queue_position AS queuePosition FROM users WHERE id = ? AND role = 'client' AND active = 1`,
          )
          .bind(memberId)
          .first<{
            id: string;
            name: string;
            creditCents: number;
            queuePosition: number;
          }>(),
        db
          .prepare(
            'SELECT bottle_price_cents AS bottlePriceCents FROM settings WHERE id = 1',
          )
          .first<{ bottlePriceCents: number }>(),
      ]);
      if (!member) throw new Error('Pessoa não encontrada.');
      const pending = await db
        .prepare(
          `SELECT id, total_cents AS totalCents, credit_used_cents AS creditUsedCents FROM payments WHERE member_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(memberId)
        .first<{ id: number; totalCents: number; creditUsedCents: number }>();
      if (!pending) {
        const latest = await db
          .prepare(
            `SELECT status FROM payments WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          )
          .bind(memberId)
          .first<{ status: 'pending' | 'paid' }>();
        if (latest?.status === 'paid')
          throw new Error(`${member.name} já está marcado como pago.`);
      }
      let totalCents: number;
      let creditUsed: number;
      if (pending) {
        totalCents = pending.totalCents;
        creditUsed = pending.creditUsedCents;
        await db
          .prepare(
            `UPDATE payments SET status = 'paid', paid_cents = total_cents - credit_used_cents, paid_at = ? WHERE id = ?`,
          )
          .bind(Date.now(), pending.id)
          .run();
      } else {
        totalCents = bottles * Number(config?.bottlePriceCents ?? 0);
        creditUsed = Math.min(member.creditCents, totalCents);
        const payment = await db
          .prepare(
            `INSERT INTO payments (member_id, bottles, total_cents, credit_used_cents, paid_cents, status, paid_at, created_at) VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`,
          )
          .bind(
            memberId,
            bottles,
            totalCents,
            creditUsed,
            totalCents - creditUsed,
            Date.now(),
            Date.now(),
          )
          .run();
        const paymentId = Number(payment.meta.last_row_id);
        const statements = [
          db
            .prepare(
              'UPDATE users SET credit_cents = credit_cents - ? WHERE id = ?',
            )
            .bind(creditUsed, memberId),
        ];
        if (creditUsed > 0)
          statements.push(
            db
              .prepare(
                `INSERT INTO credit_transactions (member_id, payment_id, amount_cents, kind, note, created_at) VALUES (?, ?, ?, 'usage', ?, ?)`,
              )
              .bind(
                memberId,
                paymentId,
                -creditUsed,
                'Crédito usado no pagamento da vez',
                Date.now(),
              ),
          );
        await db.batch(statements);
      }
      const next = await nextMember(db, member.queuePosition);
      if (next) {
        await db
          .prepare(
            'UPDATE settings SET next_queue_position = ?, updated_at = ? WHERE id = 1',
          )
          .bind(next.queuePosition, Date.now())
          .run();
        const nextTotal = bottles * Number(config?.bottlePriceCents ?? 0);
        const nextCreditUsed = Math.min(next.creditCents, nextTotal);
        const remainingCredit = next.creditCents - nextCreditUsed;
        const nextPayment = await db
          .prepare(
            `INSERT INTO payments (member_id, bottles, total_cents, credit_used_cents, paid_cents, status, created_at) VALUES (?, ?, ?, ?, 0, 'pending', ?)`,
          )
          .bind(next.id, bottles, nextTotal, nextCreditUsed, Date.now())
          .run();
        if (nextCreditUsed > 0)
          await db.batch([
            db
              .prepare(
                'UPDATE users SET credit_cents = credit_cents - ? WHERE id = ?',
              )
              .bind(nextCreditUsed, next.id),
            db
              .prepare(
                `INSERT INTO credit_transactions (member_id, payment_id, amount_cents, kind, note, created_at) VALUES (?, ?, ?, 'usage', ?, ?)`,
              )
              .bind(
                next.id,
                nextPayment.meta.last_row_id,
                -nextCreditUsed,
                'Crédito reservado para a próxima vez',
                Date.now(),
              ),
          ]);
        const message = buildMessage(
          next.name,
          bottles,
          nextTotal,
          nextCreditUsed,
          remainingCredit,
        );
        const queued = await db
          .prepare(
            `INSERT INTO notifications (member_id, payment_id, message, status, created_at) VALUES (?, ?, ?, 'queued', ?)`,
          )
          .bind(next.id, nextPayment.meta.last_row_id, message, Date.now())
          .run();
        await sendQueued(
          db,
          Number(queued.meta.last_row_id),
          next.phone,
          message,
        );
      }
      return NextResponse.json({
        ok: true,
        message: creditUsed
          ? `Pagamento registrado. Foram usados ${formatMoney(creditUsed)} de crédito.`
          : 'Pagamento registrado e fila avançada.',
      });
    }

    if (action === 'send_notification' || action === 'charge_member') {
      const config = await db
        .prepare(
          'SELECT next_queue_position AS nextQueuePosition, bottle_price_cents AS bottlePriceCents FROM settings WHERE id = 1',
        )
        .first<{ nextQueuePosition: number; bottlePriceCents: number }>();
      const selectedMemberId =
        action === 'charge_member' ? requiredText(body.memberId, 100) : null;
      const member = await db
        .prepare(
          selectedMemberId
            ? `SELECT u.id, u.name, u.phone, u.credit_cents AS creditCents, (SELECT p.status FROM payments p WHERE p.member_id = u.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS paymentStatus FROM users u WHERE u.id = ? AND u.role = 'client' AND u.active = 1`
            : `SELECT u.id, u.name, u.phone, u.credit_cents AS creditCents, (SELECT p.status FROM payments p WHERE p.member_id = u.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS paymentStatus FROM users u WHERE u.role = 'client' AND u.active = 1 AND u.queue_position = ?`,
        )
        .bind(selectedMemberId ?? config?.nextQueuePosition ?? 1)
        .first<{
          id: string;
          name: string;
          phone: string | null;
          creditCents: number;
          paymentStatus: 'pending' | 'paid' | null;
        }>();
      if (!member)
        throw new Error('Nenhuma pessoa ativa está marcada como próxima.');
      if (!member.phone)
        throw new Error('Cadastre o WhatsApp dessa pessoa antes de cobrar.');
      const bottles = positiveInt(body.bottles, 1, 100);
      const pending = await db
        .prepare(
          `SELECT id, total_cents AS totalCents, credit_used_cents AS creditUsedCents FROM payments WHERE member_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(member.id)
        .first<{ id: number; totalCents: number; creditUsedCents: number }>();
      let paymentId = pending?.id;
      let total =
        pending?.totalCents ?? bottles * Number(config?.bottlePriceCents ?? 0);
      let used =
        pending?.creditUsedCents ?? Math.min(total, member.creditCents);
      let remaining = member.creditCents;
      if (!pending) {
        const created = await db
          .prepare(
            `INSERT INTO payments (member_id, bottles, total_cents, credit_used_cents, paid_cents, status, created_at) VALUES (?, ?, ?, ?, 0, 'pending', ?)`,
          )
          .bind(member.id, bottles, total, used, Date.now())
          .run();
        paymentId = Number(created.meta.last_row_id);
        remaining -= used;
        if (used > 0)
          await db.batch([
            db
              .prepare(
                'UPDATE users SET credit_cents = credit_cents - ? WHERE id = ?',
              )
              .bind(used, member.id),
            db
              .prepare(
                `INSERT INTO credit_transactions (member_id, payment_id, amount_cents, kind, note, created_at) VALUES (?, ?, ?, 'usage', ?, ?)`,
              )
              .bind(
                member.id,
                paymentId,
                -used,
                'Crédito reservado para a próxima vez',
                Date.now(),
              ),
          ]);
      }
      const message = buildMessage(
        member.name,
        bottles,
        total,
        used,
        remaining,
      );
      const queued = await db
        .prepare(
          `INSERT INTO notifications (member_id, payment_id, message, status, created_at) VALUES (?, ?, ?, 'queued', ?)`,
        )
        .bind(member.id, paymentId, message, Date.now())
        .run();
      const result = await sendQueued(
        db,
        Number(queued.meta.last_row_id),
        member.phone,
        message,
      );
      return NextResponse.json({
        ok: true,
        message: result.sent
          ? `Cobrança enviada para ${member.name} pelo WhatsApp.`
          : `Cobrança de ${member.name} preparada para abrir no WhatsApp.`,
        whatsappUrl: result.url,
      });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Não foi possível concluir a ação.';
    return NextResponse.json(
      {
        error: message.includes('UNIQUE')
          ? 'Este nome de usuário já está em uso.'
          : message,
      },
      { status: 400 },
    );
  }
}

async function nextMember(db: D1Database, currentPosition: number) {
  const after = await db
    .prepare(
      'SELECT id, name, phone, credit_cents AS creditCents, queue_position AS queuePosition FROM users WHERE active = 1 AND role = ? AND queue_position > ? ORDER BY queue_position LIMIT 1',
    )
    .bind('client', currentPosition)
    .first<{
      id: string;
      name: string;
      phone: string | null;
      creditCents: number;
      queuePosition: number;
    }>();
  return (
    after ??
    db
      .prepare(
        'SELECT id, name, phone, credit_cents AS creditCents, queue_position AS queuePosition FROM users WHERE active = 1 AND role = ? ORDER BY queue_position LIMIT 1',
      )
      .bind('client')
      .first<{
        id: string;
        name: string;
        phone: string | null;
        creditCents: number;
        queuePosition: number;
      }>()
  );
}

async function sendQueued(
  db: D1Database,
  id: number,
  phone: string | null,
  message: string,
) {
  if (!phone) {
    await db
      .prepare(
        `UPDATE notifications SET status = 'failed', error = ?, attempted_at = ? WHERE id = ?`,
      )
      .bind('Telefone não cadastrado', Date.now(), id)
      .run();
    return { sent: false, url: null };
  }
  const normalized = normalizePhone(phone);
  const { token, phoneNumberId, apiVersion } = getWhatsAppConfig();
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  if (!token || !phoneNumberId) return { sent: false, url };
  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalized,
          type: 'text',
          text: { body: message },
        }),
      },
    );
    const result = (await response.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(result.error?.message ?? 'Falha na API do WhatsApp');
    await db
      .prepare(
        `UPDATE notifications SET status = 'sent', provider_id = ?, attempted_at = ? WHERE id = ?`,
      )
      .bind(result.messages?.[0]?.id ?? null, Date.now(), id)
      .run();
    return { sent: true, url };
  } catch (error) {
    await db
      .prepare(
        `UPDATE notifications SET status = 'failed', error = ?, attempted_at = ? WHERE id = ?`,
      )
      .bind(
        error instanceof Error ? error.message : 'Falha no envio',
        Date.now(),
        id,
      )
      .run();
    return { sent: false, url };
  }
}

function buildMessage(
  name: string,
  bottles: number,
  total: number,
  used: number,
  remaining: number,
) {
  const cash = total - used;
  let message = `Olá, ${name}! Chegou a sua vez na Cota D'Água. São ${bottles} garrafão(ões), no total de ${formatMoney(total)}.`;
  if (used > 0)
    message += ` Usamos ${formatMoney(used)} do seu crédito; agora você tem ${formatMoney(remaining)}. Valor restante a pagar: ${formatMoney(cash)}.`;
  return `${message} Obrigado!`;
}
function cleanText(value: unknown, max: number) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
function requiredText(value: unknown, max: number) {
  const text = cleanText(value, max);
  if (!text) throw new Error('Preencha todos os campos obrigatórios.');
  return text;
}
function positiveInt(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`Informe um número entre ${min} e ${max}.`);
  return number;
}
function moneyToCents(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0)
    throw new Error('Informe um valor válido.');
  return Math.round(number * 100);
}
function nonNegativeMoneyToCents(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number < 0)
    throw new Error('Informe um valor de crédito válido.');
  return Math.round(number * 100);
}
function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}
function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
