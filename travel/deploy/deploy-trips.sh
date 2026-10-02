#!/usr/bin/env bash
# Заливает данные поездок на сервер. Запускать с ноутбука из travel/:
#   bash deploy/deploy-trips.sh            # trips/, если есть, иначе trips-demo/
#   bash deploy/deploy-trips.sh trips-demo # явно
#
# Поездки живут отдельно от сборки и не идут через git: репозиторий публичный,
# а в trips/ лежат паспорта и страховки. Сборку приложения CI заливает с
# --exclude=/trips/, так что эти файлы он не трогает.
#
# Перед заливкой:
#   * scripts/check-trips.mjs проверяет trip.json и наличие всех файлов;
#   * если файлы поездки изменились, а version не больше серверной — отказ:
#     телефон сравнивает только version и иначе не узнает об обновлении.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=${1:-$([ -d trips ] && echo trips || echo trips-demo)}
SRC=${SRC%/}
HOST=${TRAVEL_HOST:-root@185.103.101.75}
KEY=${TRAVEL_SSH_KEY:-$HOME/.ssh/presend_deploy}
DEST=/var/www/travel.sonechka-sonya.ru/trips
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes)

echo "Источник: $SRC → $HOST:$DEST"
node scripts/check-trips.mjs "$SRC"

# LC_ALL=C — одинаковый порядок файлов на macOS и Linux, иначе списки не совпадут.
hashes() { find . -type f ! -name '.DS_Store' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256; }

for trip_json in "$SRC"/*/trip.json; do
  dir=$(dirname "$trip_json")
  id=$(basename "$dir")
  local_v=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$trip_json")
  remote_v=$("${SSH[@]}" "$HOST" "cat $DEST/$id/trip.json 2>/dev/null || true" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version)}catch{console.log("")}})')
  [ -n "$remote_v" ] || { echo "  $id: новая поездка, version $local_v"; continue; }

  local_h=$(cd "$dir" && hashes)
  remote_h=$("${SSH[@]}" "$HOST" "cd $DEST/$id && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum" || true)
  if [ "$local_h" = "$remote_h" ]; then
    echo "  $id: без изменений (version $local_v)"
  elif [ "$local_v" -le "$remote_v" ]; then
    echo "  $id: файлы изменились, а version $local_v не больше серверной $remote_v." >&2
    echo "  Увеличь \"version\" в $trip_json — иначе телефон не предложит обновление." >&2
    exit 1
  else
    echo "  $id: version $remote_v → $local_v"
  fi
done

rsync -rlptzc --delete --exclude=.DS_Store -e "${SSH[*]}" "$SRC/" "$HOST:$DEST/"
"${SSH[@]}" "$HOST" "chown -R deploy:deploy $DEST && chmod -R a+rX $DEST"
echo "Готово. Проверка: curl -s -u travel https://travel.sonechka-sonya.ru/trips/index.json"
