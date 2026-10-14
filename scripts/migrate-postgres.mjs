import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';

if (!process.env.PGDATABASE || !process.env.PGUSER) {
  throw new Error(
    'Configure PGDATABASE e PGUSER no ambiente ou no arquivo .env.',
  );
}
const pool = new Pool({ connectionTimeoutMillis: 5000 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(
      new URL('../drizzle-postgres', import.meta.url),
    ),
  });
  console.log('Migrações PostgreSQL concluídas.');
} finally {
  await pool.end();
}
