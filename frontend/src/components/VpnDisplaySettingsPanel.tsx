import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listServers,
  listUsers,
  loadConfigVault,
  loadWhitelistVault,
  patchUser,
  type ConfigVaultKeyDto,
  type ServerDto,
  type UserDto,
  type WhitelistVaultKeyDto,
} from "../api";
import { PANEL_HINTS } from "../panelSettingsHints";
import { SettingHint } from "./SettingHint";
import VpnServerOrderList, { type VpnDisplayItem, type VpnDisplayKind } from "./VpnServerOrderList";

function makeKey(kind: VpnDisplayKind, id: number): string {
  return `${kind}:${id}`;
}

function parseKey(raw: string): { kind: VpnDisplayKind; id: number } | null {
  const m = /^(vless|hy2|vault|whitelist):(\d+)$/.exec(raw.trim());
  if (!m) return null;
  return { kind: m[1] as VpnDisplayKind, id: Number(m[2]) };
}

function buildCatalog(opts: {
  servers: ServerDto[];
  vaultKeys: ConfigVaultKeyDto[];
  wlKeys: WhitelistVaultKeyDto[];
  serverIds?: number[] | null;
  vaultIds?: number[] | null;
  wlIds?: number[] | null;
}): VpnDisplayItem[] {
  const items: VpnDisplayItem[] = [];
  const serverFilter = opts.serverIds ? new Set(opts.serverIds) : null;
  const vaultFilter = opts.vaultIds ? new Set(opts.vaultIds) : null;
  const wlFilter = opts.wlIds ? new Set(opts.wlIds) : null;

  for (const s of opts.servers.filter((x) => x.vless_deployed)) {
    if (serverFilter && !serverFilter.has(s.id)) continue;
    items.push({
      key: makeKey("vless", s.id),
      kind: "vless",
      id: s.id,
      title: s.name || `Сервер #${s.id}`,
      subtitle: `${s.host}:${s.vless_port || 443}`,
      badge: "VLESS",
      flag: s.country_flag || undefined,
    });
    if (s.hysteria2_deployed && s.hysteria2_in_subscriptions) {
      items.push({
        key: makeKey("hy2", s.id),
        kind: "hy2",
        id: s.id,
        title: s.name || `Сервер #${s.id}`,
        subtitle: `${s.host}:${s.hysteria2_port || 36712}`,
        badge: "HY2",
        flag: s.country_flag || undefined,
      });
    }
  }

  for (const k of opts.vaultKeys) {
    if (!k.active || !k.added_to_subscriptions) continue;
    if (vaultFilter && !vaultFilter.has(k.id)) continue;
    items.push({
      key: makeKey("vault", k.id),
      kind: "vault",
      id: k.id,
      title: k.name,
      subtitle: k.masked_uri || "конфиг",
      badge: "Конфиг",
    });
  }

  for (const k of opts.wlKeys) {
    if (!k.active || k.removed_from_subscriptions) continue;
    if (wlFilter && !wlFilter.has(k.id)) continue;
    items.push({
      key: makeKey("whitelist", k.id),
      kind: "whitelist",
      id: k.id,
      title: k.name,
      subtitle: k.masked_uri || "белый список",
      badge: "БС",
    });
  }

  return items;
}

