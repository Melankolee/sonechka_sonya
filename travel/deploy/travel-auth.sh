#!/usr/bin/env bash
# Задаёт или меняет пароль на travel.sonechka-sonya.ru.
# Запускать на сервере от root:  bash travel-auth.sh [логин]   (по умолчанию travel)
# Пароль спрашивается без эха; можно подать и через stdin.
#
# Хеш лежит только на сервере, в /etc/caddy/travel-auth.caddy, — блок сайта
# подключает его через import. В git его нет: репозиторий публичный, а bcrypt-
# хеш короткого пароля перебирается офлайн.
set -euo pipefail

USER_NAME=${1:-travel}
AUTH=/etc/caddy/travel-auth.caddy
CADDYFILE=/etc/caddy/Caddyfile

[ "$(id -u)" -eq 0 ] || { echo "Нужны права root" >&2; exit 1; }

if [ -t 0 ]; then
  read -rsp "Пароль для $USER_NAME: " PASS; echo
  read -rsp "Ещё раз: " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "Пароли не совпали" >&2; exit 1; }
else
  IFS= read -r PASS
fi
[ -n "$PASS" ] || { echo "Пустой пароль" >&2; exit 1; }

HASH=$(caddy hash-password --plaintext "$PASS")
unset PASS PASS2

NEW=$(mktemp)
printf 'basic_auth {\n\t%s %s\n}\n' "$USER_NAME" "$HASH" > "$NEW"
[ -f "$AUTH" ] && cp -p "$AUTH" "$AUTH.bak"
install -m 640 -o root -g caddy "$NEW" "$AUTH"
rm -f "$NEW"
echo "Записан $AUTH (логин $USER_NAME)"

# Если сайт уже подключён — применить сразу, с откатом при ошибке.
if grep -qF 'import /etc/caddy/travel-auth.caddy' "$CADDYFILE"; then
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo "Caddy перезагружен"
  else
    echo "caddy validate не прошёл — возвращаю прежний $AUTH" >&2
    [ -f "$AUTH.bak" ] && mv "$AUTH.bak" "$AUTH"
    exit 1
  fi
fi
rm -f "$AUTH.bak"
