#!/usr/bin/env bash
# Разовая настройка сервера под автодеплой из GitHub Actions.
# Запускать на 45.146.131.218 от root:  bash server-setup.sh
#
# Заводит отдельного пользователя deploy, которому доступен ТОЛЬКО каталог сайта.
# Ключ GitHub Actions намеренно не получает root: на этом сервере рядом живёт
# чужой прод. Nginx скрипт не трогает.
set -euo pipefail

DEPLOY_USER=deploy
WEBROOT=/var/www/sonechka-sonya.ru
PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ39HVMcQK/wlfTDclxnqvrgpDdwfkaOmCXvwCE5xeMg github-actions-deploy@sonechka-sonya'

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi

if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
  echo "Создан пользователь $DEPLOY_USER"
fi

HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
touch "$HOME_DIR/.ssh/authorized_keys"
grep -qxF "$PUBKEY" "$HOME_DIR/.ssh/authorized_keys" || echo "$PUBKEY" >> "$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WEBROOT"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$WEBROOT"

# rsync должен быть на сервере, иначе заливка молча не поедет.
command -v rsync >/dev/null 2>&1 || { apt-get update && apt-get install -y rsync; }

echo "Готово. Каталог $WEBROOT принадлежит $DEPLOY_USER, ключ деплоя добавлен."
