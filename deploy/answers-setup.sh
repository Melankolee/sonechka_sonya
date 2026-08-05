#!/usr/bin/env bash
# Разовая (и повторяемая) установка сервиса ответов на 45.146.131.218.
# Запускать от root из каталога deploy/:  bash answers-setup.sh
#
# Кладёт answers-api.py в /opt/sonechka, заводит системного пользователя
# sonechka-api, поднимает systemd-юнит на 127.0.0.1:8787. Nginx НЕ трогает —
# на сервере рядом живёт чужой прод, конфиг правится руками (см. README).
set -euo pipefail

APP_USER=sonechka-api
APP_DIR=/opt/sonechka
DATA_DIR=/var/lib/sonechka
UNIT=/etc/systemd/system/sonechka-answers.service
SRC=$(cd "$(dirname "$0")" && pwd)/answers-api.py

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi
[ -f "$SRC" ] || { echo "Не найден $SRC — залей deploy/ на сервер целиком" >&2; exit 1; }

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"

install -d -m 755 "$APP_DIR"
install -m 755 "$SRC" "$APP_DIR/answers-api.py"
# Данные пишет сервис, читать их снаружи незачем.
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"

cat > "$UNIT" <<EOF
[Unit]
Description=Sonechka answers API
After=network.target

[Service]
ExecStart=/usr/bin/python3 $APP_DIR/answers-api.py
User=$APP_USER
Group=$APP_USER
Environment=SONECHKA_HOST=127.0.0.1
Environment=SONECHKA_PORT=8787
Environment=SONECHKA_STORE=$DATA_DIR/answers.jsonl
Restart=always
RestartSec=2

# Сервис смотрит в мир через nginx, поэтому прав ему нужно как можно меньше.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now sonechka-answers
systemctl restart sonechka-answers

sleep 1
curl -fsS http://127.0.0.1:8787/api/health && echo
echo "Готово. Дальше — добавить location /api/ в конфиг nginx (см. deploy/nginx-sonechka-sonya.conf)."
