#!/usr/bin/env bash
# Задаёт или меняет пароль на travel.sonechka-sonya.ru.
# Запускать на сервере от root:  bash travel-auth.sh
# Пароль спрашивается без эха; можно подать и через stdin.
# NO_RELOAD=1 — записать файлы, не трогая Caddy (см. ниже).
#
# Пишет два файла, оба только на сервере (в git их нет — репозиторий публичный):
#   /etc/travel/auth.json          соль и scrypt-хеш пароля + токен сессии;
#                                  читает travel-api на POST /api/login
#   /etc/caddy/travel-auth.caddy   матчер @locked с тем же токеном: без cookie
#                                  travel_session=<токен> Caddy отвечает 401
#                                  на /api/* и /trips/*
# Смена пароля меняет и токен — все устройства выйдут и войдут заново.
set -euo pipefail

AUTH_JSON=/etc/travel/auth.json
AUTH_CADDY=/etc/caddy/travel-auth.caddy
CADDYFILE=/etc/caddy/Caddyfile

[ "$(id -u)" -eq 0 ] || { echo "Нужны права root" >&2; exit 1; }
id -u travel-api >/dev/null 2>&1 || { echo "Нет пользователя travel-api — сначала bash api-setup.sh" >&2; exit 1; }

if [ -t 0 ]; then
  read -rsp "Новый пароль: " PASS; echo
  read -rsp "Ещё раз: " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "Пароли не совпали" >&2; exit 1; }
else
  IFS= read -r PASS
fi
[ -n "$PASS" ] || { echo "Пустой пароль" >&2; exit 1; }

install -d -m 750 -o root -g travel-api /etc/travel
for f in "$AUTH_JSON" "$AUTH_CADDY"; do [ -f "$f" ] && cp -p "$f" "$f.bak"; done

NEW_JSON=$(mktemp)
TOKEN=$(PASS="$PASS" python3 - "$NEW_JSON" <<'PY'
import hashlib, json, os, secrets, sys
salt = secrets.token_hex(16)
digest = hashlib.scrypt(os.environ['PASS'].encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1).hex()
token = secrets.token_urlsafe(32)
with open(sys.argv[1], 'w') as f:
    json.dump({'salt': salt, 'hash': digest, 'token': token}, f)
print(token)
PY
)
unset PASS PASS2
install -m 640 -o root -g travel-api "$NEW_JSON" "$AUTH_JSON"
rm -f "$NEW_JSON"

NEW_CADDY=$(mktemp)
cat > "$NEW_CADDY" <<EOF
# Генерирует travel/deploy/travel-auth.sh. Не коммитить и не править руками.
@locked {
	path /api/* /trips/*
	not path /api/login
	expression \`{http.request.cookie.travel_session} != "$TOKEN"\`
}
EOF
install -m 640 -o root -g caddy "$NEW_CADDY" "$AUTH_CADDY"
rm -f "$NEW_CADDY"
echo "Записаны $AUTH_JSON и $AUTH_CADDY"

restore() {
  for f in "$AUTH_JSON" "$AUTH_CADDY"; do [ -f "$f.bak" ] && mv "$f.bak" "$f"; done
}

# NO_RELOAD=1 — только записать файлы: caddy-travel.sh следом проверит и
# перезагрузит Caddy сам, одним шагом вместе с новым блоком сайта.
if [ -z "${NO_RELOAD:-}" ] && grep -qF 'import /etc/caddy/travel-auth.caddy' "$CADDYFILE"; then
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo "Caddy перезагружен"
  else
    echo "caddy validate не прошёл — возвращаю прежние файлы" >&2
    restore
    exit 1
  fi
fi
rm -f "$AUTH_JSON.bak" "$AUTH_CADDY.bak"
echo "Готово. Все устройства войдут заново с новым паролем."
