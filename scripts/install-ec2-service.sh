#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID == 0 ]]; then
  echo 'Execute como o usuário da aplicação, sem sudo antes de bash.' >&2
  exit 1
fi

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
for command in node npm curl systemctl sudo; do
  command -v "$command" >/dev/null || { echo "Comando ausente: $command" >&2; exit 1; }
done
[[ -f .env && -d dist/server ]] || {
  echo 'Configure o .env privado e execute npm run build antes de instalar o serviço.' >&2
  exit 1
}
node --env-file=.env --input-type=module <<'JS'
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.scripts.start !== 'vinext start') throw new Error('Use a versão PostgreSQL deste projeto.');
if (!process.env.PGDATABASE || !process.env.PGUSER) throw new Error('Configure PGDATABASE e PGUSER.');
JS

chmod 600 .env
npm_bin="$(command -v npm)"
node_bin_dir="$(dirname "$(command -v node)")"
service_user="$(id -un)"
unit=/etc/systemd/system/garotodagua-postgres.service
old_active=false
new_active=false
old_enabled=false
new_enabled=false
systemctl is-active --quiet garotodagua && old_active=true
systemctl is-active --quiet garotodagua-postgres && new_active=true
systemctl is-enabled --quiet garotodagua && old_enabled=true
systemctl is-enabled --quiet garotodagua-postgres && new_enabled=true

sudo -v
scratch_dir="$(mktemp -d)"
had_unit=false
if sudo test -f "$unit"; then
  had_unit=true
  sudo cp -p "$unit" "$scratch_dir/previous.service"
  sudo cp -p "$unit" "$unit.backup-$(date +%Y%m%d-%H%M%S)"
fi

switching=false
finish() {
  local result=$?
  trap - EXIT
  if [[ "$switching" == true && $result != 0 ]]; then
    echo 'Falha na ativação. Restaurando a configuração anterior.' >&2
    sudo journalctl -u garotodagua-postgres -n 40 --no-pager >&2 || true
    sudo systemctl stop garotodagua-postgres || true
    if [[ "$had_unit" == true ]]; then
      sudo cp -p "$scratch_dir/previous.service" "$unit" || true
    else
      sudo systemctl disable garotodagua-postgres || true
      sudo rm -f "$unit" || true
    fi
    sudo systemctl daemon-reload || true
    if [[ "$new_enabled" == true ]]; then
      sudo systemctl enable garotodagua-postgres || true
    else
      sudo systemctl disable garotodagua-postgres || true
    fi
    if [[ "$old_enabled" == true ]]; then sudo systemctl enable garotodagua || true; fi
    if [[ "$new_active" == true ]]; then sudo systemctl start garotodagua-postgres || true; fi
    if [[ "$old_active" == true ]]; then sudo systemctl start garotodagua || true; fi
  fi
  sudo rm -rf -- "$scratch_dir"
  exit "$result"
}
trap finish EXIT

cat > "$scratch_dir/new.service" <<EOF
[Unit]
Description=GAROTODAGUA PostgreSQL
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
Type=simple
User=$service_user
WorkingDirectory="$project_dir"
Environment="PATH=$node_bin_dir:/usr/local/bin:/usr/bin:/bin"
Environment=NODE_ENV=production
ExecStart="$npm_bin" start -- --hostname 127.0.0.1 --port 3002
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

switching=true
sudo install -m 644 "$scratch_dir/new.service" "$unit"
sudo systemctl daemon-reload
if [[ "$old_active" == true ]]; then sudo systemctl stop garotodagua; fi
sudo systemctl restart garotodagua-postgres

ready=false
for ((attempt = 0; attempt < 20; attempt++)); do
  code="$(curl --silent --output /dev/null --max-time 2 --write-out '%{http_code}' http://127.0.0.1:3002/ || true)"
  if [[ "$code" == 200 ]] && systemctl is-active --quiet garotodagua-postgres; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'A aplicação não retornou HTTP 200.' >&2; exit 1; }

sudo systemctl enable garotodagua-postgres
if [[ "$old_enabled" == true ]]; then sudo systemctl disable garotodagua; fi
switching=false
echo 'Serviço PostgreSQL ativo, HTTP 200 na porta 3002 e início automático habilitado.'
echo 'Você pode fechar o terminal SSH.'
curl --silent --output /dev/null --max-time 5 --write-out 'Nginx: HTTP %{http_code}\n' http://127.0.0.1:8080/ || true
