import { processAlert } from './alert-queue.mjs';

export function readToken(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token)
    throw new Error('Configure TELEGRAM_BOT_TOKEN no .env privado da EC2.');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))
    throw new Error('Formato de TELEGRAM_BOT_TOKEN inválido.');
  return token;
}

export function readConfig(env = process.env) {
  const token = readToken(env);
  const recipient = env.TELEGRAM_CHAT_ID?.trim();
  if (!recipient || !/^-?[1-9]\d*$/.test(recipient))
    throw new Error(
      'Configure TELEGRAM_CHAT_ID usando npm run telegram:setup.',
    );
  return { token, recipient };
}

export async function telegramRequest(
  token,
  method,
  payload = {},
  fetcher = fetch,
) {
  if (
    !['getMe', 'getWebhookInfo', 'getUpdates', 'sendMessage'].includes(method)
  )
    throw new Error('Método Telegram inválido.');
  let response;
  let body;
  try {
    response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    body = await response.json();
  } catch {
    // The URL contains the token: never propagate raw fetch exceptions/URLs.
    throw new Error(
      'Falha de conexão com o Telegram. Verifique a saída HTTPS e tente novamente.',
    );
  }
  if (!response.ok || body.ok !== true) {
    const code = Number(body.error_code) || response.status;
    const descriptions = {
      400: 'Conversa não encontrada ou pedido inválido',
      401: 'Token inválido',
      403: 'Bot bloqueado ou sem permissão na conversa',
      409: 'Outro processo está consultando este bot',
      429: 'Limite de envio atingido',
    };
    const error = new Error(
      `Telegram ${code}: ${descriptions[code] || 'Falha na API'}.`,
    );
    const retry = Number(body.parameters?.retry_after);
    if (Number.isFinite(retry) && retry > 0)
      error.retryAfterMs = Math.min(retry, 86400) * 1000;
    throw error;
  }
  return body.result;
}

export async function submitAlert(config, alert, fetcher = fetch) {
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(Number(alert.created_at ?? Date.now())));
  const text =
    `Cota D’Água\n\n${alert.title}\n${alert.detail}\n\n${time}`.slice(0, 3900);
  const result = await telegramRequest(
    config.token,
    'sendMessage',
    {
      chat_id: alert.recipient || config.recipient,
      text,
      link_preview_options: { is_disabled: true },
    },
    fetcher,
  );
  if (
    !Number.isSafeInteger(result?.message_id) ||
    !result?.chat ||
    String(result.chat.id) !== String(alert.recipient || config.recipient)
  ) {
    throw new Error(
      'Telegram não confirmou a mensagem na conversa configurada.',
    );
  }
  return String(result.message_id);
}

export function processNext(pool, config, fetcher = fetch) {
  return processAlert(
    pool,
    'admin_telegram_alerts',
    config,
    submitAlert,
    fetcher,
  );
}
