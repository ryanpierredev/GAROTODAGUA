import { Pool } from 'pg';
import { setTimeout } from 'node:timers/promises';
import { readConfig, processNext } from './telegram-alerts.mjs';

const config = readConfig();
if (!process.env.PGDATABASE || !process.env.PGUSER)
  throw new Error('Configure PGDATABASE e PGUSER.');
const pool = new Pool({ max: 2, connectionTimeoutMillis: 5000 });
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
pool.on('error', () =>
  console.error(
    'Conexão PostgreSQL interrompida; nova tentativa no próximo ciclo.',
  ),
);
try {
  await pool.query('SELECT 1 FROM admin_telegram_alerts LIMIT 1');
  console.log('Processador de alertas Telegram iniciado.');
  while (!stopping) {
    try {
      const processed = await processNext(pool, config);
      if (processed)
        console.log(
          'Alerta processado; consulte admin_telegram_alerts para verificar o resultado.',
        );
      if (!stopping) await setTimeout(processed ? 1000 : 5000);
    } catch {
      console.error(
        'Não foi possível processar a fila Telegram; nova tentativa em 5 segundos.',
      );
      if (!stopping) await setTimeout(5000);
    }
  }
} finally {
  await pool.end();
}
