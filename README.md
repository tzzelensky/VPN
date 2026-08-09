# Панель управления VPN

Веб-панель для управления VPN-серверами (VLESS/Reality, подписки, Telegram Mini App, прокси и т.д.).

Данные хранятся в **файлах JSON** на диске. Отдельные PostgreSQL / Redis / Docker **не нужны**.

---

## Что нужно заранее

1. **VPS** с **Ubuntu 22.04 / 24.04** или **Debian 12**
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

После установки откройте в браузере адрес, который вывел скрипт, и войдите **логином и паролем** (двухфакторка через Telegram по умолчанию **выключена**).

Если ставили сразу после удаления и видите `getcwd` / `uv_cwd` — вы остались в удалённом каталоге. Сделайте:

```bash
cd /
bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/install.sh) -- ваш.домен
```

---

## Полное удаление

С сервера от root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/uninstall.sh)
```

Без подтверждения:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/uninstall.sh) -- --force
```

Удаляются сервис, Nginx-сайт, `/opt/vpn-admin` (и связанные пути), пользователь `vpnadm` и сертификат панели. Node.js / Nginx / UFW как пакеты **не** снимаются.

---

## Что делать после входа

1. Откройте раздел **Сервера**.
2. Добавьте свой VPN-узел (IP, SSH-логин и пароль/ключ).
3. Установите **Xray** кнопкой в карточке сервера и синхронизируйте клиентов.
4. Создайте пользователя/подписку в разделе **Пользователи**.

Панель **не** ставит Xray на сам «панельный» VPS автоматически при установке — Xray ставится на **рабочие VPN-ноды**, которые вы добавляете в UI.

В **Настройки → Система** можно сменить пароль админа. В **Настройки → Бот** — включить 2FA через Telegram после настройки бота.

---

## Обновление панели

### Из интерфейса

**Настройки → Система → «Проверить наличие обновлений».** Если есть новые коммиты — **«Обновить сейчас»** (git pull + сборка + рестарт API).

### Вручную

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

1. Ubuntu/Debian → пользователь `vpnadm`, UFW (22/80/443), Node 20, Nginx, Certbot.
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
| Забыли пароль | Смотрите `ADMIN_PASSWORD=` в `/opt/vpn-admin/backend/.env`, затем `systemctl restart vpn-admin-api`. Или смените в **Настройки → Система** |
| Код в Telegram / 2FA | По умолчанию 2FA выключена. Включается в **Настройки → Бот** после токена бота |
| Сразу выкидывает после входа (`unauthorized`) | Часто `COOKIE_SECURE=1` при открытии по `http://`. В `.env` поставьте `COOKIE_SECURE=0` или `auto`, `systemctl restart vpn-admin-api`. Открывайте тот URL, что показал install (после certbot — `https://`) |
| HTTPS / SSL handshake error | Переустановите или: `certbot certonly --webroot -w /var/www/certbot -d ДОМЕН` и обновите nginx из свежего `install.sh` |
| После клона нет папки `backend` | Клонировали без точки в конце — см. раздел в [DEPLOY.md](DEPLOY.md) |

---

## Безопасность (обязательно)

- Смените пароль админа после первого входа (в UI или в `.env`).
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
