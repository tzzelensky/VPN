# Always-Free / купленный HTTP(S) фронт (канал B)

Панель остаётся на своём IP. Эта VM — reverse-proxy + Let’s Encrypt:
shop, `/goods`, WebApp `/mysub`, админка после 5 тапов. Парольный `/login` → 404.

Полный runbook ротации: [ACCESS-CHANNELS.md](ACCESS-CHANNELS.md).

## Oracle Cloud Always Free (кратко)

1. Зарегистрировать [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) (карта для проверки, Always Free не обязан стоить денег).
2. Compute → VM: Ubuntu 22.04/24.04, Always Free shape (Ampere A1 или VM.Standard.E2.1.Micro).
3. VNIC: assign public IPv4. Security list: ingress TCP 22, 80, 443.
4. Скопировать публичный IPv4 → `PANEL_FRONT_IP`.

Google Cloud e2-micro тоже подходит, но лимит **1 ГБ egress/мес** — для Happ-обновлений мало.

## На VM

Скопировать из репо `scripts/setup-panel-front.sh` и `scripts/panel-front-nginx.conf.example`, затем:

```bash
export PANEL_DOMAIN=sub.example.com
export PANEL_ORIGIN=https://PANEL_IP
export CERTBOT_EMAIL=your@email
bash setup-panel-front.sh
```

Сначала A-запись публичного DNS на IPv4 этой VM, потом certbot (скрипт сам вызовет, если задан `CERTBOT_EMAIL`).

## Проверка

```bash
curl -sk -m 15 -A "Happ/1.0" --resolve sub.example.com:443:PANEL_FRONT_IP https://sub.example.com/api/health
```

Ожидание: `{"ok":true}`.
