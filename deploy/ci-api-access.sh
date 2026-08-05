#!/usr/bin/env bash
# Разовая настройка: разрешить автодеплою обновлять сервис ответов.
# Запускать на 45.146.131.218 от root:  bash ci-api-access.sh
#
# После этого правки deploy/answers-api.py уезжают на сервер обычным git push —
# руками сюда больше заходить не нужно.
#
# Права выдаются впритык. Пользователь deploy получает не root, а ровно одну
# команду через sudo: /usr/local/sbin/sonechka-update-api. Скрипт принадлежит
# root и для deploy не перезаписываем, так что подменить его содержимое CI не
# может. Всё, что он делает, — переносит подготовленный файл из staging в
# /opt/sonechka и перезапускает юнит; сам сервис как работал под sonechka-api,
# так и работает, root ему не достаётся.
set -euo pipefail

DEPLOY_USER=deploy
APP_DIR=/opt/sonechka
UNIT=sonechka-answers
UPDATER=/usr/local/sbin/sonechka-update-api
SUDOERS=/etc/sudoers.d/sonechka-api

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi
id -u "$DEPLOY_USER" >/dev/null 2>&1 || { echo "Нет пользователя $DEPLOY_USER — сначала server-setup.sh" >&2; exit 1; }

HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
STAGING="$HOME_DIR/api-staging"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$STAGING"

cat > "$UPDATER" <<EOF
#!/usr/bin/env bash
# Ставит подготовленный CI файл answers-api.py и перезапускает сервис.
# Вызывается только так:  sudo $UPDATER
set -euo pipefail

SRC=$STAGING/answers-api.py
DST=$APP_DIR/answers-api.py
BACKUP=\$(mktemp /tmp/answers-api.prev.XXXXXX)

[ -f "\$SRC" ] || { echo "Нет \$SRC — CI ничего не залил" >&2; exit 1; }

# Битый файл уронил бы сервис в цикл перезапусков, а гостьи в этот момент
# отправляют ответы. Сначала синтаксис, потом всё остальное.
python3 -m py_compile "\$SRC" || { echo "\$SRC не компилируется, не ставлю" >&2; exit 1; }

if cmp -s "\$SRC" "\$DST"; then
  echo "Файл не изменился, перезапуск не нужен"
  exit 0
fi

[ -f "\$DST" ] && cp -p "\$DST" "\$BACKUP"
install -m 755 -o root -g root "\$SRC" "\$DST"
systemctl restart $UNIT

# Здоровье проверяем не сразу: юниту нужно поднять сокет.
for i in 1 2 3 4 5; do
  sleep 1
  if curl -fsS -o /dev/null http://127.0.0.1:8787/api/health; then
    echo "Сервис обновлён и отвечает"
    rm -f "\$BACKUP"
    exit 0
  fi
done

# Не ответил — откатываемся на предыдущую версию, вечер важнее новой правки.
echo "После обновления /api/health молчит, откатываю" >&2
if [ -s "\$BACKUP" ]; then
  install -m 755 -o root -g root "\$BACKUP" "\$DST"
  systemctl restart $UNIT
  rm -f "\$BACKUP"
fi
exit 1
EOF
chmod 755 "$UPDATER"
chown root:root "$UPDATER"

# NOPASSWD — у CI нет пароля deploy и быть не должно. Через visudo -cf, иначе
# кривой файл ломает sudo целиком, включая чужой прод по соседству.
TMP_SUDOERS=$(mktemp)
echo "$DEPLOY_USER ALL=(root) NOPASSWD: $UPDATER" > "$TMP_SUDOERS"
if visudo -cf "$TMP_SUDOERS" >/dev/null; then
  install -m 440 -o root -g root "$TMP_SUDOERS" "$SUDOERS"
  rm -f "$TMP_SUDOERS"
else
  rm -f "$TMP_SUDOERS"
  echo "Правило sudoers не прошло проверку, ничего не менял" >&2
  exit 1
fi

echo "Готово. $DEPLOY_USER может выполнять только: sudo $UPDATER"
echo "Staging для CI: $STAGING/answers-api.py"
