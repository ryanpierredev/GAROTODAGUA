import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { pathToFileURL } from 'node:url';

const tables = [
  'users',
  'accounts',
  'settings',
  'payments',
  'bottle_events',
  'credit_transactions',
  'notifications',
  'sessions',
];
const serialTables = [
  'payments',
  'bottle_events',
  'credit_transactions',
  'notifications',
];
const identifier = (name) => `"${name.replaceAll('"', '""')}"`;

export async function importD1(filename, pool) {
  // The original SQLite database is never modified. Stop its service first.
  const source = new DatabaseSync(filename, { readOnly: true });
  let client;
  try {
    for (const table of tables)
      source.prepare(`SELECT 1 FROM ${identifier(table)} LIMIT 1`).all();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `LOCK TABLE ${tables.map(identifier).join(', ')} IN EXCLUSIVE MODE`,
    );
    for (const table of tables) {
      const { rows } = await client.query(
        `SELECT COUNT(*) AS count FROM ${identifier(table)}`,
      );
      if (Number(rows[0].count) !== 0) {
        throw new Error(
          `Destino contém dados em ${table}. Importação cancelada sem sobrescrever registros.`,
        );
      }
    }
    const counts = {};
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM ${identifier(table)}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        await client.query(
          `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
          columns.map((column) => row[column]),
        );
      }
      counts[table] = rows.length;
    }
    for (const table of serialTables) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${identifier(table)}`,
        [table],
      );
    }
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    source.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv[2])
    throw new Error('Informe o caminho do arquivo SQLite do D1.');
  if (!process.env.PGDATABASE || !process.env.PGUSER)
    throw new Error('Configure PGDATABASE e PGUSER.');
  const pool = new Pool({ connectionTimeoutMillis: 5000 });
  try {
    console.log('Registros importados:', await importD1(process.argv[2], pool));
  } finally {
    await pool.end();
  }
}
