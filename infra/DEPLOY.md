# Деплой Skyline

Фаза 1 (ТЗ §11.4): один VPS, всё в docker compose. Сервер — hoster.kz, Казахстан
(закон РК о персданных: в IGC имена пилотов, файлы и база остаются в РК).
Сервер общий с проектом GateApp: 1 vCPU, 2 ГБ RAM + 2 ГБ swap.

| Что | Где |
|---|---|
| Адрес | https://skyline.gateapp.kz |
| Сервер | `root@89.207.254.250`, ключ `~/.ssh/skyline_deploy` |
| Каталог | `/root/projects/skyline` (`docker-compose.prod.yml`, `.env`) |
| HTTPS | Caddy проекта GateApp: блок `skyline.gateapp.kz` в `/root/projects/GateApp-Backend/Caddyfile` |
| Контейнеры | postgres, minio, api, worker, web (+ разовые migrate, minio-init); наружу портов нет |

## Как устроено

```
браузер ──https──▶ Caddy GateApp :443 ──▶ skyline-web:80 (сеть gateapp_default)
                                            ├─ /api/* ──▶ skyline-api:3000 ──▶ postgres, minio
                                            └─ статика фронта
                          worker ◀── NOTIFY ── api      (обработка треков)
```

Образы собираются локально (на сервере 1 vCPU и 2 ГБ — сборка фронта с Cesium
там не нужна) и передаются через `docker save | ssh docker load`.

## Первичная настройка сервера (один раз)

1. **Swap 2 ГБ** — страховка от нехватки памяти на общем сервере:
   ```sh
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   sysctl vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
   ```
2. **Каталог и секреты:**
   ```sh
   mkdir -p /root/projects/skyline && cd /root/projects/skyline
   # .env по образцу infra/prod.env.example; пароли: openssl rand -hex 24
   chmod 600 .env
   ```
3. **HTTPS через Caddy GateApp** — в конец `/root/projects/GateApp-Backend/Caddyfile`:
   ```
   # Skyline — отдельный compose-проект /root/projects/skyline
   skyline.gateapp.kz {
   	encode gzip
   	reverse_proxy skyline-web:80 {
   		flush_interval -1
   	}
   }
   ```
   Применить без простоя: `docker exec gateapp-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
   **Внести этот блок и в репозиторий GateApp**, иначе его следующий деплой затрёт правку.
4. **DNS:** A-запись `skyline.gateapp.kz → 89.207.254.250`. Сертификат Caddy выпустит сам.

## Выкладка (каждый релиз)

С машины разработчика, из корня репозитория, с `main`, где зелёный CI:

```sh
# 1. Образы. VITE_* вшиваются во фронт при сборке — значения из .env разработки.
ARGS="--build-arg VITE_TERRAIN_URL=https://terrain.reearth.land/cesium-mesh/ellipsoid \
  --build-arg VITE_IMAGERY_WMTS_URL='https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/WGS84/{TileMatrix}/{TileRow}/{TileCol}.jpg' \
  --build-arg VITE_IMAGERY_WMTS_LAYER=s2cloudless-2025 \
  --build-arg VITE_ESRI_TILE_URL='/api/v1/tiles/esri/{z}/{y}/{x}'"
docker build $ARGS --target server -t skyline-server:latest .
docker build $ARGS --target web -t skyline-web:latest .

# 2. На сервер (сжатие по пути; ~150 МБ).
docker save skyline-server:latest skyline-web:latest | gzip | \
  ssh -i ~/.ssh/skyline_deploy root@89.207.254.250 'gunzip | docker load'
scp -i ~/.ssh/skyline_deploy infra/docker-compose.prod.yml root@89.207.254.250:/root/projects/skyline/

# 3. Запуск: миграции идут сами (сервис migrate) до старта API и воркера.
ssh -i ~/.ssh/skyline_deploy root@89.207.254.250 \
  'cd /root/projects/skyline && docker compose -f docker-compose.prod.yml up -d --remove-orphans'
```

## Проверка

```sh
curl -s https://skyline.gateapp.kz/api/v1/health        # {"status":"ok",...}
curl -s https://skyline.gateapp.kz/api/v1/imagery       # {"esri":true}
ssh ... 'docker compose -f /root/projects/skyline/docker-compose.prod.yml ps'
ssh ... 'docker stats --no-stream'                      # память в пределах лимитов
```

Загрузить трек через https://skyline.gateapp.kz и открыть в просмотрщике.

## Логи, откат, бэкап

- Логи: `docker compose -f docker-compose.prod.yml logs -f api worker` (pino, JSON, с `flightId`).
- Откат: перед выкладкой пометить текущие образы `docker tag skyline-server:latest skyline-server:prev`
  (и web); при проблеме — `docker tag skyline-server:prev skyline-server:latest` и `up -d`.
  Миграции назад не откатываются — схема меняется только вперёд (CLAUDE.md).
- Бэкап базы: `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U skyline skyline | gzip > skyline-$(date +%F).sql.gz`.
  Файлы полётов — том `skyline_miniodata`. Автоматические бэкапы — отдельная задача.
