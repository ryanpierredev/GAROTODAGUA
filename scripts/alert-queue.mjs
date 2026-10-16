import { randomUUID } from 'node:crypto';

export async function processAlert(
  pool,
  table,
  config,
  submit,
  fetcher = fetch,
) {
  if (!['admin_whatsapp_alerts', 'admin_telegram_alerts'].includes(table))
    throw new Error('Fila inválida.');
  const now = Date.now();
  const leaseToken = randomUUID();
  await pool.query(
    `UPDATE ${table} SET status = 'failed',
    error = 'Tentativas esgotadas após interrupção', lease_token = NULL, lease_until = NULL
    WHERE status = 'sending' AND attempts >= 5 AND lease_until <= $1`,
    [now],
  );
  const { rows } = await pool.query(
    `
    UPDATE ${table} SET status = 'sending', lease_token = $1,
      lease_until = $2, recipient = COALESCE(recipient, $3), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM ${table}
      WHERE attempts < 5 AND ((status = 'pending' AND next_attempt_at <= $4)
         OR (status = 'sending' AND lease_until <= $4))
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`,
    [leaseToken, now + 60000, config.recipient, now],
  );
  const alert = rows[0];
  if (!alert) return false;
  try {
    const id = await submit(config, alert, fetcher);
    await pool.query(
      `UPDATE ${table} SET status = 'submitted',
      provider_id = $1, submitted_at = $2, error = NULL, lease_token = NULL, lease_until = NULL
      WHERE id = $3 AND lease_token = $4`,
      [id, Date.now(), alert.id, leaseToken],
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Falha de transporte';
    await pool.query(
      `UPDATE ${table} SET status = $1, error = $2,
      next_attempt_at = $3, lease_token = NULL, lease_until = NULL
      WHERE id = $4 AND lease_token = $5`,
      [
        alert.attempts >= 5 ? 'failed' : 'pending',
        message.slice(0, 300),
        Date.now() +
          Math.max(
            Math.min(3600000, 30000 * 2 ** (alert.attempts - 1)),
            Number(error?.retryAfterMs) || 0,
          ),
        alert.id,
        leaseToken,
      ],
    );
  }
  return true;
}
