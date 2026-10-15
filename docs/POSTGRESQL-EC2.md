# GAROTODAGUA no PostgreSQL da EC2

Esta versão executa Vinext como servidor Node de produção, sem Wrangler. O Nginx
continua encaminhando a porta 8080 para `127.0.0.1:3002`. Requer Node >=22.13,
PostgreSQL e o usuário/banco `garotodagua` já criados. A porta 5432 deve continuar
interna. A senha fica somente no `.env` privado, nunca no GitHub.

## Preparar em outra pasta

Mantenha o checkout e o serviço antigos para permitir retorno. Na EC2:

```bash
cd ~/apps
git clone --branch feat/postgresql-ec2 https://github.com/ryanpierredev/GAROTODAGUA.git garotodagua-postgres
cd garotodagua-postgres
npm ci --include=dev
cp -n .env.example .env
chmod 600 .env
nano .env
```

Preencha `PGHOST=127.0.0.1`, `PGPORT=5432`, `PGDATABASE=garotodagua`,
`PGUSER=garotodagua` e `PGPASSWORD` com a senha já definida. Se a senha contiver
`#`, espaços ou aspas, use a sintaxe de aspas de arquivos dotenv. Transfira também
as configurações WhatsApp existentes, quando houver; não publique seus valores.

```bash
npm run db:migrate
npm run build
```

Pare se algum comando falhar. As novas migrações ficam em `drizzle-postgres/`;
`drizzle/` contém as migrações antigas de SQLite e não deve ser executado no
PostgreSQL. `db:migrate` registra o que já foi aplicado e pode ser repetido.

## Preservar e importar os dados do D1

Faça isso **antes de abrir a nova aplicação e cadastrar um novo administrador**.
O importador exige todas as oito tabelas de destino vazias. Ele preserva IDs,
hashes/salts de senha, sessões e relacionamentos, usa transação e ajusta as
sequências dos IDs. Não modifica o SQLite de origem e recusa um segundo import.

Pare somente o serviço antigo durante a cópia e a importação:

```bash
sudo systemctl stop garotodagua
mkdir -p ~/backups/garotodagua
chmod 700 ~/backups/garotodagua
```

Se a mudança para armazenamento permanente foi aplicada nesta conversa:

```bash
cp -a ~/apps/garotodagua-data/wrangler-state ~/backups/garotodagua/state-$(date +%Y%m%d-%H%M%S)
find ~/apps/garotodagua-data/wrangler-state/v3/d1 -type f -name '*.sqlite'
```

Se ainda usa o armazenamento antigo, copie e procure em
`~/apps/garotodagua/dist/server/.wrangler/state` em vez disso. A cópia deve
incluir toda a pasta de estado, inclusive arquivos WAL. Confirme a configuração
efetiva com `sudo systemctl cat garotodagua` em caso de dúvida. Se houver mais de
um arquivo SQLite, identifique o banco correto antes de importar; não escolha
automaticamente o primeiro.

Na pasta `~/apps/garotodagua-postgres`, execute com o caminho real encontrado:

```bash
npm run db:import-d1 -- /caminho/real/do/banco.sqlite
```

Se a importação falhar, guarde o erro e inicie novamente o serviço antigo com
`sudo systemctl start garotodagua`. Não apague tabelas nem use uma opção de reset.
Se realmente deseja começar sem os dados anteriores, não execute o importador;
o primeiro acesso permitirá criar um administrador novo.

## Testar a nova versão antes da troca

Confirme que a porta 3003 está livre (`sudo ss -lntp`) e execute:

```bash
cd ~/apps/garotodagua-postgres
npm start -- --hostname 127.0.0.1 --port 3003
```

Em outra conexão SSH:

```bash
curl --max-time 15 -sS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3003/
```

Deve retornar HTTP 200. O terminal de teste pode ser encerrado com Ctrl+C antes
de ativar o serviço. Se não importou os dados, configure o administrador somente
depois de decidir começar um banco novo.

## Ativar sem manter terminal aberto

