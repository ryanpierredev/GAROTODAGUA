import { env } from 'cloudflare:workers';

export function getDatabase(): D1Database {
  if (!env.DB) throw new Error('Banco de dados indisponível.');
  return env.DB;
}

export function getWhatsAppConfig() {
  const runtime = env as unknown as { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_NUMBER_ID?: string; WHATSAPP_API_VERSION?: string };
  return { token: runtime.WHATSAPP_TOKEN, phoneNumberId: runtime.WHATSAPP_PHONE_NUMBER_ID, apiVersion: runtime.WHATSAPP_API_VERSION ?? 'v23.0' };
}
