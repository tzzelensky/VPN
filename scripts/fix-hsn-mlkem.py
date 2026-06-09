#!/usr/bin/env python3
import json

path = "/etc/tzadmin-xray/config.json"
dec = "mlkem768x25519plus.native.600s.uMCLPhDIRkbaGMTLucqdAP4zDukvYu2mYpHU563xBUI"

with open(path, encoding="utf-8") as f:
    c = json.load(f)

for ib in c.get("inbounds", []):
    if ib.get("tag") != "tzadmin-vless":
        continue
    settings = ib.setdefault("settings", {})
    settings["decryption"] = dec
    for cl in settings.get("clients", []):
        cl.pop("flow", None)
    print(f"port={ib.get('port')} decryption={dec[:48]}… clients={len(settings.get('clients', []))}")

with open(path, "w", encoding="utf-8") as f:
    json.dump(c, f, indent=2)
print("ok")
