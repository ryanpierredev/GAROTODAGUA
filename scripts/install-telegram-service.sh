#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $EUID == 0 ]]; then echo 'Execute como ubuntu, sem sudo antes de bash.' >&2; exit 1; fi
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] || { echo 'Configure o .env privado primeiro.' >&2; exit 1; }
node --env-file=.env --input-type=module <<'JS'
import { readConfig } from './scripts/telegram-alerts.mjs';
readConfig();
JS
sudo -n true
chmod 600 .env
npm run db:migrate
npm run telegram:test
unit=/etc/systemd/system/garotodagua-telegram.service
if sudo -n test -f "$unit"; then sudo -n cp -p "$unit" "$unit.backup-$(date +%Y%m%d-%H%M%S)"; fi
sudo -n tee "$unit" > /dev/null <<EOF
[Unit]
Description=Alertas Telegram GAROTODAGUA
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$(pwd)
Environment="PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
ExecStart="$(command -v npm)" run telegram:worker
Restart=on-failure
RestartSec=10
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
EOF
sudo -n systemd-analyze verify --man=no "$unit"
sudo -n systemctl daemon-reload
sudo -n systemctl enable garotodagua-telegram
sudo -n systemctl restart garotodagua-telegram
echo 'Serviço instalado. Verifique o funcionamento com:'
echo 'sudo systemctl status garotodagua-telegram --no-pager'
echo 'sudo journalctl -u garotodagua-telegram -n 40 --no-pager'
