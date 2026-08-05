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
