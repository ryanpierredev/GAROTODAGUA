import { randomUUID } from 'node:crypto';

export function readConfig(env = process.env) {
  const required = [
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ADMIN_PHONE',
    'WHATSAPP_ALERT_TEMPLATE',
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length)
    throw new Error(`Configure no .env: ${missing.join(', ')}.`);
  const recipient = env.WHATSAPP_ADMIN_PHONE.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(recipient))
    throw new Error('WHATSAPP_ADMIN_PHONE deve incluir país e DDD.');
  if (!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID))
    throw new Error('WHATSAPP_PHONE_NUMBER_ID inválido.');
  const version = env.WHATSAPP_API_VERSION || 'v23.0';
  if (!/^v\d+\.\d+$/.test(version))
    throw new Error('WHATSAPP_API_VERSION inválida.');
  if (!/^[a-z0-9_]+$/.test(env.WHATSAPP_ALERT_TEMPLATE))
    throw new Error('WHATSAPP_ALERT_TEMPLATE inválido.');
  return {
    token: env.WHATSAPP_TOKEN,
    sender: env.WHATSAPP_PHONE_NUMBER_ID,
    recipient,
    template: env.WHATSAPP_ALERT_TEMPLATE,
    language: env.WHATSAPP_ALERT_LANGUAGE || 'pt_BR',
    version,
  };
}

const templateText = (value) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 1024);

export async function submitAlert(config, alert, fetcher = fetch) {
  const response = await fetcher(
    `https://graph.facebook.com/${config.version}/${config.sender}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: alert.recipient || config.recipient,
        type: 'template',
        template: {
          name: config.template,
          language: { code: config.language },
          components: [
            {
              type: 'body',
              parameters: [alert.title, alert.detail].map((text) => ({
                type: 'text',
                text: templateText(text),
              })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = await response.json();
  if (!response.ok || typeof body.messages?.[0]?.id !== 'string') {
    // Store diagnostic codes only; never log the bearer token or message body.
    throw new Error(
      `Meta HTTP ${response.status}; código ${body.error?.code ?? 'sem confirmação'}`,
    );
  }
  return body.messages[0].id;
}

export async function processNext(pool, config, fetcher = fetch) {
  const now = Date.now();
  const leaseToken = randomUUID();
  await pool.query(
    `UPDATE admin_whatsapp_alerts SET status = 'failed',
    error = 'Tentativas esgotadas após interrupção', lease_token = NULL, lease_until = NULL
    WHERE status = 'sending' AND attempts >= 5 AND lease_until <= $1`,
    [now],
  );
  const { rows } = await pool.query(
    `
    UPDATE admin_whatsapp_alerts SET status = 'sending', lease_token = $1,
      lease_until = $2, recipient = COALESCE(recipient, $3), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM admin_whatsapp_alerts
      WHERE attempts < 5 AND ((status = 'pending' AND next_attempt_at <= $4)
         OR (status = 'sending' AND lease_until <= $4))
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`,
    [leaseToken, now + 60000, config.recipient, now],
  );
  const alert = rows[0];
  if (!alert) return false;
  try {
    const id = await submitAlert(config, alert, fetcher);
    await pool.query(
      `UPDATE admin_whatsapp_alerts SET status = 'submitted',
      provider_id = $1, submitted_at = $2, error = NULL, lease_token = NULL, lease_until = NULL
      WHERE id = $3 AND lease_token = $4`,
      [id, Date.now(), alert.id, leaseToken],
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Falha de transporte';
    await pool.query(
      `UPDATE admin_whatsapp_alerts SET status = $1, error = $2,
      next_attempt_at = $3, lease_token = NULL, lease_until = NULL
      WHERE id = $4 AND lease_token = $5`,
      [
        alert.attempts >= 5 ? 'failed' : 'pending',
        message.slice(0, 300),
        Date.now() + Math.min(3600000, 30000 * 2 ** (alert.attempts - 1)),
        alert.id,
        leaseToken,
      ],
    );
  }
  return true;
}