function orderItems(catalog: VpnDisplayItem[], order: string[]): VpnDisplayItem[] {
  const byKey = new Map(catalog.map((x) => [x.key, x]));
  const seen = new Set<string>();
  const out: VpnDisplayItem[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  for (const item of catalog) {
    if (seen.has(item.key)) continue;
    out.push(item);
  }
  return out;
}

function reorderKeys(keys: string[], fromKey: string, toKey: string): string[] {
  if (fromKey === toKey) return keys;
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  if (from < 0 || to < 0) return keys;
  const next = [...keys];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function userLabel(u: UserDto): string {
  const name = u.name?.trim() || "Без имени";
  const tg = u.tg_id?.trim();
  return tg ? `${name} · tg ${tg}` : `${name} · #${u.id}`;
}

function vaultIdsForUser(user: UserDto, keys: ConfigVaultKeyDto[]): number[] {
  return keys
    .filter((k) => {
      if (!k.active || !k.added_to_subscriptions) return false;
      if (k.subscription_mode === "all") return true;
      return (k.subscription_user_ids ?? []).includes(user.id);
    })
    .map((k) => k.id);
}

function wlIdsForUser(user: UserDto, keys: WhitelistVaultKeyDto[]): number[] {
  // Показываем активные ключи БС, если у пользователя включены БС или есть ручное назначение.
  const hasGrant = user.whitelist_happ_enabled || user.whitelist_purchased;
  const assigned = keys.filter(
    (k) => k.active && !k.removed_from_subscriptions && (k.assigned_user_ids ?? []).includes(user.id),
  );
  if (hasGrant) {
    return keys.filter((k) => k.active && !k.removed_from_subscriptions).map((k) => k.id);
  }
  return assigned.map((k) => k.id);
}

export default function VpnDisplaySettingsPanel({
  entryOrder,
  onEntryOrderChange,
}: {
  entryOrder: string[];
  onEntryOrderChange: (keys: string[]) => void;
}) {
  const [mode, setMode] = useState<"global" | "user">("global");
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [vaultKeys, setVaultKeys] = useState<ConfigVaultKeyDto[]>([]);
  const [wlKeys, setWlKeys] = useState<WhitelistVaultKeyDto[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const [userSaveBusy, setUserSaveBusy] = useState(false);
  const [userMsg, setUserMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([listServers(), listUsers(), loadConfigVault(), loadWhitelistVault()])
      .then(([s, u, vault, wl]) => {
        if (cancelled) return;
        setServers(s);
        setUsers(u);
        setVaultKeys(vault.keys ?? []);
        setWlKeys(wl.keys ?? []);
        setLoadErr(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const globalCatalog = useMemo(
    () => buildCatalog({ servers, vaultKeys, wlKeys }),
    [servers, vaultKeys, wlKeys],
  );
  const globalOrdered = useMemo(() => orderItems(globalCatalog, entryOrder), [globalCatalog, entryOrder]);

  const selectedUser = useMemo(
    () => (selectedUserId == null ? null : users.find((u) => u.id === selectedUserId) ?? null),
    [selectedUserId, users],
  );

  const userCatalog = useMemo(() => {
    if (!selectedUser) return [];
    return buildCatalog({
      servers,
      vaultKeys,
      wlKeys,
      serverIds: selectedUser.subscription_server_ids ?? [],
      vaultIds: vaultIdsForUser(selectedUser, vaultKeys),
      wlIds: wlIdsForUser(selectedUser, wlKeys),
    });
  }, [selectedUser, servers, vaultKeys, wlKeys]);

  const userOrdered = useMemo(() => orderItems(userCatalog, userOrder), [userCatalog, userOrder]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users.slice(0, 40);
    return users
      .filter((u) => `${u.name} ${u.tg_id} ${u.id} ${u.email}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [users, userQuery]);

  useEffect(() => {
    if (!selectedUser) {
      setUserOrder([]);
      return;
    }
    const catalog = buildCatalog({
      servers,
      vaultKeys,
      wlKeys,
      serverIds: selectedUser.subscription_server_ids ?? [],
      vaultIds: vaultIdsForUser(selectedUser, vaultKeys),
      wlIds: wlIdsForUser(selectedUser, wlKeys),
    });
    const custom = selectedUser.subscription_entry_order ?? [];
    setUserOrder(orderItems(catalog, custom.length ? custom : entryOrder).map((x) => x.key));
    setUserMsg(null);
  }, [selectedUser, servers, vaultKeys, wlKeys, entryOrder]);

  const syncGlobal = useCallback(
    (ordered: VpnDisplayItem[]) => {
      onEntryOrderChange(ordered.map((x) => x.key));
    },
    [onEntryOrderChange],
  );

  async function persistUserOrder(nextKeys: string[]) {
    if (!selectedUser) return;
    setUserSaveBusy(true);
    setUserMsg(null);
    try {
      const vlessIds = nextKeys
        .map(parseKey)
        .filter((p): p is { kind: VpnDisplayKind; id: number } => p?.kind === "vless")
        .map((p) => p.id);
      const r = await patchUser(selectedUser.id, {
        subscription_entry_order: nextKeys,
        subscription_server_ids: vlessIds.length ? vlessIds : selectedUser.subscription_server_ids,
      });
      setUsers((prev) => prev.map((u) => (u.id === r.user.id ? r.user : u)));
      setUserOrder(r.user.subscription_entry_order ?? nextKeys);
      setUserMsg({ type: "ok", text: "Порядок пользователя сохранён." });
    } catch (e) {
      setUserMsg({ type: "err", text: String(e) });
    } finally {
      setUserSaveBusy(false);
    }
  }

  function onDropGlobal(targetKey: string) {
    if (!dragKey) return;
    const keys = globalOrdered.map((x) => x.key);
    const next = reorderKeys(keys, dragKey, targetKey);
    syncGlobal(orderItems(globalCatalog, next));
    setDragKey(null);
    setOverKey(null);
  }

  function onDropUser(targetKey: string) {
    if (!dragKey) return;
    const next = reorderKeys(userOrder, dragKey, targetKey);
    setUserOrder(next);
    setDragKey(null);
    setOverKey(null);
    void persistUserOrder(next);
  }

  return (
    <div className="vpn-display-panel">
      <p className="field-hint">{PANEL_HINTS.vpnDisplayIntro}</p>

      <div className="vpn-display-mode" role="tablist" aria-label="Режим порядка">
        <button
          type="button"
          role="tab"
          className={`vpn-display-mode-btn${mode === "global" ? " active" : ""}`}
          aria-selected={mode === "global"}
          onClick={() => setMode("global")}
        >
          Общая
        </button>
        <button
          type="button"
          role="tab"
          className={`vpn-display-mode-btn${mode === "user" ? " active" : ""}`}
          aria-selected={mode === "user"}
          onClick={() => setMode("user")}
        >
          Пользователь
        </button>
      </div>

      {loading ? <p className="muted">Загрузка…</p> : null}
      {loadErr ? <div className="flash err">{loadErr}</div> : null}

      {!loading && !loadErr && mode === "global" ? (
        <>
          <SettingHint text={PANEL_HINTS.vpnDisplayGlobal} />
          <VpnServerOrderList
            items={globalOrdered}
            dragKey={dragKey}
            overKey={overKey}
            onDragStart={setDragKey}
            onDragEnd={() => {
              setDragKey(null);
              setOverKey(null);
            }}
            onDragOver={setOverKey}
            onDragLeave={(key) => {
              if (overKey === key) setOverKey(null);
            }}
            onDrop={onDropGlobal}
          />
        </>
      ) : null}

      {!loading && !loadErr && mode === "user" ? (
        <div className="vpn-display-user-block">
          <SettingHint text={PANEL_HINTS.vpnDisplayUser} />
          <label className="form-field">
            <span className="field-label">Поиск пользователя</span>
            <input
              className="input"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Имя, Telegram ID или #id"
            />
          </label>
          <div className="vpn-display-user-picker" role="listbox" aria-label="Пользователи">
            {filteredUsers.length === 0 ? (
              <p className="muted vpn-display-empty">Никого не найдено.</p>
            ) : (
              filteredUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={selectedUserId === u.id}
                  className={`vpn-display-user-option${selectedUserId === u.id ? " active" : ""}`}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <span className="vpn-display-user-option-name">{userLabel(u)}</span>
                  <span className="vpn-display-user-option-meta">
                    {(u.subscription_server_ids ?? []).length} серв.
                  </span>
                </button>
              ))
            )}
          </div>

          {selectedUser ? (
            <>
              <div className="vpn-display-user-head">
                <strong>{userLabel(selectedUser)}</strong>
                {userSaveBusy ? <span className="muted">Сохранение…</span> : null}
              </div>
              {userMsg ? (
                <div className={`flash ${userMsg.type === "ok" ? "ok" : "err"}`}>{userMsg.text}</div>
              ) : null}
              <VpnServerOrderList
                items={userOrdered}
                dragKey={dragKey}
                overKey={overKey}
                onDragStart={setDragKey}
                onDragEnd={() => {
                  setDragKey(null);
                  setOverKey(null);
                }}
                onDragOver={setOverKey}
                onDragLeave={(key) => {
                  if (overKey === key) setOverKey(null);
                }}
                onDrop={onDropUser}
                emptyText="У пользователя нет элементов в подписке."
              />
            </>
          ) : (
            <p className="muted vpn-display-empty">Выберите пользователя, чтобы изменить его порядок.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
