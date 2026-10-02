#!/usr/bin/env bash
# Подключает сайт к Caddy на 185.103.101.75.
# Запускать от root из каталога deploy/:  bash caddy-site.sh
#
# Caddyfile на сервере общий — в нём живут job-radar.su и сервисы aso-kw.ru,
# поэтому:
#   * наш блок вставляется между маркерами и при повторном запуске заменяется,
#     остальное содержимое файла не трогается;
#   * перед заменой Caddyfile сохраняется рядом, и если `caddy validate` не
#     прошёл — возвращается на место, reload не случается;
#   * до и после проверяется, что соседний сайт отвечает тем же кодом.
set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)/caddy-sonechka-sonya.caddy
CADDYFILE=/etc/caddy/Caddyfile
STAMP=$(date +%Y%m%d-%H%M%S)
BEGIN='# >>> sonechka-sonya.ru (deploy/caddy-site.sh)'
END='# <<< sonechka-sonya.ru'
NEIGHBOUR=${NEIGHBOUR_HOST:-job-radar.su}

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi
[ -f "$SRC" ] || { echo "Не найден $SRC — залей deploy/ на сервер целиком" >&2; exit 1; }

neighbour_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$NEIGHBOUR/" || echo 000; }
BEFORE=$(neighbour_code)
echo "Соседний $NEIGHBOUR до правки: HTTP $BEFORE"

BACKUP="$CADDYFILE.bak-sonechka-$STAMP"
cp -p "$CADDYFILE" "$BACKUP"
echo "Бэкап: $BACKUP"

# Старый блок (если был) вырезаем, новый дописываем в конец.
NEW=$(mktemp)
awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$BACKUP" > "$NEW"
{ printf '\n%s\n' "$BEGIN"; cat "$SRC"; printf '%s\n' "$END"; } >> "$NEW"
# Пустые строки, накопившиеся от повторных запусков, схлопываем.
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

# При первом запуске Caddy выпускает сертификат секунд за десять, до этого
# TLS не проходит. Проверки только сообщают — `|| true`, иначе set -e обрывает
# скрипт на первой же и до соседнего сайта дело не доходит.
sleep 15
echo "--- проверки ---"
SITE=https://birthday.sonechka-sonya.ru
curl -fsS --max-time 30 "$SITE/api/health" && echo || echo "api/health пока не отвечает" >&2
for p in / /nastia /sonechka; do
  curl -s -o /dev/null -w "GET $p: HTTP %{http_code}\n" --max-time 30 "$SITE$p" || true
done
curl -s -o /dev/null -w "старый адрес /nastia: HTTP %{http_code} → %{redirect_url}\n" --max-time 30 https://sonechka-sonya.ru/nastia || true
AFTER=$(neighbour_code)
echo "Соседний $NEIGHBOUR после правки: HTTP $AFTER"
[ "$BEFORE" = "$AFTER" ] || echo "ВНИМАНИЕ: код соседнего сайта изменился ($BEFORE → $AFTER)" >&2
echo "Готово."
