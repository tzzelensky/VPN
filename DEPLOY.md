# Развёртывание с нуля на пустом VPS (Ubuntu)

Пошаговая инструкция для **нового VPS** с **Ubuntu 22.04 или 24.04 LTS**: обновление системы, firewall, Node.js, Nginx, SSL, клонирование проекта, сборка, systemd, проверка.

Предполагается: у вас есть **домен** (например `vpn.example.com`), **A-запись** указывает на IP VPS. Без домена панель можно открыть по `http://IP`, но для Telegram-вебхука и нормальных подписок нужен **HTTPS + домен**.

---

## 0. Что у вас должно быть заранее

- IP VPS и доступ по SSH (логин `root` или пользователь с `sudo`).
- Домен и DNS: тип **A**, имя `@` или `vpn`, значение — **IP сервера** (TTL можно 300–600 сек).
- Репозиторий с кодом (Git URL) или архив проекта.

---

## 1. Первый вход и обновление системы

С локального ПК:

```bash
ssh root@ВАШ_IP
```

На сервере:

```bash
apt update && apt upgrade -y
```

При желании задайте часовой пояс:

```bash
timedatectl set-timezone Europe/Moscow
```

---

## 2. Пользователь для приложения (не под root)

Создаём пользователя `vpnadm`, в группу `www-data` (удобно для Nginx и файлов):

```bash
adduser --disabled-password --gecos "" vpnadm
usermod -aG www-data vpnadm
mkdir -p /home/vpnadm/.ssh
chmod 700 /home/vpnadm/.ssh
```

Чтобы заходить под `vpnadm` по ключу (с **локального** ПК):

```bash
# на своём ПК: скопировать содержимое ~/.ssh/id_ed25519.pub
# на сервере под root:
nano /home/vpnadm/.ssh/authorized_keys
# вставить одну строку с публичным ключом, сохранить
chown -R vpnadm:vpnadm /home/vpnadm/.ssh
chmod 600 /home/vpnadm/.ssh/authorized_keys
```

Дальше в инструкции команды с `sudo` выполняйте под пользователем с правами sudo, а проект — под `vpnadm`:

```bash
sudo usermod -aG sudo vpnadm
# выйти и зайти: ssh vpnadm@ВАШ_IP
```

---

## 3. Firewall (UFW)

Открываем только нужное: SSH, HTTP, HTTPS.

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

**Важно:** не включайте `ufw enable`, пока не разрешили SSH (`OpenSSH`), иначе можно потерять доступ.

---

## 4. Базовые пакеты, Git, Nginx, Certbot

```bash
sudo apt install -y git curl ca-certificates nginx certbot python3-certbot-nginx
```

---

## 5. Node.js 20 LTS

Через официальный скрипт NodeSource (пример для **Node 20**):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # должно быть v20.x
npm -v
```

---

## 6. Каталог проекта и клонирование

```bash
sudo mkdir -p /opt/vpn-admin
sudo chown vpnadm:www-data /opt/vpn-admin
sudo chmod 750 /opt/vpn-admin
cd /opt/vpn-admin
```

Клонирование (подставьте свой URL):

```bash
git clone https://github.com/ВАШ_АККАУНТ/VPN.git .
# или приватный репо — настройте SSH-ключ для github на сервере / используйте deploy token
```

**Важно:** в конце команды должна быть **точка** (`.`) — она кладёт файлы прямо в `/opt/vpn-admin`. Если написать только `git clone …/VPN.git` без точки, Git создаст папку **`/opt/vpn-admin/VPN/`**, и команды вроде `cp backend/.env.example` из `/opt/vpn-admin` выдадут *No such file or directory*.

Если вы уже клонировали без точки — один раз поднимите содержимое на уровень выше (из-под `root` или `vpnadm`):

```bash
cd /opt/vpn-admin
rsync -a ./VPN/ ./
rm -rf ./VPN
```

После этого снова `cd /opt/vpn-admin` — рядом должны появиться `backend/`, `frontend/`, `package.json`.

Если репозитория нет — залейте файлы через `scp`/`rsync` в `/opt/vpn-admin`.

Данные панели (отдельная папка):

```bash
mkdir -p /opt/vpn-admin/data
chmod 750 /opt/vpn-admin/data
```

---

## 7. Файл окружения `backend/.env`

```bash
cd /opt/vpn-admin
cp backend/.env.example backend/.env
nano backend/.env
```

Замените **все** плейсхолдеры. Пример для домена `vpn.example.com`:

```env
PORT=4000
DATA_PATH=/opt/vpn-admin/data/data.json

