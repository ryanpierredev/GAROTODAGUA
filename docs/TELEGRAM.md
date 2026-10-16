# Receber avisos da Cota D’Água no Telegram

Os avisos são gerados no PostgreSQL quando há mudanças nos cadastros de pessoas
e acessos, estoque, garrafões, pagamentos, créditos e estados de cobrança.
Incluem alerta de estoque baixo. Funcionam mesmo com o navegador fechado.
Não dependem de conta empresarial da Meta nem de um modelo de mensagem aprovado.

O serviço cobre mudanças nos dados da aplicação, não monitora indisponibilidade
da EC2. Uma ação pode modificar mais de um registro e produzir mais de um aviso.
Atualizações sem alteração dos valores são ignoradas. Os avisos começam com as
mudanças posteriores à migração; o histórico não é reenviado, e importações D1
são suprimidas. Não são enviados senhas, hashes ou tokens nos avisos.

## 1. Criar seu bot

No Telegram, abra o [@BotFather oficial](https://t.me/BotFather):

1. Pressione **Iniciar** e envie `/newbot`.
2. Escolha um nome, por exemplo `Avisos da Cota D’Água`.
3. Escolha um usuário disponível terminado em `bot`, por exemplo
   `minha_cota_agua_avisos_bot`.
4. Guarde o token fornecido. Não envie o token no chat, em capturas ou no GitHub.

Use um bot exclusivo para a aplicação. O assistente não remove webhooks existentes
nem encerra outros programas que estejam usando o bot.

## 2. Guardar o token na EC2

Na sua conexão SSH:

```bash
cd /home/ubuntu/apps/garotodagua-postgres
git pull --ff-only origin feat/postgresql-ec2
nano .env
```

Preserve os campos PostgreSQL e acrescente estas duas linhas, preenchendo o token
diretamente no editor:

```dotenv
TELEGRAM_BOT_TOKEN=token_fornecido_pelo_BotFather
TELEGRAM_CHAT_ID=
```

Salve e proteja o arquivo:

```bash
chmod 600 .env
```

Não copie o token em comandos curl: a URL do Telegram contém a credencial e
poderia ficar no histórico do terminal. Os assistentes abaixo não imprimem essa URL.

## 3. Vincular sua conversa pessoal

```bash
npm run telegram:setup
```

O comando valida o bot e mostra um link `https://t.me/...?...`. Abra o link no
**seu Telegram** e pressione **Iniciar/Start**. O link tem um código de uso único;
não o compartilhe. Se o bot já estiver aberto, use o novo link completo para
enviar a confirmação correta. O comando aguarda por até cinco minutos.

Ele identifica a conversa privada que confirmou esse código, envia uma mensagem
de teste e preenche `TELEGRAM_CHAT_ID` no `.env`, preservando as demais variáveis.
Você não precisa usar bots de terceiros para descobrir o identificador.
Se o tempo terminar, execute novamente e abra o novo link.

## 4. Ativar o serviço

```bash
bash scripts/install-telegram-service.sh
sudo systemctl status garotodagua-telegram --no-pager
```

O instalador usa as permissões sudo existentes, aplica as migrações, envia uma
mensagem de teste e instala um serviço separado, com início automático. Não
precisa refazer o build da interface nem reiniciar o serviço web para começar
a capturar alterações pelos gatilhos do banco. O serviço não muda o Nginx.

Você pode fechar a conexão SSH depois de confirmar que está ativo. O worker
consulta a fila a cada cinco segundos e processa aproximadamente um aviso por
segundo. Precisa de acesso de saída HTTPS a `api.telegram.org`; nenhuma nova
porta de entrada é necessária.

Registre uma mudança verdadeira pela aplicação e confirme a chegada no Telegram.
Os testes do repositório simulam a API; a mensagem de teste na EC2 valida o bot
e sua conversa reais.

## Diagnóstico e manutenção

```bash
npm run telegram:test
sudo journalctl -u garotodagua-telegram -n 40 --no-pager
```

Erros comuns:

- `401`: token incorreto ou revogado. Atualize o `.env` e reinicie o serviço.
- `403`: desbloqueie o bot no Telegram e pressione Iniciar.
- `409` durante a vinculação: outro processo usa `getUpdates`; use um bot exclusivo.
- `429`: o Telegram limitou os envios. O worker respeita o tempo solicitado antes
  da próxima tentativa.

Consulte apenas os estados, sem exibir conteúdo ou credenciais:

```bash
psql -h 127.0.0.1 -U garotodagua -d garotodagua -W \
  -c 'SELECT id, status, attempts, error FROM admin_telegram_alerts ORDER BY id DESC LIMIT 15;'
```

`pending`: aguarda envio/repetição; `sending`: em processamento; `submitted`:
mensagem confirmada pela API na conversa configurada; `failed`: cinco tentativas
esgotadas. Isso não confirma que a pessoa leu a mensagem. Falhas têm espera
crescente e reservas impedem que dois workers processem o mesmo aviso ao mesmo
tempo. Uma interrupção depois do envio e antes da gravação local ainda pode
provocar repetição; não há garantia de envio exatamente uma vez.

Para reiniciar após editar o `.env`:

```bash
sudo systemctl restart garotodagua-telegram
```

Para pausar os envios, preservando a fila:

```bash
sudo systemctl disable --now garotodagua-telegram
```

Se chegou a instalar o serviço de avisos do WhatsApp e deseja usar apenas
Telegram, pode pausá-lo separadamente:

```bash
sudo systemctl disable --now garotodagua-whatsapp
```

A integração de cobrança manual pelo WhatsApp na aplicação é independente.
Não redefina o banco nem importe novamente os dados para configurar o Telegram.

## Testes de desenvolvimento

Somente em um PostgreSQL descartável cujo nome termine em `_test`, configure as
variáveis PG* e execute `npm run db:migrate` seguido de `npm run test:telegram`.
Os testes não usam um bot real e não enviam mensagens a terceiros. Eles verificam
gatilhos, destino, vinculação por código, proteção do `.env`, erros sem exposição
do token, concorrência e respeito ao limite da API.
