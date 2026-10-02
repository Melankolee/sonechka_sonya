#!/usr/bin/env bash
# Подключает travel.sonechka-sonya.ru к Caddy на 185.103.101.75.
# Запускать от root из каталога travel/deploy/:  bash caddy-travel.sh
#
# Так же, как deploy/caddy-site.sh у основного сайта: Caddyfile общий, поэтому
#   * блок вставляется между своими маркерами, остальное не трогается;
#   * перед заменой — бэкап, при неудачном `caddy validate` — откат без reload;
#   * до и после проверяется, что соседние сайты отвечают тем же кодом.
set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)/caddy-travel.caddy
CADDYFILE=/etc/caddy/Caddyfile
STAMP=$(date +%Y%m%d-%H%M%S)
BEGIN='# >>> travel.sonechka-sonya.ru (travel/deploy/caddy-travel.sh)'
END='# <<< travel.sonechka-sonya.ru'
NEIGHBOURS=${NEIGHBOURS:-"job-radar.su birthday.sonechka-sonya.ru"}
SITE=https://travel.sonechka-sonya.ru

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi
[ -f "$SRC" ] || { echo "Не найден $SRC — залей travel/deploy/ на сервер целиком" >&2; exit 1; }
grep -q "@locked" /etc/caddy/travel-auth.caddy 2>/dev/null || { echo "В /etc/caddy/travel-auth.caddy нет @locked — сначала bash travel-auth.sh" >&2; exit 1; }
[ -d /var/www/travel.sonechka-sonya.ru ] || { echo "Нет /var/www/travel.sonechka-sonya.ru — сначала bash server-setup.sh" >&2; exit 1; }

codes() {
  for h in $NEIGHBOURS; do
    printf '%s=%s ' "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$h/" || echo 000)"
  done
}
BEFORE=$(codes)
echo "Соседи до правки: $BEFORE"

BACKUP="$CADDYFILE.bak-travel-$STAMP"
cp -p "$CADDYFILE" "$BACKUP"
echo "Бэкап: $BACKUP"

NEW=$(mktemp)
awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$BACKUP" > "$NEW"
{ printf '\n%s\n' "$BEGIN"; cat "$SRC"; printf '%s\n' "$END"; } >> "$NEW"
cat -s "$NEW" > "$CADDYFILE"
rm -f "$NEW"

echo "--- что меняется ---"
diff -u "$BACKUP" "$CADDYFILE" || true
echo "--------------------"

if ! caddy validate --config "$CADDYFILE" --adapter caddyfile; then
  echo "caddy validate не прошёл — возвращаю Caddyfile" >&2
  cat "$BACKUP" > "$CADDYFILE"
  echo "Откат сделан, Caddy не перезагружался." >&2
  exit 1
fi

systemctl reload caddy
echo "Caddy перезагружен"

# Первый сертификат выпускается секунд за десять.
sleep 15
echo "--- проверки ---"
# Оболочка открыта (200), данные без cookie входа — 401. С
# TRAVEL_PASSWORD=… bash caddy-travel.sh — ещё и вход и те же адреса с cookie.
for p in / /sw.js /manifest.webmanifest /trips/index.json /api/trips; do
  curl -s -o /dev/null -w "GET $p без входа: HTTP %{http_code}\n" --max-time 30 "$SITE$p" || true
done
if [ -n "${TRAVEL_PASSWORD:-}" ]; then
  JAR=$(mktemp)
  curl -s -o /dev/null -c "$JAR" -H 'Content-Type: application/json' \
    --data "$(python3 -c 'import json,os; print(json.dumps({"password": os.environ["TRAVEL_PASSWORD"]}))')" \
    -w "POST /api/login: HTTP %{http_code}\n" --max-time 30 "$SITE/api/login" || true
  for p in /trips/index.json /api/trips; do
    curl -s -o /dev/null -b "$JAR" -w "GET $p со входом: HTTP %{http_code}, %{content_type}\n" --max-time 30 "$SITE$p" || true
  done
  rm -f "$JAR"
fi
AFTER=$(codes)
echo "Соседи после правки: $AFTER"
[ "$BEFORE" = "$AFTER" ] || echo "ВНИМАНИЕ: коды соседних сайтов изменились ($BEFORE → $AFTER)" >&2
echo "Готово."
