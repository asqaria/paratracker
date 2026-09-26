# syntax=docker/dockerfile:1.7
#
# Прод-образы Skyline (ТЗ §11.4, Фаза 1): один Dockerfile, две цели.
#   server — API и воркер (одна кодовая база, разные команды в compose);
#   web    — статика фронта в Caddy, /api проксируется на API.
# Сборка:  docker build --target server -t skyline-server .
#          docker build --target web --build-arg VITE_... -t skyline-web .

FROM node:22-alpine AS base
# Версия pnpm — из packageManager корневого package.json.
RUN corepack enable
WORKDIR /repo

# ── Сборка всего монорепо ────────────────────────────────────────────────────
FROM base AS build
# Адреса рельефа и подложек вшиваются во фронт при сборке (Vite). Ключей здесь нет:
# Esri идёт через серверный прокси /api/v1/tiles/esri, ключ живёт только в API.
ARG VITE_TERRAIN_URL
ARG VITE_IMAGERY_WMTS_URL
ARG VITE_IMAGERY_WMTS_LAYER
ARG VITE_ESRI_TILE_URL
ENV VITE_TERRAIN_URL=$VITE_TERRAIN_URL \
    VITE_IMAGERY_WMTS_URL=$VITE_IMAGERY_WMTS_URL \
    VITE_IMAGERY_WMTS_LAYER=$VITE_IMAGERY_WMTS_LAYER \
    VITE_ESRI_TILE_URL=$VITE_ESRI_TILE_URL \
    TURBO_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build

# ── API и воркер: только прод-зависимости и собранный код ─────────────────────
FROM base AS server
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/packages/core/package.json packages/core/
COPY --from=build /repo/packages/parsing/package.json packages/parsing/
COPY --from=build /repo/packages/analysis/package.json packages/analysis/
COPY --from=build /repo/packages/track-format/package.json packages/track-format/
COPY --from=build /repo/packages/db/package.json packages/db/
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod --filter "@skyline/api..." --filter "@skyline/worker..."
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/packages/parsing/dist packages/parsing/dist
COPY --from=build /repo/packages/analysis/dist packages/analysis/dist
COPY --from=build /repo/packages/track-format/dist packages/track-format/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
# SQL-миграции: их накатывает apps/api/dist/migrate.js перед стартом API.
COPY --from=build /repo/packages/db/drizzle packages/db/drizzle
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/worker/dist apps/worker/dist
# Шрифт для подписей на превью полёта (задача 3.8): в alpine их нет, а librsvg без шрифта рисует пустоту.
RUN apk add --no-cache font-dejavu
USER node
CMD ["node", "apps/api/dist/server.js"]

# ── Фронт: статика + прокси /api в одном маленьком Caddy ─────────────────────
FROM caddy:2-alpine AS web
COPY infra/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
