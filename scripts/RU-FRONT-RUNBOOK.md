# RU subscription front — cutover / rollback

Domain: `devspace5.duckdns.org`  
Abroad (panel + bot + data): `82.25.58.214`  
RU front (nginx only): `93.115.203.23`

## Safety

- Until DuckDNS A-record changes, clients keep using abroad. Preparing RU does not affect them.
- `/sub/` and `/goods/` are proxied the same way to abroad.
- Never point RU `proxy_pass` at the public domain (DNS loop after cutover). Always use abroad IP.

## Cutover (when ready)

1. Smoke via RU IP still OK (Happ `/sub` + `/goods`).
2. In DuckDNS: set A for `devspace5` → `93.115.203.23`.
3. Wait TTL (often 1–5 min). Check: `nslookup devspace5.duckdns.org`.
4. Update subscription in Happ (same URL). Expect payload.
5. Leave abroad (`82.25.58.214`) running — required for proxy and for rollback.
6. After cutover, renew TLS on RU with certbot when DNS points here:
   `certbot --nginx -d devspace5.duckdns.org`

## Rollback

1. DuckDNS A → `82.25.58.214`.
2. Wait TTL; clients resolve abroad again.
3. Keep RU online as standby (do not destroy).

## Do not

- Move panel/DB/bot to RU.
- Change `PUBLIC_API_URL` or re-issue client links for this switch.
- Turn off abroad nginx/API while RU is in use.
