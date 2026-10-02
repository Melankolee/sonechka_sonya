# travel

Личное PWA для текущей поездки: рейсы, отель, трансфер, заметки, чеклист и
документы. После однократной загрузки работает на iPhone без интернета,
PDF тоже открываются офлайн.

Адрес: **https://travel.sonechka-sonya.ru**

С остальным репозиторием (сайт приглашения в `site/`, `deploy/`) не связано
ничем: свой `package.json`, своя сборка, свой workflow, свой каталог на
сервере и свой блок в Caddy.

```
travel/
├── src/
│   ├── App.tsx              экраны и навигация на хэше (#/section/flights, #/doc/insurance)
│   ├── sw.ts                Service Worker: precache оболочки, обновления
│   ├── pages/               главный экран, разделы, просмотр документа
│   ├── components/          блок офлайна, PDF-viewer (pdf.js), мелкие куски UI
│   ├── hooks/               состояние поездки, обновление приложения, маршрут, чеклист
│   ├── services/            сеть, загрузка для офлайна, проверка готовности, форматирование
│   ├── storage/db.ts        IndexedDB
│   └── types/trip.ts        формат trip.json
├── public/                  иконки, robots.txt (pdfjs/ генерируется при сборке)
├── trips-demo/              демо-поездка, в git
├── trips/                   реальные поездки — НЕ в git (см. «Документы и git»)
├── scripts/                 проверка поездок, копирование ассетов pdf.js
├── deploy/                  Caddy, подготовка сервера, заливка поездок, Docker-вариант
└── vite.config.ts
```

## Как устроен офлайн

Три слоя, и ни один не полагается на HTTP-кеш Safari.

1. **Оболочка приложения** — Service Worker (`src/sw.ts`) кладёт в precache
   HTML, JS, CSS, manifest, иконки и всё, что нужно pdf.js (воркер, шрифты,
   CMaps, wasm). Запуск с Home Screen в авиарежиме берёт `index.html` оттуда.
2. **Данные поездки и документы** — IndexedDB (`src/storage/db.ts`).
   Кнопка **Download trip for offline** скачивает свежий `trip.json` и все
   документы через `fetch`, пишет их в базу как `ArrayBuffer`, читает каждый
   файл обратно и сверяет размер. Поездка считается сохранённой только после
   того, как легли все файлы: оборванная загрузка оставляет прежнюю копию целой.
3. **Проверка готовности** (`src/services/verify.ts`) — при каждом запуске и
   после загрузки смотрит на то, что лежит в хранилищах прямо сейчас: весь ли
   precache на месте, сохранена ли поездка и её version, есть ли у каждого
   документа ненулевой файл нужного размера. Отсюда `Offline ready — 5 / 5` или
   `Offline incomplete — 4 / 5, Missing: Insurance`.

PDF рисуются внутри приложения pdf.js-ом из байтов, взятых в IndexedDB, — без
внешних URL. Кнопка **Save to Files** отдаёт файл в системный Share Sheet
(«Сохранить в Файлы») как запасной вариант.

С интернетом приложение сначала мгновенно показывает сохранённую копию, потом
тихо запрашивает `trip.json`. Если `version` на сервере больше — появляется
**Trip update available**; документы сами не качаются, только по кнопке.
Без интернета — просто метка **Offline**, никаких сетевых ошибок.

## Разработка

```sh
cd travel
npm install
npm run dev          # http://localhost:5173
```

`/trips/` в dev и preview раздаётся из `trips/`, если каталог есть, иначе из
`trips-demo/`. Другой каталог: `TRIPS_DIR=путь npm run dev`.

В `npm run dev` Service Worker выключен: офлайн проверяется на сборке:

```sh
npm run build        # проверка типов + dist/
npm run preview      # http://localhost:4173, с SW и той же CSP, что на проде
```

В Chrome: DevTools → Application → Service Workers / IndexedDB, Network → Offline.

Нужен Node 22.13+ (требование pdf.js).

## Деплой

На сервере (185.103.101.75) Docker нет, все сайты отдаёт общий Caddy. Поэтому
приложение — статика в `/var/www/travel.sonechka-sonya.ru`, которую Caddy
раздаёт сам, по той же схеме, что и основной сайт. TLS выпускает и продлевает
Caddy.

### Разовая настройка (от root)

DNS: A-запись `travel` → 185.103.101.75 в зоне Aeza (на 3 октября 2026 имя
уже резолвится в этот адрес).