Após configurar o `.env`, concluir o build e decidir a importação dos dados,
é possível instalar e ativar o serviço automaticamente:

```bash
cd ~/apps/garotodagua-postgres
bash scripts/install-ec2-service.sh
```

Execute como o usuário da aplicação, sem `sudo` antes de `bash`. O instalador
solicita sudo apenas para administrar o serviço, verifica HTTP 200 na porta 3002,
habilita início automático e restaura a configuração anterior se a ativação falhar.
Ele não aplica migrações nem importa ou apaga dados. Não execute também a
instalação manual abaixo se já usou o instalador.

Os comandos abaixo pressupõem o usuário Ubuntu `ubuntu` e a pasta acima.
Eles criam outro serviço; preservam o serviço anterior e suas configurações.

```bash
cd ~/apps/garotodagua-postgres
NODE_BIN_DIR="$(dirname "$(command -v node)")"
NPM_BIN="$(command -v npm)"

sudo tee /etc/systemd/system/garotodagua-postgres.service > /dev/null <<EOF
[Unit]
Description=GAROTODAGUA PostgreSQL
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/apps/garotodagua-postgres
Environment="PATH=$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin"
Environment=NODE_ENV=production
ExecStart=$NPM_BIN start -- --hostname 127.0.0.1 --port 3002
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl stop garotodagua
sudo systemctl daemon-reload
sudo systemctl start garotodagua-postgres
```

Vinext lê o `.env` privado a partir da pasta de trabalho; a senha não é incluída
no arquivo de serviço. Aguarde a inicialização e teste:

```bash
curl --max-time 15 -sS -o /dev/null -w 'Aplicação: HTTP %{http_code}\n' http://127.0.0.1:3002/
curl --max-time 15 -sS -o /dev/null -w 'Nginx: HTTP %{http_code}\n' http://127.0.0.1:8080/
```

Após ambos retornarem 200, valide login, estoque e pagamentos pelo navegador.
Finalize a troca de inicialização automática:

```bash
sudo systemctl enable garotodagua-postgres
sudo systemctl disable garotodagua
```

Não é necessário mudar o Nginx ou liberar a porta 5432. O endereço continua
`http://3.142.79.208:8080/`, se esse ainda for o IP público. Configure HTTPS antes
de trafegar senhas pela Internet.

Logs: `sudo journalctl -u garotodagua-postgres -n 80 --no-pager`.
Atualizações futuras: backup PostgreSQL, `git pull --ff-only`, `npm ci --include=dev`,
`npm run db:migrate`, `npm run build`, `sudo systemctl restart garotodagua-postgres`.
Pare se houver erro; não use os scripts legados de redefinição de senha via D1.

## Backup e retorno

Um backup do PostgreSQL pode ser gerado sem colocar a senha no histórico:

```bash
pg_dump -h 127.0.0.1 -U garotodagua -d garotodagua -W -Fc \
  -f "$HOME/backups/garotodagua/postgres-$(date +%Y%m%d-%H%M%S).dump"
```

Proteja os backups e mantenha uma cópia fora da instância. O dump contém os dados
e hashes de senha dos usuários.

Para retornar à versão anterior se a validação falhar:

```bash
sudo systemctl disable --now garotodagua-postgres
sudo systemctl enable --now garotodagua
```

Dados gravados no PostgreSQL após a troca não voltam automaticamente para o D1.
Preserve os dois bancos e evite novas gravações enquanto investiga um retorno.

## Validação de desenvolvimento

Use um PostgreSQL descartável cujo nome termine em `_test`, com variáveis PG*
apontando para ele. Nunca execute os testes no banco real:

```bash
npm run db:migrate
npm run test:postgres
npm run build
npm start -- --hostname 127.0.0.1 --port 3002
```

Em outro terminal, com as mesmas variáveis PG* e o mesmo banco descartável:

```bash
npm run test:smoke
```

O teste de integração importa um SQLite de exemplo e verifica transações,
credenciais, relacionamentos e sequências. O smoke test cadastra dados de teste
e verifica autenticação, permissões, estoque, crédito, cobrança e pagamento.
