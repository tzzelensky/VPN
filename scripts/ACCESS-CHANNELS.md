# Два канала доступа (не смешивать)

Баны публичного IP лечат **разными** средствами. Карусель бесплатных IPv4 на два дня — не решение; купленный сервер ротируем по типу бана.

| Канал | Кто | Куда | Как держать доступ |
|-------|-----|------|-------------------|
| **A. Админка** | оператор | IP панели (или Tailscale) | Tailscale или Telegram WebApp (5 тапов). Не через публичный DNS подписки |
| **B. Подписка** | клиенты Happ + WebApp бота | публичный DNS → `/goods` `/mysub` | Купленный HTTP-фронт + A-запись. Парольный `/login` → 404; 5 тапов в WebApp → админка |

```
Оператор ──Tailscale/Telegram──► панель
Клиенты Happ ──публичный DNS──► фронт ──HTTPS──► панель
Клиенты VPN ───────────────────► IP нод из панели (REALITY/Trojan)
```

## Запреты

- Не менять выданные ссылки `/goods/{token}` — меняется только A-запись домена или IP нод в Servers.
- Не ставить shop/`proxy_pass` на VPN-stream `:443` (там SNI mux).
- Не светить парольный `/login` и `/api/auth/login` на публичном DNS — 404 на фронте. WebApp (`/mysub`) и 5 тапов (webapp-admin + `/servers`) нужны на том же домене.
- На фронте **нужны** `/mysub` + `/api/mysub` + `/assets` — иначе Telegram WebApp бота даёт 404.
- Не ждать, что маскировка спасёт один IP навсегда.

## Ротация купленного сервера

### Забанили HTTP-фронт / A-запись (Happ не обновляет конфиг)

1. Купить новый VPS (белый IPv4, 80/443).
2. Скопировать `setup-panel-front.sh` + `panel-front-nginx.conf.example`.
3. `PANEL_DOMAIN=sub.example.com PANEL_ORIGIN=https://PANEL_IP CERTBOT_EMAIL=... bash setup-panel-front.sh`
4. Обновить A-запись публичного DNS на IPv4 фронта (`PANEL_FRONT_IP`).
5. Smoke: Mozilla `/login` → **404**; Happ `/api/health` → `{"ok":true}`; Happ `/goods/{token}` → payload (не HTML); `/mysub` → 200.
6. Ссылки в приложениях **не** трогать.

### Забанили VPN-ноду (туннель не коннектится)

1. Купить новую машину → Servers в панели → deploy inbound.
2. На ноде: stream SNI по [RU-FRONT-RUNBOOK.md](RU-FRONT-RUNBOOK.md) (чеклист новой ноды).
3. Старую ноду выключить в панели.
4. Клиенты подтянут новые IP при следующем update (`profile-update-interval`). URL `/goods/...` тот же.

### Панель недоступна оператору

Tailscale / WebApp 5 тапов. Не связано с Happ.

## Скрипты

| Задача | Файл |
|--------|------|
| Tailscale на панели | [`install-tailscale-panel.sh`](install-tailscale-panel.sh) |
| HTTP-фронт | [`setup-panel-front.sh`](setup-panel-front.sh), [`panel-front-nginx.conf.example`](panel-front-nginx.conf.example) |
| Smoke маскировки | [`verify-https-mask.sh`](verify-https-mask.sh), [`verify-front-mask.sh`](verify-front-mask.sh) |
| Stream SNI на ноде | [`RU-FRONT-RUNBOOK.md`](RU-FRONT-RUNBOOK.md), [`setup-ru-front.sh`](setup-ru-front.sh) |
| Опционально: mask на самой панели | [`panel-public-mask-locations.inc.example`](panel-public-mask-locations.inc.example) |
