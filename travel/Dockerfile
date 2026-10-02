# Запасной вариант: приложение в nginx-контейнере за внешним reverse proxy.
# На текущем сервере Docker нет и сайт отдаёт Caddy напрямую
# (deploy/caddy-travel.caddy) — этот файл для другого хоста.
#   docker compose -f deploy/docker-compose.example.yml up -d --build
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Поездки не запекаются в образ, а монтируются томом в /usr/share/nginx/html/trips.