PUBLIC_API_URL=https://vpn.example.com
FRONTEND_ORIGIN=https://vpn.example.com

SESSION_SECRET=сгенерируйте-длинную-случайную-строку
APP_SECRET=ещё-одна-длинная-случайная-строка
ADMIN_USER=admin
ADMIN_PASSWORD=надёжный-пароль

COOKIE_SECURE=1
```

Сгенерировать случайные строки на сервере:

```bash
openssl rand -hex 32
```

Права на `.env` (только владелец читает):

```bash
chmod 600 /opt/vpn-admin/backend/.env
chown vpnadm:vpnadm /opt/vpn-admin/backend/.env
```

Telegram (опционально) — см. комментарии в `backend/.env.example`.

---

## 8. Сборка backend и frontend

Собирайте от имени **`vpnadm`**, как потом будет работать systemd (права на файлы совпадут с продом).

**Владелец каталога проекта.** Если вы когда-либо запускали **`npm install` / `npm ci` от `root`**, в `backend/node_modules` (и во `frontend`) файлы останутся с владельцем root — тогда у **`vpnadm`** при `npm ci` будет ошибка **`EACCES: permission denied, rmdir .../node_modules/.bin`**. Перед сборкой один раз выровняйте владельца на весь проект (подставьте свой путь, если клон в `VPN/`):

```bash
sudo chown -R vpnadm:vpnadm /opt/vpn-admin
```

Альтернатива: удалить только зависимости от root и поставить заново уже от `vpnadm`:

```bash
sudo rm -rf /opt/vpn-admin/backend/node_modules /opt/vpn-admin/frontend/node_modules
sudo chown -R vpnadm:vpnadm /opt/vpn-admin/backend /opt/vpn-admin/frontend
```

Сборка:

```bash
sudo -u vpnadm -H bash -lc 'cd /opt/vpn-admin/backend && npm ci && npm run build'
sudo -u vpnadm -H bash -lc 'cd /opt/vpn-admin/frontend && npm ci && npm run build'
```

После **`npm run build`** в логах не должно быть ошибок TypeScript. Если `tsc` упал — папки **`dist` не будет**, и сервис из раздела 9 выдаст `Cannot find module '.../dist/index.js'`.

**Обязательная проверка** (оба файла должны существовать):

```bash
test -f /opt/vpn-admin/backend/dist/index.js && echo "backend OK" || echo "backend: нет dist — повторите сборку и читайте вывод npm/tsc"
test -f /opt/vpn-admin/frontend/dist/index.html && echo "frontend OK" || echo "frontend: нет dist"
```

Только если обе проверки **OK**, выставьте владельца на артефакты и данные:

```bash
sudo chown -R vpnadm:www-data /opt/vpn-admin/backend/dist /opt/vpn-admin/frontend/dist /opt/vpn-admin/data
```

Если `chown` пишет *No such file or directory* для `dist` — сборка не создала каталог: снова `cd /opt/vpn-admin/backend`, `npm run build` и смотрите полный вывод (не должно быть красных строк от `tsc`).

---

## 9. Systemd: автозапуск API

**Перед этим шагом** должны быть готовы: каталог `/opt/vpn-admin` с проектом, файл `backend/.env`, сборка `npm run build` в `backend/` (есть папка `backend/dist`). Если проект лежит в `/opt/vpn-admin/VPN`, замените пути ниже на `/opt/vpn-admin/VPN/backend` и т.д.

### 9.1. Путь к Node

Systemd запускает сервис от имени `vpnadm`. Узнайте, где лежит `node` для этого пользователя:

```bash
sudo -u vpnadm -H bash -lc 'which node && node -v'
```

Часто на Ubuntu из пакета это **`/usr/bin/node`** — тогда блок `[Service]` ниже можно не менять. Если путь другой (например, из nvm) — в `ExecStart=` подставьте **полный путь** из вывода `which node`.

### 9.2. Создать unit-файл

Unit — это обычный текстовый файл в `/etc/systemd/system/`. Создайте его от **root** любым редактором, например:

```bash
sudo nano /etc/systemd/system/vpn-admin-api.service
```

Вставьте целиком (при необходимости поправьте `ExecStart=` на свой путь к `node`):

```ini
[Unit]
Description=Панель управления (API)
After=network.target

