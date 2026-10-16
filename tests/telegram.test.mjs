import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  readConfig,
  submitAlert,
  processNext,
  telegramRequest,
} from '../scripts/telegram-alerts.mjs';
import { confirmedChat, saveChatId } from '../scripts/telegram-config.mjs';

if (!process.env.PGDATABASE?.endsWith('_test'))
  throw new Error('Use um banco descartável terminado em _test.');
const pool = new Pool({ max: 4 });
const config = readConfig({
  TELEGRAM_BOT_TOKEN: '123456:fake_test_token_for_testing_only',
  TELEGRAM_CHAT_ID: '123456789',
});
after(() => pool.end());
beforeEach(async () => {
  await pool.query(
    'TRUNCATE admin_telegram_alerts, admin_whatsapp_alerts, sessions, notifications, credit_transactions, bottle_events, payments, settings, accounts, users RESTART IDENTITY',
  );
});
const fakeSuccess = async () =>
  Response.json({
    ok: true,
    result: { message_id: 42, chat: { id: 123456789 } },
  });
const event = () =>
  pool.query(
    `INSERT INTO accounts (id,username,password_hash,password_salt,name,created_at) VALUES ('admin','admin','secret-hash','secret-salt','Administrador',1)`,
  );

void test('configuration never accepts a missing token or ambiguous chat', () => {
  assert.throws(() => readConfig({}), /TELEGRAM_BOT_TOKEN/);
  assert.throws(
    () => readConfig({ TELEGRAM_BOT_TOKEN: config.token }),
    /TELEGRAM_CHAT_ID/,
  );
  assert.throws(
    () => readConfig({ TELEGRAM_BOT_TOKEN: 'https://example.invalid/token' }),
    /inválido/,
  );
});

void test('private conversation binding requires the exact one-time start code', () => {
  const message = {
    text: '/start unique-code',
    chat: { type: 'private', id: 123 },
    from: { id: 123 },
  };
  assert.equal(confirmedChat(message, 'unique-code').id, 123);
  assert.equal(confirmedChat(message, 'another-code'), null);
  assert.equal(
    confirmedChat(
      { ...message, chat: { type: 'group', id: 123 } },
      'unique-code',
    ),
    null,
  );
  assert.equal(
    confirmedChat({ ...message, from: { id: 456 } }, 'unique-code'),
    null,
  );
});

void test('saving the chat preserves existing PostgreSQL credentials and protects .env permissions', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'garotodagua-telegram-'));
  const file = join(dir, '.env');
  try {
    fs.writeFileSync(
      file,
      'PGPASSWORD="test-value#with-spaces"\nTELEGRAM_CHAT_ID=\nSITE_URL=http://example.invalid\n',
    );
    saveChatId(file, '123456789');
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      'PGPASSWORD="test-value#with-spaces"\nTELEGRAM_CHAT_ID=123456789\nSITE_URL=http://example.invalid\n',
    );
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

void test('domain changes enqueue new messages, without passwords or historical imports', async () => {
  await event();
  await pool.query(
    `INSERT INTO users (id,email,name,created_at) VALUES ('member','member@example.invalid','Pessoa',1)`,
  );
  await pool.query(
    `INSERT INTO settings (id,total_bottles,full_bottles,updated_at) VALUES (1,10,2,1)`,
  );
  await pool.query(
    `INSERT INTO payments (member_id,bottles,total_cents,created_at) VALUES ('member',1,2000,1)`,
  );
  await pool.query(
    `INSERT INTO credit_transactions (member_id,amount_cents,kind,note,created_at) VALUES ('member',500,'credit','Crédito de teste',1)`,
  );
  await pool.query(
    `INSERT INTO bottle_events (account_id,kind,quantity,created_at) VALUES ('admin','empty',1,1)`,
  );
  await pool.query(
    `INSERT INTO notifications (member_id,message,created_at) VALUES ('member','Aviso de teste',1)`,
  );
  const { rows } = await pool.query(
    'SELECT title,detail FROM admin_telegram_alerts ORDER BY id',
  );
  assert.equal(rows.length, 7);
  assert.ok(rows.some((row) => row.title.includes('estoque baixo')));
  assert.ok(rows.some((row) => row.title.includes('Pagamento')));
  assert.ok(!JSON.stringify(rows).includes('secret-hash'));
  assert.ok(!JSON.stringify(rows).includes('secret-salt'));
  await pool.query(`UPDATE accounts SET name = name WHERE id = 'admin'`);
  assert.equal(
    (await pool.query('SELECT COUNT(*) FROM admin_telegram_alerts')).rows[0]
      .count,
    '7',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL garotodagua.skip_telegram_alerts = 'on'");
    await client.query(
      `UPDATE accounts SET name = 'Histórico' WHERE id = 'admin'`,
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  assert.equal(
    (await pool.query('SELECT COUNT(*) FROM admin_telegram_alerts')).rows[0]
      .count,
    '7',
  );
});

void test('plain text goes only to the configured chat and requires API confirmation', async () => {
  const id = await submitAlert(
    config,
    {
      title: 'Aviso <b>literal</b>',
      detail: 'Estoque baixo',
      created_at: 1792100000000,
    },
    async (url, options) => {
      assert.equal(
        url,
        `https://api.telegram.org/bot${config.token}/sendMessage`,
      );
      const body = JSON.parse(options.body);
      assert.equal(body.chat_id, config.recipient);
      assert.equal(body.parse_mode, undefined);
      assert.ok(body.text.includes('Aviso <b>literal</b>'));
      return fakeSuccess();
    },
  );
  assert.equal(id, '42');
  await assert.rejects(
    submitAlert(config, { title: 'Test', detail: 'Test' }, async () =>
      Response.json({ ok: true, result: { message_id: 1, chat: { id: 99 } } }),
    ),
    /conversa configurada/,
  );
});

void test('transport failures never expose a URL containing the bot token', async () => {
  await assert.rejects(
    telegramRequest(config.token, 'getMe', {}, async () => {
      throw new Error(
        `TLS error https://api.telegram.org/bot${config.token}/getMe`,
      );
    }),
    (error) =>
      !error.message.includes(config.token) &&
      error.message.includes('conexão'),
  );
  await assert.rejects(
    telegramRequest(config.token, 'sendMessage', {}, async () =>
      Response.json(
        { ok: false, error_code: 403, description: config.token },
        { status: 403 },
      ),
    ),
    (error) =>
      !error.message.includes(config.token) && error.message.includes('403'),
  );
});

void test('concurrent workers submit each alert once and do not create recursive notifications', async () => {
  await event();
  let calls = 0;
  const fake = async () => {
    calls++;
    return fakeSuccess();
  };
  await Promise.all([
    processNext(pool, config, fake),
    processNext(pool, config, fake),
  ]);
  assert.equal(calls, 1);
  const { rows } = await pool.query(
    'SELECT status,provider_id,recipient FROM admin_telegram_alerts',
  );
  assert.deepEqual(rows, [
    { status: 'submitted', provider_id: '42', recipient: config.recipient },
  ]);
});

void test('Telegram rate limits are persisted and respected before retry', async () => {
  await event();
  await processNext(pool, config, async () =>
    Response.json(
      { ok: false, error_code: 429, parameters: { retry_after: 120 } },
      { status: 429 },
    ),
  );
  const { rows } = await pool.query(
    'SELECT status,attempts,next_attempt_at FROM admin_telegram_alerts',
  );
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].attempts, 1);
  assert.ok(Number(rows[0].next_attempt_at) > Date.now() + 110000);
  assert.equal(await processNext(pool, config, fakeSuccess), false);
});
