#!/usr/bin/env bash
# Установка (и переустановка) API travel-приложения на 185.103.101.75.
# Запускать от root из каталога travel/deploy/ рядом с travel/server/:
#   bash api-setup.sh
#
# Кладёт travel-api.py в /opt/travel, заводит системного пользователя travel-api,
# поднимает юнит travel-api на 127.0.0.1:8788. Данные — /var/lib/travel.
# Заодно разрешает CI обновлять сервис (как deploy/ci-api-access.sh у сервиса
# ответов): deploy получает через sudo ровно одну команду —
# /usr/local/sbin/travel-update-api. Caddy не трогает — это caddy-travel.sh.
set -euo pipefail

APP_USER=travel-api
APP_DIR=/opt/travel
DATA_DIR=/var/lib/travel
UNIT=travel-api
PORT=8788
DEPLOY_USER=deploy
UPDATER=/usr/local/sbin/travel-update-api
SUDOERS=/etc/sudoers.d/travel-api
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${SRC:-$HERE/../server/travel-api.py}

[ "$(id -u)" -eq 0 ] || { echo "Нужны права root" >&2; exit 1; }
[ -f "$SRC" ] || { echo "Не найден $SRC — залей travel/deploy и travel/server на сервер" >&2; exit 1; }
id -u "$DEPLOY_USER" >/dev/null 2>&1 || { echo "Нет пользователя $DEPLOY_USER" >&2; exit 1; }
python3 -m py_compile "$SRC"

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"

install -d -m 755 "$APP_DIR"
install -m 755 -o root -g root "$SRC" "$APP_DIR/travel-api.py"
# 755: файлы поездок читает Caddy напрямую (/trips/*), пишет только сервис.
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR" "$DATA_DIR/trips"

cat > /etc/systemd/system/$UNIT.service <<UNIT_EOF
[Unit]
Description=Travel PWA API
After=network.target

[Service]
ExecStart=/usr/bin/python3 $APP_DIR/travel-api.py
User=$APP_USER
Group=$APP_USER
Environment=TRAVEL_HOST=127.0.0.1
Environment=TRAVEL_PORT=$PORT
Environment=TRAVEL_DATA=$DATA_DIR
UMask=0022
Restart=always
RestartSec=2

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable --now $UNIT
systemctl restart $UNIT

# ---- обновление из CI ----
HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
STAGING="$HOME_DIR/travel-api-staging"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$STAGING"

cat > "$UPDATER" <<UPD_EOF
#!/usr/bin/env bash
# Ставит подготовленный CI файл travel-api.py и перезапускает сервис.
# Вызывается только так:  sudo $UPDATER
set -euo pipefail
SRC=$STAGING/travel-api.py
DST=$APP_DIR/travel-api.py
BACKUP=\$(mktemp /tmp/travel-api.prev.XXXXXX)
[ -f "\$SRC" ] || { echo "Нет \$SRC — CI ничего не залил" >&2; exit 1; }
python3 -m py_compile "\$SRC" || { echo "\$SRC не компилируется, не ставлю" >&2; exit 1; }
if cmp -s "\$SRC" "\$DST"; then echo "Файл не изменился, перезапуск не нужен"; exit 0; fi
[ -f "\$DST" ] && cp -p "\$DST" "\$BACKUP"
install -m 755 -o root -g root "\$SRC" "\$DST"
systemctl restart $UNIT
for i in 1 2 3 4 5; do
  sleep 1
  if curl -fsS -o /dev/null http://127.0.0.1:$PORT/api/health; then
    echo "Сервис обновлён и отвечает"; rm -f "\$BACKUP"; exit 0
  fi
done
echo "После обновления /api/health молчит, откатываю" >&2
if [ -s "\$BACKUP" ]; then install -m 755 -o root -g root "\$BACKUP" "\$DST"; systemctl restart $UNIT; fi
rm -f "\$BACKUP"
exit 1
UPD_EOF
chmod 755 "$UPDATER"
chown root:root "$UPDATER"

TMP_SUDOERS=$(mktemp)
echo "$DEPLOY_USER ALL=(root) NOPASSWD: $UPDATER" > "$TMP_SUDOERS"
if visudo -cf "$TMP_SUDOERS" >/dev/null; then
  install -m 440 -o root -g root "$TMP_SUDOERS" "$SUDOERS"
else
  echo "Правило sudoers не прошло проверку, ничего не менял" >&2
  rm -f "$TMP_SUDOERS"; exit 1
fi
rm -f "$TMP_SUDOERS"

sleep 1
curl -fsS http://127.0.0.1:$PORT/api/health && echo
echo "Готово. Сервис $UNIT на 127.0.0.1:$PORT, данные в $DATA_DIR."
