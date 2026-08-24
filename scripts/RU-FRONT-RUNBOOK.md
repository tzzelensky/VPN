# Stream SNI on a VPN node

Админка и shop — [ACCESS-CHANNELS.md](ACCESS-CHANNELS.md). HTTP-фронт панели сюда **не** ставить.

Публичный DNS подписки (DuckDNS и т.п.) **не** вешать на stream-ноду — только на HTTP-фронт панели.

## Safety

- Do not put panel, bot, or `data.json` on a stream-only node.
- Do not bind Xray to public 443 if nginx stream SNI owns 443.
- Do not install a shop vhost or `proxy_pass` to the panel on a stream-only node.

Set `RU_HOST` before `deploy-ru-front.py` / `smoke-ru-front.py`. There is no default host.

## Example SNI map

```nginx
map $ssl_preread_server_name $vpn_sni_backend {
    www.cloudflare.com    127.0.0.1:8446;
    default               127.0.0.1:8443;
}
```

Trojan (или другой TLS) на `8446`, VLESS REALITY на `8443`. См. `ru-front-stream.conf.example`, `setup-ru-front.sh`.

## Чеклист новой купленной VPN-ноды

Перед выдачей клиентам:

1. **Не** ставить `setup-panel-front.sh` / shop на эту машину.
2. Поставить stream SNI на `:443` (`setup-ru-front.sh` или ручной `ru-front-stream.conf.example`).
3. Xray/sing-box: REALITY inbound на loopback `:8443`, Trojan (если нужен) на `:8446`.
4. С ноды проверить dest для REALITY (должен отвечать TLS):

```bash
openssl s_client -connect DEST:443 -servername DEST </dev/null 2>/dev/null | openssl x509 -noout -subject
```

Не оставлять дефолтный `www.microsoft.com` / `www.cloudflare.com`, если с этой сети dest не открывается или probe-палит пресет. Зафиксировать рабочий `server_name` / dest в настройках сервера в панели **до** деплоя клиентам.
5. Hysteria (UDP высокий порт) на новых нодах **не включать**, пока не нужен отдельно — отдельный fingerprint.
6. В панели: добавить Server → deploy → убедиться, что `/goods` для Happ отдаёт новый host.
7. Старую забаненную ноду выключить; ссылки `/goods/{token}` не менять.

## Ротация ноды без смены подписки

См. таблицу «Ротация купленного сервера» в [ACCESS-CHANNELS.md](ACCESS-CHANNELS.md).