[Service]
Type=simple
User=vpnadm
Group=www-data
WorkingDirectory=/opt/vpn-admin/backend
EnvironmentFile=/opt/vpn-admin/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Сохраните файл: в **nano** — `Ctrl+O`, Enter, затем `Ctrl+X`.

Проверка синтаксиса (опционально):

```bash
sudo systemd-analyze verify vpn-admin-api.service
```

### 9.3. Включить сервис и проверить

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vpn-admin-api
sudo systemctl status vpn-admin-api
curl -s http://127.0.0.1:4000/api/health
```

Ожидается ответ: `{"ok":true}`. Если **failed** или **activating**:

```bash
journalctl -u vpn-admin-api -n 80 --no-pager
```

Типичные причины: неверный `WorkingDirectory`, нет `backend/dist`, нет `backend/.env`, в `ExecStart` не тот путь к `node`, в `.env` ошибка (порт занят, неверный `DATA_PATH`).

**Ошибка `Cannot find module '.../dist/index.js'` или `MODULE_NOT_FOUND`:** сервис стартует раньше, чем появился скомпилированный код. Остановите цикл перезапусков, соберите backend, проверьте файл, снова включите сервис:

```bash
sudo systemctl stop vpn-admin-api
sudo -u vpnadm -H bash -lc 'cd /opt/vpn-admin/backend && npm ci && npm run build'
ls -la /opt/vpn-admin/backend/dist/index.js
sudo chown -R vpnadm:www-data /opt/vpn-admin/backend/dist
sudo systemctl start vpn-admin-api
curl -s http://127.0.0.1:4000/api/health
```

После правок в `.service` снова выполните `sudo systemctl daemon-reload` и `sudo systemctl restart vpn-admin-api`.

---

## 10. Nginx: статика + прокси на Node

Сначала **только HTTP (порт 80)** — так проще получить сертификат Let’s Encrypt.

Создайте `/etc/nginx/sites-available/vpn-admin` (замените `vpn.example.com`):

```nginx
server {
    listen 80;
    server_name vpn.example.com;

    root /opt/vpn-admin/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /panel/swagger/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /sub/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /comfort {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Включите сайт и отключите дефолтный «заглушку», если мешает:

```bash
sudo ln -sf /etc/nginx/sites-available/vpn-admin /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Проверьте в браузере: `http://vpn.example.com` — должна открыться панель (логин/пароль из `.env`). Подписка: `http://vpn.example.com/sub/ТОКЕН` (токен из карточки клиента).

---

## 11. HTTPS (Let’s Encrypt)

Когда **DNS уже** указывает на этот VPS:

```bash
sudo certbot --nginx -d vpn.example.com
```

Следуйте подсказкам (email, согласие с ToS). Certbot допишет в конфиг **SSL** и редирект с HTTP на HTTPS.

Снова проверьте:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Откройте `https://vpn.example.com`. В `.env` должны быть **`PUBLIC_API_URL`** и **`FRONTEND_ORIGIN`** с `https://...`, **`COOKIE_SECURE=1`**, затем:

```bash
sudo systemctl restart vpn-admin-api
```

---

## 12. После установки в самой панели

1. **Серверы** — добавьте VPN-узлы (SSH), при необходимости установите Xray и задеплойте VLESS.
2. **Клиенты** — нажмите **«Обновление»** в списке и при необходимости **синхронизацию UUID** в строке клиента, чтобы на узлы ушёл конфиг со **stats** и **StatsService** (трафик/онлайн с узлов).
3. **Бэкап** — копируйте файл из `DATA_PATH` (все пользователи и настройки).

---

## 13. Обновление кода на сервере

```bash
cd /opt/vpn-admin
sudo -u vpnadm git pull
cd backend && sudo -u vpnadm npm ci && sudo -u vpnadm npm run build
cd ../frontend && sudo -u vpnadm npm ci && sudo -u vpnadm npm run build
sudo systemctl restart vpn-admin-api
sudo systemctl reload nginx
```

### 13.1. Пересборка без обрыва SSH (`tsc` / `npm` долгие)

Если сессия падает во время `npm run build`, соберите проект в фоне от root:

```bash
cd /home/vpnadm/vpn-admin-app
chmod +x scripts/vpn-rebuild-api-nohup.sh
nohup bash scripts/vpn-rebuild-api-nohup.sh >/dev/null 2>&1 &
tail -f /root/vpn-rebuild-api.log
```

В конце скрипт сам делает `systemctl restart vpn-admin-api` и проверяет `/api/health`.

---

## Вариант без домена (только по IP)

- В Nginx в `server_name` укажите IP или `_`.
- Сертификат Let’s Encrypt **на чистый IP** обычно не выдают — останется HTTP.
- В `.env`: `PUBLIC_API_URL=http://ВАШ_IP`, `FRONTEND_ORIGIN=http://ВАШ_IP`, **`COOKIE_SECURE` не ставьте или `0`**.
- Вебхук Telegram на такой URL **не подойдёт**; для бота используйте `TELEGRAM_POLLING=1` или позже повесьте домен.

---

## Если что-то не работает

| Симптом | Куда смотреть |
|--------|----------------|
| **`Connection refused` на `127.0.0.1:4000`** | Сервис остановлен: `systemctl status vpn-admin-api`, затем `systemctl start vpn-admin-api` (или `enable --now`). После деплоя убедитесь, что никто не выполнил `systemctl stop`. |
| **`inactive (dead)` после сборки** | Запустите API снова; для фоновой сборки без обрыва SSH см. `scripts/vpn-rebuild-api-nohup.sh`. |
| API не стартует | `journalctl -u vpn-admin-api -f` |
| 502 от Nginx | `systemctl status vpn-admin-api`, `curl http://127.0.0.1:4000/api/health` |
| Белый экран / 404 на фронте | Путь `root` в Nginx, наличие `frontend/dist`, `try_files` для SPA |
| Не логинится в панель | `COOKIE_SECURE` и HTTPS, `FRONTEND_ORIGIN` совпадает с URL в браузере |
| Логи Nginx | `/var/log/nginx/error.log` |

---

## Git: как залить проект на GitHub и пушить изменения

Работайте из **корня репозитория** (папка `VPN`, где лежат `backend/`, `frontend/`, `.gitignore`).

### Один раз: репозиторий на GitHub

1. На [github.com](https://github.com) создайте **новый репозиторий** (без README, если уже есть локальный код).
2. На своём ПК в папке проекта:

```bash
cd c:\git_clone\VPN
git status
```

Если Git ещё не инициализирован:

```bash
git init
git branch -M main
```

Привяжите удалённый репозиторий (подставьте свой логин и имя репо):

```bash
git remote add origin https://github.com/ВАШ_ЛОГИН/VPN.git
```

Или по **SSH** (удобнее без пароля, если настроен ключ):

```bash
git remote add origin git@github.com:ВАШ_ЛОГИН/VPN.git
```

**Не коммитьте секреты:** в `.gitignore` уже указаны `backend/data.json`, `.env`, `node_modules`, `dist`. Файл **`backend/.env`** с паролями и токенами в Git класть нельзя — держите его только локально и на сервере.

Первый коммит и отправка:

```bash
git add .
git status
git commit -m "Первый коммит: VPN admin"
git push -u origin main
```

Если GitHub просит логин при HTTPS: используйте **Personal Access Token** вместо пароля ([настройка токена](https://github.com/settings/tokens)) или перейдите на remote по SSH.

### Обычная работа: после правок в коде

```bash
cd c:\git_clone\VPN
git status
git add -A
git commit -m "Кратко: что изменили"
git push
```

Если ветка ещё не привязана: `git push -u origin main` (один раз).

### Полезно

- **`git pull`** — подтянуть чужие изменения с сервера, перед своим `push`.
- **`git log -3 --oneline`** — последние коммиты.
- Конфликт при `pull`: Git подскажет файлы — правите вручную, затем `git add` и `git commit`.

На VPS после `git push` на сервере выполняют **`git pull`** (см. раздел **13. Обновление кода на сервере** выше).

---

Краткая схема: **браузер → Nginx (443) → статика из `frontend/dist`**, запросы **`/api`**, **`/sub`**, **`/comfort` → Node на `127.0.0.1:4000`**.