```sh
rsync -rlptz travel/deploy/ root@185.103.101.75:/tmp/travel-deploy/
ssh root@185.103.101.75 'cd /tmp/travel-deploy && bash server-setup.sh'
ssh -t root@185.103.101.75 'bash /tmp/travel-deploy/travel-auth.sh travel'   # спросит пароль
# первая сборка — либо push в main (см. ниже), либо руками:
(cd travel && npm ci && npm run build)
rsync -rlptz --exclude=/trips/ travel/dist/ root@185.103.101.75:/var/www/travel.sonechka-sonya.ru/
(cd travel && bash deploy/deploy-trips.sh)
ssh root@185.103.101.75 'chown -R deploy:deploy /var/www/travel.sonechka-sonya.ru && bash /tmp/travel-deploy/caddy-travel.sh'
```

[server-setup.sh](deploy/server-setup.sh) создаёт каталог, владелец — уже
существующий пользователь `deploy`. [caddy-travel.sh](deploy/caddy-travel.sh)
вставляет [caddy-travel.caddy](deploy/caddy-travel.caddy) в общий Caddyfile
между своими маркерами: бэкап, `caddy validate`, откат при ошибке, проверка
соседних сайтов до и после. Блок `birthday.sonechka-sonya.ru` не трогается.

После запуска скрипт проверяет, что без пароля сайт отвечает 401. С
`TRAVEL_AUTH=логин:пароль bash caddy-travel.sh` печатает ещё и Content-Type с
паролем: для `/sw.js` и `/manifest.webmanifest` должны быть `text/javascript`
и `application/manifest+json`.

### Приложение — `git push`

Push в `main`, задевающий `travel/` (кроме `trips-demo/`, `deploy/` и README),
запускает [.github/workflows/deploy-travel.yml](../.github/workflows/deploy-travel.yml):
`npm ci`, `npm run build`, rsync `dist/` в два прохода (сначала новые бандлы,
потом `index.html`/`sw.js` и удаление старого). Секреты те же, что у
основного сайта. Каталог `/trips/` на сервере workflow не трогает.

Запустить вручную: Actions → Deploy travel → Run workflow.

### Поездки — `deploy/deploy-trips.sh`

```sh
cd travel
bash deploy/deploy-trips.sh              # trips/, если есть, иначе trips-demo/
bash deploy/deploy-trips.sh trips-demo   # явно указать каталог
```

Скрипт проверяет каталог (`scripts/check-trips.mjs`), сравнивает sha256 файлов
с серверными и **отказывается заливать**, если файлы поездки изменились, а
`version` не больше серверной: телефон смотрит только на `version` и иначе не
узнает об обновлении. Ходит root-ключом `~/.ssh/presend_deploy`; другой —
через `TRAVEL_HOST` и `TRAVEL_SSH_KEY`.

### Вариант с Docker

Для хоста с Docker и внешним reverse proxy: [Dockerfile](Dockerfile)
(сборка → `nginx:alpine`), [deploy/nginx.conf](deploy/nginx.conf) (кеширование,
MIME для `.webmanifest`/`.mjs`/`.wasm`, CSP),
[deploy/docker-compose.example.yml](deploy/docker-compose.example.yml)
(порт `127.0.0.1:8788`, `trips/` монтируется томом). Контейнер слушает только
HTTP, сертификаты остаются у прокси. На текущем сервере не используется и не
проверялся.

## Документы и git

**Репозиторий публичный.** В git лежит только демо (`trips-demo/`). Реальные
поездки — в `travel/trips/`, он в `.gitignore`, и на сервер их заливает
`deploy-trips.sh`, минуя GitHub. Паспорта, страховки и брони в
`trips-demo/` не класть.

Весь сайт закрыт паролем (HTTP basic auth в Caddy, логин `travel`). Хеш
лежит только на сервере, в `/etc/caddy/travel-auth.caddy`; блок сайта
подключает его через `import`. В git хеша нет: bcrypt короткого пароля
перебирается офлайн. Сменить пароль:

```sh
ssh -t root@185.103.101.75 'bash /tmp/travel-deploy/travel-auth.sh travel'
```

(если `/tmp/travel-deploy` уже вычищен — сначала
`rsync -rlptz travel/deploy/ root@185.103.101.75:/tmp/travel-deploy/`).
Скрипт сам проверит конфиг и перезагрузит Caddy.

Код с паролем дружит: все запросы относительные и same-origin, manifest
запрашивается с credentials, секретов во фронтенде нет. Офлайн пароль не
нужен — оболочка берётся из Service Worker, данные из IndexedDB. Онлайн
установленное приложение на iOS может спрашивать пароль заново после
перезапуска.

## Новая поездка

1. Создай `travel/trips/` (первый раз — скопируй `trips-demo/` целиком).
2. Заведи каталог `trips/<id>/` — `id` латиницей, например `georgia-2027`.
3. Положи `trips/<id>/trip.json` (формат — ниже, образец —
   [trips-demo/maldives-2026/trip.json](trips-demo/maldives-2026/trip.json))
   и документы в `trips/<id>/documents/`.
