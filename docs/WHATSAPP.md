# Avisos do sininho no WhatsApp do administrador

A integração cria uma fila PostgreSQL para os avisos de garrafões/estoque e para
os estados das notificações de cobrança (aguardando, enviada, falha). O serviço
`garotodagua-whatsapp` processa a fila mesmo com o navegador fechado. Não é um
link `wa.me`: o envio automático usa a API oficial WhatsApp Business da Meta.

O destinatário recebe os avisos novos produzidos depois de aplicar a migração.
Registros já existentes não são enviados retroativamente. A importação D1 também
suprime avisos de histórico. Uma cobrança pode gerar avisos separados de fila e
de resultado, pois são mudanças distintas do estado mostrado no sininho.

## Configuração necessária na Meta

1. Siga o [início rápido oficial](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).
   Configure um remetente do negócio, diferente do número que receberá os avisos.
2. Obtenha o identificador do número remetente (`Phone Number ID`) e um token com
   permissão de envio. Para operação contínua, configure um token adequado ao
   servidor; o token temporário do início rápido expira.
3. Crie um modelo de mensagem com idioma `pt_BR`, nome por exemplo
   `cota_dagua_alerta`, sem cabeçalho/rodapé variáveis nem botões. O corpo deve ter
   exatamente dois parâmetros de texto, nesta ordem:

   ```text
   Aviso da Cota D'Água: {{1}}. Detalhes: {{2}}.
   ```

   Exemplo para aprovação: `{{1}}` = `Garrafões vazios informados`;
   `{{2}}` = `Maria informou 2 garrafões vazios.` Aguarde a aprovação pela Meta.
   Use templates porque os avisos podem acontecer fora da janela de atendimento
   de 24 horas. Classificação, aprovação e eventuais cobranças são da Meta.
4. Se estiver usando o remetente de testes da Meta, cadastre e verifique o
   telefone de destino na lista de destinatários de teste.

## Configurar na EC2

Atualize a branch e edite o `.env` privado, preservando as variáveis PostgreSQL:

```bash
cd /home/ubuntu/apps/garotodagua-postgres
git pull --ff-only origin feat/postgresql-ec2
nano .env
chmod 600 .env
```

Preencha os seguintes nomes. Não publique nem envie o token em mensagens:

```dotenv
WHATSAPP_TOKEN=preencher_com_o_token_da_meta
WHATSAPP_PHONE_NUMBER_ID=preencher_com_o_identificador_do_remetente
WHATSAPP_API_VERSION=v23.0
WHATSAPP_ADMIN_PHONE=numero_destino_com_pais_e_ddd_somente_digitos
WHATSAPP_ALERT_TEMPLATE=cota_dagua_alerta
WHATSAPP_ALERT_LANGUAGE=pt_BR
```

Use o nome e o idioma exatos do modelo aprovado. O código do país do Brasil é
`55`, seguido de DDD e número. O telefone de destino é um valor privado no `.env`;
ele não fica fixado no código ou no repositório público.

## Ativar o serviço

Depois que a conta, o modelo e o `.env` estiverem prontos:

```bash
cd /home/ubuntu/apps/garotodagua-postgres
bash scripts/install-whatsapp-service.sh
sudo systemctl status garotodagua-whatsapp --no-pager
sudo journalctl -u garotodagua-whatsapp -n 40 --no-pager
```

O instalador valida a presença das configurações, aplica as migrações e instala
um serviço separado com início automático. Não precisa liberar portas na EC2;
precisa de saída HTTPS para `graph.facebook.com`. Não execute `test:whatsapp` no
banco real: esse teste exige um banco descartável terminado em `_test`.

Para testar o envio real, registre pela aplicação uma movimentação verdadeira,
como informar um garrafão vazio, e confira a fila. O serviço consulta avisos novos
a cada 5 segundos e limita o processamento a cerca de um aviso por segundo:

```bash
psql -h 127.0.0.1 -U garotodagua -d garotodagua -W \
  -c 'SELECT id, status, attempts, error FROM admin_whatsapp_alerts ORDER BY id DESC LIMIT 10;'
```

`pending`: aguarda envio ou nova tentativa; `sending`: reservado por um
processador; `submitted`: a Meta aceitou e devolveu um identificador; `failed`:
as cinco tentativas foram esgotadas. `submitted` **não confirma entrega ao
telefone**; a confirmação de entrega exige os webhooks de status da Meta, que
esta integração não implementa. Os códigos de erro são guardados sem o token.

O processamento usa reservas e evita concorrência sobre o mesmo aviso. Falhas
temporárias recebem novas tentativas com espera crescente. Como em outras filas
de envio, uma interrupção após a Meta aceitar e antes da gravação local pode
causar repetição; não há garantia de entrega exatamente uma vez.

Se falhar por token expirado, destinatário de teste não verificado ou modelo não
aprovado, corrija a configuração e reinicie:

```bash
sudo systemctl restart garotodagua-whatsapp
```

Após corrigir a causa, avisos esgotados podem ser recolocados na fila pelo ID
específico; confira antes se já chegaram ao WhatsApp para evitar repetição.
Para pausar novos envios:

```bash
sudo systemctl disable --now garotodagua-whatsapp
```

A fila continua preservada no PostgreSQL. O processador não cria notificações
para seus próprios envios, evitando ciclos de mensagens.
