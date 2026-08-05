# sonechka_sonya

Приглашение на день рождения — статический сайт в [site/](site/).

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
