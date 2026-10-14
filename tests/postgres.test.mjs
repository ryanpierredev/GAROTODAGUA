import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPool, Database } from '../db/postgres.ts';
import { importD1 } from '../scripts/import-d1.mjs';

if (!process.env.PGDATABASE?.endsWith('_test'))
  throw new Error('Use um banco descartável com nome terminado em _test.');
const pool = createPool();
const db = new Database(pool);
after(() => pool.end());

void test('parameters, aliases and millisecond timestamps retain their values', async () => {
  const value = "O'Brien ? $1; DROP TABLE accounts;";
  const row = await db
    .prepare('SELECT $1::text AS "memberName", $2::bigint AS "createdAt"')
    .bind(value, 1792012345678)
    .first();
  assert.deepEqual(row, { memberName: value, createdAt: 1792012345678 });
  assert.equal(await db.prepare('SELECT 1 WHERE false').first(), null);
});

void test('batch rolls back preceding writes on failure', async () => {
  await assert.rejects(
    db.batch([
      db
        .prepare('INSERT INTO settings (id, updated_at) VALUES (999, $1)')
        .bind(Date.now()),
      db
        .prepare('INSERT INTO settings (id, updated_at) VALUES (999, $1)')
        .bind(Date.now()),
    ]),
    { code: '23505' },
  );
  assert.equal(
    await db.prepare('SELECT id FROM settings WHERE id = 999').first(),
    null,
  );
});

void test('D1 import preserves credentials, relationships and generated ID sequences; refuses a second import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garotodagua-'));
  const file = join(dir, 'fixture.sqlite');
  const sqlite = new DatabaseSync(file);
  try {
    // Match PostgreSQL columns while exercising SQLite's original storage types.
    for (const table of [
      'users',
      'accounts',
      'settings',
      'payments',
      'bottle_events',
      'credit_transactions',
      'notifications',
      'sessions',
    ]) {
      const { rows } = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        ['public', table],
      );
      sqlite.exec(
        `CREATE TABLE "${table}" (${rows.map(({ column_name }) => `"${column_name}"`).join(',')})`,
      );
    }
    sqlite.exec(
      `INSERT INTO accounts VALUES ('account_test', 'testadmin', 'hash-preserved', 'salt-preserved', 'Admin', NULL, 'admin', 1, 1792012345678)`,
    );
    sqlite.exec(
      `INSERT INTO users (id,email,name,role,queue_position,credit_cents,active,created_at) VALUES ('member_test','test@example.invalid','Member','client',1,500,1,1792012345678)`,
    );
    sqlite.exec(
      `INSERT INTO payments VALUES (42,'member_test',1,2000,500,1500,'paid',1792012345678,1792012345678)`,
    );
    sqlite.exec(
      `INSERT INTO sessions VALUES ('token_test','account_test',1793012345678,1792012345678)`,
    );
    sqlite.close();
    const counts = await importD1(file, pool);
    assert.equal(counts.accounts, 1);
    assert.equal(counts.payments, 1);
    assert.equal(
      (await db.prepare('SELECT password_hash FROM accounts').first())
        .password_hash,
      'hash-preserved',
    );
    const payment = await db
      .prepare(
        "INSERT INTO payments (member_id,bottles,total_cents,created_at) VALUES ('member_test',1,2000,$1) RETURNING id",
      )
      .bind(Date.now())
      .run();
    assert.equal(payment.meta.last_row_id, 43);
    await assert.rejects(importD1(file, pool), /Destino contém dados/);
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS count FROM payments').first())
        .count,
      2,
    );
  } finally {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
    await pool.query(
      'TRUNCATE sessions, notifications, credit_transactions, bottle_events, payments, settings, accounts, users RESTART IDENTITY',
    );
    rmSync(dir, { recursive: true });
  }
});
