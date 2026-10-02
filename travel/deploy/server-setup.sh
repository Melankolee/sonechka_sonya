#!/usr/bin/env bash
# Разовая подготовка сервера под travel.sonechka-sonya.ru.
# Запускать на 185.103.101.75 от root:  bash server-setup.sh
#
# Пользователь deploy уже заведён deploy/server-setup.sh основного сайта — его
# ключ GitHub Actions заливает и эту сборку. Здесь только каталог.
set -euo pipefail

DEPLOY_USER=deploy
WEBROOT=/var/www/travel.sonechka-sonya.ru

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi
id -u "$DEPLOY_USER" >/dev/null 2>&1 || { echo "Нет пользователя $DEPLOY_USER — сначала deploy/server-setup.sh основного сайта" >&2; exit 1; }

install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WEBROOT" "$WEBROOT/trips"
echo "Готово: $WEBROOT принадлежит $DEPLOY_USER."
