import { createPool, Database } from './postgres';

const runtime = globalThis as typeof globalThis & {
  garotodaguaPool?: ReturnType<typeof createPool>;
};

export function getPool() {
  if (!process.env.PGDATABASE || !process.env.PGUSER) {
    throw new Error('Configure PGDATABASE e PGUSER para acessar o PostgreSQL.');
  }
  return (runtime.garotodaguaPool ??= createPool());
}

export function getDatabase() {
  return new Database(getPool());
}

export function getWhatsAppConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v23.0',
  };
}
