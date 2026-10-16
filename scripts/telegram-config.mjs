import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

export function confirmedChat(message, code) {
  if (
    message?.chat?.type === 'private' &&
    message.text === `/start ${code}` &&
    message.from?.id === message.chat.id
  )
    return message.chat;
  return null;
}

export function saveChatId(filename, chatId) {
  if (!/^-?[1-9]\d*$/.test(String(chatId)))
    throw new Error('Identificador de conversa inválido.');
  const current = fs.readFileSync(filename, 'utf8');
  const line = `TELEGRAM_CHAT_ID=${chatId}`;
  const content = /^\s*TELEGRAM_CHAT_ID\s*=/m.test(current)
    ? current.replace(/^\s*TELEGRAM_CHAT_ID\s*=.*$/gm, line)
    : `${current.trimEnd()}\n${line}\n`;
  const temp = `${filename}.telegram-${randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, filename);
    fs.chmodSync(filename, 0o600);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
