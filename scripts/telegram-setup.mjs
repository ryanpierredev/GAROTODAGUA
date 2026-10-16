import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { confirmedChat, saveChatId } from './telegram-config.mjs';
import {
  readToken,
  telegramRequest,
  submitAlert,
  readConfig,
} from './telegram-alerts.mjs';

const token = readToken();
try {
  const me = await telegramRequest(token, 'getMe');
  if (!me?.is_bot || !/^[A-Za-z0-9_]+$/.test(me.username))
    throw new Error('Bot inválido.');
  if (process.argv.includes('--test')) {
    await submitAlert(readConfig(), {
      title: 'Telegram conectado',
      detail: 'Os avisos da Cota D’Água serão enviados para esta conversa.',
    });
    console.log('Mensagem de teste confirmada pela API do Telegram.');
  } else {
    if (!fs.existsSync('.env'))
      throw new Error('Crie o arquivo .env privado primeiro.');
    const webhook = await telegramRequest(token, 'getWebhookInfo');
    if (webhook.url)
      throw new Error(
        'Este bot já possui webhook. Use um bot exclusivo para a Cota D’Água; não removemos configurações existentes.',
      );
    const code = randomBytes(16).toString('hex');
    console.log(
      `Abra este link no SEU Telegram e pressione Iniciar/Start:\nhttps://t.me/${me.username}?start=${code}`,
    );
    console.log(
      'Aguardando sua confirmação por até 5 minutos. Não compartilhe este link.',
    );
    const deadline = Date.now() + 300000;
    let offset = 0;
    let chat;
    while (Date.now() < deadline && !chat) {
      const updates = await telegramRequest(token, 'getUpdates', {
        offset,
        timeout: 20,
        allowed_updates: ['message'],
      });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        const message = update.message;
        chat ??= confirmedChat(message, code);
      }
    }
    if (!chat)
      throw new Error('Tempo esgotado. Execute novamente e use o novo link.');
    await submitAlert(
      { token, recipient: String(chat.id) },
      {
        title: 'Telegram conectado',
        detail: 'Sua conversa foi vinculada aos avisos da Cota D’Água.',
      },
    );
    saveChatId('.env', chat.id);
    console.log(
      'Conversa confirmada. TELEGRAM_CHAT_ID salvo no .env privado. Agora instale o serviço Telegram.',
    );
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replaceAll(token, '[oculto]')
      : 'Não foi possível configurar o Telegram.',
  );
  process.exitCode = 1;
}
