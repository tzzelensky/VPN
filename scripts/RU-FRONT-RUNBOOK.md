# RU VPN node vs NLHSN panel

Domain: `devspace5.duckdns.org`  
NLHSN (panel + bot + data): `82.25.58.78`  
RU VPN node: `138.124.180.18`

DuckDNS A-record points at **NLHSN**. Shop, `/sub`, `/goods` and the admin UI are served on the panel. RU is VPN only (VLESS / Trojan / HY2). No reverse-proxy and no HTTP redirect on RU.

## Safety

- Do not put panel, bot, or `data.json` on RU.
- Do not bind Xray to public 443 on RU: nginx stream SNI owns 443 (Trojan vs VLESS).
- Do not install a shop vhost or `proxy_pass` to the panel on RU.

## Current SNI map on RU

```nginx
map $ssl_preread_server_name $vpn_sni_backend {
    www.cloudflare.com    127.0.0.1:8446;
    default               127.0.0.1:8443;
}
```
