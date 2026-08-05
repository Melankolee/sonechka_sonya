# sonechka_sonya

Приглашение на день рождения — статический сайт в [site/](site/).

## Персональные страницы

У каждой гостьи своя ссылка, отличается только обращение в шапке:

| Ссылка | Обращение |
| --- | --- |
| `sonechka-sonya.ru/nastia` | Настя |
| `sonechka-sonya.ru/uliya` | Уля |
| `sonechka-sonya.ru/ksusha` | Ксюша |

Сами страницы — символические ссылки на `index.html` (`site/nastia.html` и
соседние), чтобы правку контента не приходилось повторять три раза. Имя
подставляется по адресу страницы, список — в `guests` внутри
[site/index.html](site/index.html). Без расширения (`/nastia`) страницы
открываются благодаря `try_files $uri $uri.html` в конфиге nginx — эту строчку
нужно один раз применить на сервере; по `/nastia.html` работает и без неё.

## Деплой

Автоматический: пуш в `main`, задевающий `site/**`, запускает
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), который заливает
`site/` по rsync в `/var/www/sonechka-sonya.ru` на 45.146.131.218.
Можно запустить и вручную — вкладка Actions → Deploy site → Run workflow.

Секреты репозитория:

| Секрет | Значение |
| --- | --- |
| `DEPLOY_HOST` | `45.146.131.218` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | приватный ключ пары, чей публичный лежит в [deploy/server-setup.sh](deploy/server-setup.sh) |
| `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan -t ed25519 45.146.131.218` |

Разовая настройка сервера — [deploy/server-setup.sh](deploy/server-setup.sh)
(заводит непривилегированного пользователя `deploy` с доступом только к каталогу
сайта; root у CI намеренно нет, на сервере рядом чужой прод).

Конфиг nginx — [deploy/nginx-sonechka-sonya.conf](deploy/nginx-sonechka-sonya.conf).

## Ответы гостей

Гостья нажимает «Я приду» → `POST /api/answers` → сервис `sonechka-answers`
(127.0.0.1:8787, [deploy/answers-api.py](deploy/answers-api.py)) дописывает строку
в `/var/lib/sonechka/answers.jsonl`. Читает их страница
[sonechka-sonya.ru/sonechka](site/sonechka.html): последний ответ каждой гостьи
плюс общий подсчёт. Если сети нет, ответ ждёт в `localStorage` и досылается при
следующем открытии — гостья ошибки не видит.

Установлено на сервере 5 августа 2026. Повторить или обновить (от root):

```
scp -r deploy root@45.146.131.218:/tmp/sonechka-deploy
ssh root@45.146.131.218 'cd /tmp/sonechka-deploy && bash answers-setup.sh && bash answers-nginx.sh'
```

[answers-setup.sh](deploy/answers-setup.sh) ставит сервис и systemd-юнит,
[answers-nginx.sh](deploy/answers-nginx.sh) — зону `limit_req` в `conf.d/` и
`location /api/` в конфиг сайта, с бэкапом и откатом, если `nginx -t` не пройдёт.
Автодеплой этого не делает: он возит только `site/`, а nginx на этом сервере
правится осознанно — рядом чужой прод `tabletop-broadmap.pro`.

Ручка `GET /api/answers` и страница `/sonechka` открыты без пароля: кто угадает
адрес — прочитает ответы.
