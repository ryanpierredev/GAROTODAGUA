import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import {
  readConfig,
  submitAlert,
  processNext,
} from '../scripts/whatsapp-alerts.mjs';

if (!process.env.PGDATABASE?.endsWith('_test'))
  throw new Error('Use um PostgreSQL descartável terminado em _test.');
const pool = new Pool({ max: 4 });
const config = readConfig({
  WHATSAPP_TOKEN: 'fake-test-token',
  WHATSAPP_PHONE_NUMBER_ID: '12345',
  WHATSAPP_ADMIN_PHONE: '+55 11 00000-0000',
  WHATSAPP_ALERT_TEMPLATE: 'test_alert',
});
after(() => pool.end());
beforeEach(async () => {
  await pool.query(
    'TRUNCATE admin_whatsapp_alerts, sessions, notifications, credit_transactions, bottle_events, payments, settings, accounts, users RESTART IDENTITY',
  );
  await pool.query(
    `INSERT INTO accounts (id,username,password_hash,password_salt,name,created_at) VALUES ('admin','admin','test','test','Admin',1)`,
  );
  await pool.query(
    `INSERT INTO users (id,email,name,created_at) VALUES ('member','member@example.invalid','Pessoa',1)`,
  );
});
const event = () =>
  pool.query(
    `INSERT INTO bottle_events (account_id,kind,quantity,created_at) VALUES ('admin','empty',2,1)`,
  );

void test('missing credentials fail explicitly without sending', () => {
  assert.throws(() => readConfig({}), /WHATSAPP_TOKEN/);
  assert.equal(config.recipient, '5511000000000');
});

void test('the two notification sources enqueue independently of the browser; unchanged status is deduplicated', async () => {
  await event();
  await pool.query(
    `INSERT INTO notifications (member_id,message,created_at) VALUES ('member','Cobrança',1)`,
  );
  await pool.query(`UPDATE notifications SET status = 'sent' WHERE id = 1`);
  await pool.query(`UPDATE notifications SET status = 'sent' WHERE id = 1`);
  const { rows } = await pool.query(
    'SELECT event_key, title FROM admin_whatsapp_alerts ORDER BY id',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'Garrafões vazios informados');
  assert.deepEqual(
    rows.map((row) => row.event_key),
    ['event-1', 'whatsapp-1-queued', 'whatsapp-1-sent'],
  );
});

void test('template targets the administrator and requires provider acknowledgement', async () => {
  await assert.rejects(
    submitAlert(
      config,
      { title: 'Título', detail: 'Detalhes' },
      async (url, options) => {
        assert.equal(url, 'https://graph.facebook.com/v23.0/12345/messages');
        const body = JSON.parse(options.body);
        assert.equal(body.to, config.recipient);
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, config.template);
        assert.equal(body.template.components[0].parameters.length, 2);
        return new Response('{}', { status: 200 });
      },
    ),
    /sem confirmação/,
  );
});

void test('two processors do not submit the same alert concurrently; submission does not recursively enqueue', async () => {
  await event();
  let calls = 0;
  const fake = async () => {
    calls++;
    return Response.json({ messages: [{ id: 'fake-message-id' }] });
  };
  await Promise.all([
    processNext(pool, config, fake),
    processNext(pool, config, fake),
  ]);
  assert.equal(calls, 1);
  assert.equal(await processNext(pool, config, fake), false);
  const { rows } = await pool.query(
    'SELECT status, recipient, provider_id FROM admin_whatsapp_alerts',
  );
  assert.deepEqual(rows, [
    {
      status: 'submitted',
      recipient: config.recipient,
      provider_id: 'fake-message-id',
    },
  ]);
});

void test('failure retries with backoff and stops after five attempts', async () => {
  await event();
  const fake = async () =>
    Response.json({ error: { code: 131000 } }, { status: 500 });
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal(await processNext(pool, config, fake), true);
    const { rows } = await pool.query(
      'SELECT status, attempts, next_attempt_at, error FROM admin_whatsapp_alerts',
    );
    assert.equal(rows[0].attempts, attempt);
    assert.equal(rows[0].status, attempt === 5 ? 'failed' : 'pending');
    assert.ok(Number(rows[0].next_attempt_at) > Date.now());
    assert.ok(!rows[0].error.includes(config.token));
    assert.equal(await processNext(pool, config, fake), false);
    if (attempt < 5)
      await pool.query('UPDATE admin_whatsapp_alerts SET next_attempt_at = 0');
  }
  await pool.query(
    "UPDATE admin_whatsapp_alerts SET status = 'sending', lease_until = 0",
  );
  assert.equal(await processNext(pool, config, fake), false);
  assert.equal(
    (await pool.query('SELECT status FROM admin_whatsapp_alerts')).rows[0]
      .status,
    'failed',
  );
});

void test('an abandoned reservation can be processed after its lease expires', async () => {
  await event();
  await pool.query(
    "UPDATE admin_whatsapp_alerts SET status = 'sending', attempts = 1, lease_until = 0, lease_token = 'expired'",
  );
  assert.equal(
    await processNext(pool, config, async () =>
      Response.json({ messages: [{ id: 'recovered' }] }),
    ),
    true,
  );
  const { rows } = await pool.query(
    'SELECT status, attempts, provider_id FROM admin_whatsapp_alerts',
  );
  assert.deepEqual(rows, [
    { status: 'submitted', attempts: 2, provider_id: 'recovered' },
  ]);
});

void test('historical import suppresses outgoing alerts', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL garotodagua.skip_whatsapp_alerts = 'on'");
    await client.query(
      `INSERT INTO bottle_events (account_id,kind,quantity,created_at) VALUES ('admin','adjustment',10,1)`,
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  assert.equal(
    (await pool.query('SELECT COUNT(*) FROM admin_whatsapp_alerts')).rows[0]
      .count,
    '0',
  );
});
