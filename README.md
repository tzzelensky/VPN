# Панель управления VPN

Веб-панель для управления VPN-серверами (VLESS/Reality, подписки, Telegram Mini App, прокси и т.д.).

Данные хранятся в **файлах JSON** на диске. Отдельные PostgreSQL / Redis / Docker **не нужны**.

---

## Что нужно заранее

1. **VPS** с **Ubuntu 22.04 или 24.04**
2. Доступ по **SSH** (логин `root` или пользователь с `sudo`)
3. Желательно **домен** (например `vpn.example.com`), у которого A-запись указывает на IP VPS  
   Без домена тоже можно — панель откроется по `http://IP`, но без нормального HTTPS (для Telegram-бота HTTPS почти обязателен)

---

## Быстрая установка (одна команда)

Подключитесь к серверу:

```bash
ssh root@ВАШ_IP
```

Запустите:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/install.sh)
```

С доменом сразу (удобнее):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/install.sh) -- vpn.example.com
```

Скрипт сам:

- поставит Node.js 20, Nginx, Certbot, firewall;
- создаст пользователя `vpnadm`;
- скачает код в `/opt/vpn-admin`;
- соберёт backend и frontend;
- настроит службу `vpn-admin-api` и сайт Nginx;
- по возможности получит HTTPS-сертификат;
- в конце покажет **ссылку**, **логин** и **пароль**.

Сохраните пароль — он также лежит в файле `/opt/vpn-admin/backend/.env`.

После установки откройте в браузере адрес, который вывел скрипт, и войдите в панель.

---

## Что делать после входа

1. Откройте раздел **Сервера**.
2. Добавьте свой VPN-узел (IP, SSH-логин и пароль/ключ).
3. Установите **Xray** кнопкой в карточке сервера и синхронизируйте клиентов.
4. Создайте пользователя/подписку в разделе **Пользователи**.

Панель **не** ставит Xray на сам «панельный» VPS автоматически при установке — Xray ставится на **рабочие VPN-ноды**, которые вы добавляете в UI.

---

## Обновление панели

На сервере от root (или через `sudo`):

```bash
cd /opt/vpn-admin
sudo -u vpnadm git pull origin main
sudo -u vpnadm bash -lc 'cd /opt/vpn-admin/backend && npm ci && npm run build'
sudo -u vpnadm bash -lc 'cd /opt/vpn-admin/frontend && npm ci && npm run build'
systemctl restart vpn-admin-api
```

Проверка:

```bash
curl -s http://127.0.0.1:4000/api/health
# ожидается: {"ok":true}
```

---

## Ручная установка (если one-liner не подходит)

Краткие шаги:

1. Ubuntu → пользователь `vpnadm`, UFW (22/80/443), Node 20, Nginx, Certbot.
2. Клон репозитория в `/opt/vpn-admin` (важно: в конец `git clone … .` — с точкой).
3. Скопировать `backend/.env.example` → `backend/.env`, заполнить секреты и URL.
4. `npm ci && npm run build` в `backend` и `frontend`.
5. systemd + Nginx (как в скрипте `scripts/server-root-once.sh`).
6. `certbot --nginx -d ваш.домен`.

Подробная пошаговая инструкция: **[DEPLOY.md](DEPLOY.md)**.

---

## Частые проблемы

| Проблема | Что проверить |
|----------|----------------|
| Сайт не открывается | DNS A-запись = IP VPS; `ufw status`; `systemctl status nginx` |
| 502 Bad Gateway | `systemctl status vpn-admin-api`; `journalctl -u vpn-admin-api -n 80 --no-pager` |
| Certbot не выдал сертификат | Домен ещё не указывает на этот IP — подождите DNS и повторите `certbot --nginx -d ДОМЕН` |
| Забыли пароль | Смотрите `ADMIN_PASSWORD=` в `/opt/vpn-admin/backend/.env`, затем `systemctl restart vpn-admin-api` |
| После клона нет папки `backend` | Клонировали без точки в конце — см. раздел в [DEPLOY.md](DEPLOY.md) |

---

## Безопасность (обязательно)

- Смените пароль админа после первого входа (или сразу в `.env`).
- Не публикуйте файл `/opt/vpn-admin/backend/.env`.
- Делайте бэкап каталога `/opt/vpn-admin/data/` (там вся база панели).
- Не открывайте в firewall лишние порты; API слушает `4000` только на localhost за Nginx.

---

## Полезные пути

| Путь | Назначение |
|------|------------|
| `/opt/vpn-admin` | Код панели |
| `/opt/vpn-admin/data/` | Данные (JSON) |
| `/opt/vpn-admin/backend/.env` | Секреты и настройки |
| `systemctl status vpn-admin-api` | Статус API |

---

## Лицензия / репозиторий

Исходники: [github.com/tzzelensky/VPN](https://github.com/tzzelensky/VPN)