4. В `trips/index.json` поменяй `"active": "<id>"`.
5. `npm run check-trips` — проверка, `npm run dev` — посмотреть.
6. `bash deploy/deploy-trips.sh`.

На телефоне появится **Trip update available** (сменилась активная поездка).
После **Update** файлы прежней поездки удаляются из памяти телефона.

## Заменить PDF

1. Положи новый файл поверх старого в `trips/<id>/documents/` (имя то же или
   поправь `file` в `trip.json`).
2. Увеличь `version` (следующий пункт).
3. `bash deploy/deploy-trips.sh`.
4. На телефоне: **Trip update available → Update**, дождаться `Offline ready`.

## Увеличить version

В `trips/<id>/trip.json`:

```json
"version": 3
```

Любое целое больше предыдущего. Увеличивать при **любой** правке поездки:
текста, дат, состава документов или содержимого файла. Приложение сравнивает
только это число; `deploy-trips.sh` не даст залить изменённые файлы с прежним
номером.

## Формат trip.json

Даты — `YYYY-MM-DD`, время — `YYYY-MM-DDTHH:MM` местное для точки, без
часового пояса: приложение показывает его как в билете и ничего не пересчитывает.

| Поле | Обязательно | Что это |
| --- | --- | --- |
| `id` | да | совпадает с именем каталога |
| `title` | да | заголовок на главном экране |
| `location.country`, `location.place` | country — да | страна и место |
| `dateFrom`, `dateTo` | да | даты поездки |
| `version` | да | целое, растёт при каждой правке |
| `flights[]` | | `id`, `label`, `airline`, `flightNumber`, `from`/`to` (`code`, `city`, `terminal`), `departure`, `arrival`, `bookingRef`, `seat`, `baggage`, `notes`, `documentId` |
| `stays[]` | | `id`, `name`, `address`, `checkIn`, `checkOut`, `room`, `board`, `bookingRef`, `phone`, `notes`, `documentId` |
| `transfers[]` | | `id`, `title`, `mode`, `departure`, `from`, `to`, `provider`, `phone`, `bookingRef`, `notes`, `documentId` |
| `notes[]` | | `id`, `title`, `text` (абзацы через пустую строку) |
| `checklist[]` | | `id`, `text`, `group`. Отметки хранятся на телефоне по `id` и переживают обновление поездки |
| `documents[]` | | `id`, `title`, `kind` (`guide`, `flight`, `hotel`, `transfer`, `insurance`, `visa`, `other`), `file` (путь от каталога поездки), `mime` (`application/pdf`, `image/jpeg`, `image/png`), `size` (необязательно) |

`documentId` у рейса, отеля или трансфера добавляет в карточку кнопку
открытия этого документа. Пустые разделы на главном экране не показываются.

## Проверка офлайна на iPhone

Важно: **у Safari и у приложения на Home Screen разные хранилища.** Скачанное
во вкладке Safari в установленном приложении не появится — скачивать нужно
изнутри приложения, открытого с иконки. Вне установленного приложения на
iPhone об этом напоминает подсказка вверху экрана.

1. Safari → https://travel.sonechka-sonya.ru → логин и пароль → Share →
   **Add to Home Screen**.
2. Открыть приложение **с иконки** (с интернетом; пароль может спросить ещё
   раз — у приложения своё хранилище). Подождать пару секунд:
   Service Worker докачивает оболочку (~5 МБ).
3. Нажать **Download trip for offline**, дождаться
   `✓ Ready for offline use` и `Offline ready — 5 / 5 documents available`.
   Если вместо этого «App is not cached for offline yet» — закрыть и открыть
   приложение ещё раз с интернетом.
4. Полностью закрыть приложение (свайп вверх в переключателе).
5. Включить **авиарежим** (и выключить Wi-Fi, если он включается вместе с ним).
6. Открыть приложение с иконки.
7. Ожидается: поездка на экране сразу, метка `Offline`, `Offline ready —
   5 / 5`. Никаких сетевых ошибок.
8. Открыть каждый раздел: Flights, Hotel, Transfers, Notes, Checklist
   (отметки ставятся и без сети).
9. Открыть каждый документ: страницы рисуются, зум `− / +` работает.
   **Save to Files** открывает Share Sheet.

Обновление приложения: после деплоя новой сборки при следующем открытии с
интернетом появится **App update available → Reload**. Пока кнопку не нажали,
работает прежняя версия целиком, без смеси старых и новых файлов.

Тот же сценарий прогнан автоматически в Chromium и WebKit (Playwright):
скачать → остановить сервер → открыть заново тем же профилем → все разделы и
все 5 PDF отрисовались; повышение `version` на сервере даёт «Trip update
available», а новый `sw.js` даёт «App update available» с перезагрузкой на
новую версию. Настоящий iPhone это не заменяет — пройти пункты выше руками.
