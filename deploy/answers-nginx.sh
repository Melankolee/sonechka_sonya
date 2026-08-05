#!/usr/bin/env bash
# Вторая половина установки сервиса ответов: правка nginx.
# Запускать от root из каталога deploy/ ПОСЛЕ answers-setup.sh:  bash answers-nginx.sh
#
# На сервере рядом живёт чужой прод (tabletop-broadmap.pro), поэтому:
#   * зона limit_req кладётся отдельным файлом в conf.d/, а не в общий nginx.conf;
#   * конфиг сайта перед заменой сохраняется, и при `nginx -t` с ошибкой
#     возвращается на место — reload не случится с поломанным конфигом;
#   * до и после проверяется, что соседний сайт отвечает тем же кодом.
set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)
LIMITS=/etc/nginx/conf.d/sonechka-limits.conf
STAMP=$(date +%Y%m%d-%H%M%S)
NEIGHBOUR=${NEIGHBOUR_HOST:-tabletop-broadmap.pro}

if [ "$(id -u)" -ne 0 ]; then
  echo "Нужны права root" >&2
  exit 1
fi

# Конфиг сайта ищем по server_name, а не по угаданному пути: certbot и рука
# человека могли положить его куда угодно. Смотрим только во включённых —
# в sites-available рядом валяются бэкапы с тем же server_name, они не в счёт.
# -R идёт по симлинкам, readlink возвращает настоящий файл в sites-available.
mapfile -t FOUND < <(grep -Rls -e 'server_name .*sonechka-sonya\.ru' \
  /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | xargs -r -n1 readlink -f | sort -u)
if [ "${#FOUND[@]}" -ne 1 ]; then
  echo "Ожидал ровно один конфиг с server_name sonechka-sonya.ru, нашёл ${#FOUND[@]}:" >&2
  printf '  %s\n' "${FOUND[@]:-（ничего）}" >&2
  echo "Поправь руками и перезапусти." >&2
  exit 1
fi
SITE=${FOUND[0]}
echo "Конфиг сайта: $SITE"

neighbour_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$NEIGHBOUR/" || echo 000; }
BEFORE=$(neighbour_code)
echo "Соседний $NEIGHBOUR до правки: HTTP $BEFORE"

# 1. Зона limit_req в http{} — попадает туда через уже существующий include conf.d/*.conf
install -m 644 "$SRC/nginx-sonechka-limits.conf" "$LIMITS"
echo "Положил $LIMITS"

# 2. Конфиг сайта. Бэкап рядом, чтобы откат не зависел от /tmp.
BACKUP="$SITE.bak-$STAMP"
cp -p "$SITE" "$BACKUP"
echo "Бэкап: $BACKUP"
echo "--- что меняется ---"
diff -u "$BACKUP" "$SRC/nginx-sonechka-sonya.conf" || true
echo "--------------------"
cat "$SRC/nginx-sonechka-sonya.conf" > "$SITE"

if ! nginx -t; then
  echo "nginx -t не прошёл — откатываю конфиг сайта и зону" >&2
  cat "$BACKUP" > "$SITE"
  rm -f "$LIMITS"
  nginx -t
  echo "Откат сделан, nginx не перезагружался." >&2
  exit 1
fi

systemctl reload nginx
echo "nginx перезагружен"

sleep 1
echo "--- проверки ---"
curl -fsS --max-time 10 https://sonechka-sonya.ru/api/health && echo
curl -s -o /dev/null -w 'GET /api/answers: HTTP %{http_code}\n' --max-time 10 https://sonechka-sonya.ru/api/answers
curl -s -o /dev/null -w 'GET /sonechka:     HTTP %{http_code}\n' --max-time 10 https://sonechka-sonya.ru/sonechka
AFTER=$(neighbour_code)
echo "Соседний $NEIGHBOUR после правки: HTTP $AFTER"
[ "$BEFORE" = "$AFTER" ] || echo "ВНИМАНИЕ: код соседнего сайта изменился ($BEFORE → $AFTER)" >&2
echo "Готово."
