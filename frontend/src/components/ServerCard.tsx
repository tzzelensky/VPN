import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type SVGProps } from "react";
import { useNavigate } from "react-router-dom";
import {
  loadServerSubscriptionSettings,
  previewServerSubscriptionSettings,
  type ServerDto,
} from "../api";
import { COUNTRY_CODES_ALPHA2, countryCodeLabel } from "../countryCodes";
import { countryFlagEmoji } from "../flagEmoji";
import { useModalEscape } from "../hooks/useModalEscape";
import Spinner from "./Spinner";

export type ServerBusyAction =
  | "ssh"
  | "xray"
  | "vless"
  | "vlessSubs"
  | "hysteria2"
  | "hy2Subs"
  | "trojan"
  | "trojanSubs"
  | "save"
  | "addSubs"
  | "removeSubs"
  | null;

const SERVER_CARD_COLLAPSED_KEY = "vpn.serverCard.collapsed";

function readCollapsedIds(): number[] {
  try {
    const raw = localStorage.getItem(SERVER_CARD_COLLAPSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function readServerCardCollapsed(id: number): boolean {
  return readCollapsedIds().includes(id);
}

function writeServerCardCollapsed(id: number, collapsed: boolean): void {
  const set = new Set(readCollapsedIds());
  if (collapsed) set.add(id);
  else set.delete(id);
  localStorage.setItem(SERVER_CARD_COLLAPSED_KEY, JSON.stringify([...set]));
}

type Props = {
  server: ServerDto;
  index?: number;
  disabled: boolean;
  busyAction: ServerBusyAction;
  onSave: (name: string, countryCode: string) => Promise<void>;
  onOpenSubscriptionSettings: () => void;
  onTestSsh: () => void;
  onInstallXray: () => void;
  onDeployVless: () => void;
  onToggleVlessSubscriptions: () => void;
  onConnectHysteria2: () => void;
  onToggleHysteria2Subscriptions: () => void;
  onConnectTrojan: () => void;
  onToggleTrojanSubscriptions: () => void;
  onDelete: () => Promise<void>;
  onAddToAllSubscriptions?: () => void;
  onRemoveFromAllSubscriptions?: () => void;
  onNotify?: (type: "ok" | "err", text: string) => void;
};

type ChipItem = { label: string; value: string; title?: string };
type Tone = "ok" | "warn" | "bad" | "muted";

function IconGear(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconCopy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconTrash(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function IconMore(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden {...p}>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function displayOrNone(raw: string | undefined | null, emptyLabel = "не задано"): string {
  const v = String(raw ?? "").trim();
  if (!v || v === "—") return emptyLabel;
  return v;
}

function truncateMiddle(text: string, head = 8, tail = 4): string {
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function subscriptionChips(server: ServerDto): ChipItem[] {
  const sub = server.subscription_settings;
  const address =
    sub?.address_mode === "custom" && sub.address_override.trim()
      ? sub.address_override.trim()
      : server.host;
  const port = sub?.vless_port ?? server.sub_port ?? server.vless_port;
  const security = displayOrNone(sub?.security ?? server.sub_security, "none");
  const network = displayOrNone(sub?.network ?? server.sub_network, "none");
  const encRaw = (sub?.encryption ?? sub?.vless?.encrypt_value ?? "none").trim() || "none";
  const authMode = sub?.vless?.auth_mode ?? "";
  let encDisplay = "none";
  let encTitle = encRaw;
  if (encRaw.startsWith("mlkem") || authMode === "ml-kem-768") {
    encDisplay = "ML-KEM";
    encTitle = encRaw.length > 48 ? `${encRaw.slice(0, 24)}…${encRaw.slice(-12)}` : encRaw;
  } else if (authMode === "x25519") {
    encDisplay = "X25519";
    encTitle = encRaw !== "none" ? encRaw : "X25519";
  } else if (encRaw !== "none") {
    encDisplay = encRaw.length > 20 ? truncateMiddle(encRaw, 10, 6) : encRaw;
  }
  const flowRaw =
    sub?.flow?.trim() ||
    (encRaw.startsWith("mlkem") ? "" : security === "reality" && network === "tcp" ? "xtls-rprx-vision" : "");
  const flow = displayOrNone(flowRaw, "none");
  const fp = displayOrNone(sub?.reality?.fingerprint ?? server.sub_fp, "none");
  const sni = displayOrNone(sub?.reality?.server_name ?? server.sub_sni, "не задано");

  return [
    { label: "address", value: address },
    { label: "port", value: String(port) },
    { label: "security", value: security },
    { label: "network", value: network },
    { label: "flow", value: flow },
    { label: "uTLS", value: fp },
    { label: "SNI", value: sni, title: sni },
    { label: "encryption", value: encDisplay, title: encTitle },
  ];
}

function sshBadge(server: ServerDto): { tone: "ok" | "warn" | "bad"; text: string } {
  if (server.last_ssh_ok) return { tone: "ok", text: "SSH OK" };
  if (server.last_error) return { tone: "bad", text: "SSH error" };
  return { tone: "warn", text: "Не проверялся" };
}

function xrayBadge(server: ServerDto): { tone: Tone; text: string } {
  if (server.vless_deployed) return { tone: "ok", text: "Xray OK" };
  if (server.last_ssh_ok) return { tone: "warn", text: "Не установлен" };
  return { tone: "muted", text: "Xray ?" };
}

function CopyButton({
  copyKey,
  copiedKey,
  disabled,
  title,
  onCopy,
}: {
  copyKey: string;
  copiedKey: string | null;
  disabled?: boolean;
  title: string;
  onCopy: () => void;
}) {
  const done = copiedKey === copyKey;
  return (
    <button
      type="button"
      className={`server-card-v2__copy-btn ghost ${done ? "is-copied" : ""}`.trim()}
      disabled={disabled}
      onClick={onCopy}
      title={done ? "Скопировано" : title}
      aria-label={title}
    >
      {done ? "✓" : <IconCopy />}
    </button>
  );
}

function TechRow({
  label,
  value,
  displayValue,
  copyKey,
  copiedKey,
  onCopy,
  disabled,
}: {
  label: string;
  value: string;
  displayValue?: string;
  copyKey?: string;
  copiedKey?: string | null;
  onCopy?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="server-card-v2__tech-row">
      <span className="server-card-v2__tech-label">{label}</span>
      <span className="server-card-v2__tech-value mono" title={value}>
        {displayValue ?? value}
      </span>
      {onCopy && copyKey ? (
        <CopyButton
          copyKey={copyKey}
          copiedKey={copiedKey ?? null}
          disabled={disabled}
          title={`Копировать ${label}`}
          onCopy={onCopy}
        />
      ) : (
        <span className="server-card-v2__copy-spacer" aria-hidden />
      )}
    </div>
  );
}

function ProtocolPill({
  label,
  tone,
  inSub,
  title,
}: {
  label: string;
  tone: Tone;
  inSub?: boolean;
  title: string;
}) {
  return (
    <span
      className={`server-card-v2__pill server-card-v2__pill--${tone}${inSub ? " server-card-v2__pill--in-sub" : ""}`}
      title={title}
    >
      {label}
    </span>
  );
}

function ProtocolTile({
  name,
  tone,
  status,
  busy,
  disabled,
  primaryLabel,
  primaryKind,
  onPrimary,
  showSubToggle,
  subOn,
  subBusy,
  onToggleSub,
}: {
  name: string;
  tone: Tone;
  status: string;
  busy: boolean;
  disabled: boolean;
  primaryLabel: string;
  primaryKind: "ghost" | "primary";
  onPrimary: () => void;
  showSubToggle?: boolean;
  subOn?: boolean;
  subBusy?: boolean;
  onToggleSub?: () => void;
}) {
  return (
    <div className={`server-card-v2__tile${busy ? " is-busy" : ""}`}>
      <div className="server-card-v2__tile-head">
        <span className="server-card-v2__tile-name">{name}</span>
        <span className={`server-card-v2__tile-dot server-card-v2__tile-dot--${tone}`} aria-hidden />
      </div>
      <p className="server-card-v2__tile-status">{status}</p>
      <button type="button" className={primaryKind} disabled={disabled} onClick={onPrimary}>
        {busy && !subBusy ? (
          <>
            <Spinner /> {primaryLabel}
          </>
        ) : (
          primaryLabel
        )}
      </button>
      {showSubToggle ? (
        <label className="server-card-v2__tile-sub">
          <input
            type="checkbox"
            className="server-card-v2__tile-check"
            checked={Boolean(subOn)}
            disabled={disabled}
            onChange={onToggleSub}
          />
          <span>{subBusy ? "Сохраняем…" : "в подписке"}</span>
        </label>
      ) : (
        <span className="server-card-v2__tile-sub server-card-v2__tile-sub--placeholder" aria-hidden />
      )}
    </div>
  );
}

export default function ServerCard({
  server: s,
  index = 0,
  disabled,
  busyAction,
  onSave,
  onOpenSubscriptionSettings,
  onTestSsh,
  onInstallXray,
  onDeployVless,
  onToggleVlessSubscriptions,
  onConnectHysteria2,
  onToggleHysteria2Subscriptions,
  onConnectTrojan,
  onToggleTrojanSubscriptions,
  onDelete,
  onAddToAllSubscriptions,
  onRemoveFromAllSubscriptions,
  onNotify,
}: Props) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(s.name);
  const [cc, setCc] = useState(s.country_code || "");
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [jsonPreview, setJsonPreview] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => readServerCardCollapsed(s.id));

  useEffect(() => {
    setName(s.name);
    setCc(s.country_code || "");
  }, [s.id, s.updated_at, s.name, s.country_code]);

  useEffect(() => {
    setCollapsed(readServerCardCollapsed(s.id));
  }, [s.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);

  const dirty =
    name.trim() !== (s.name || "").trim() || (cc || "").toUpperCase() !== (s.country_code || "").toUpperCase();
  const previewFlag = countryFlagEmoji(cc) || s.country_flag || "🏳️";
  const displayName = (s.name || s.host).trim() || s.host;
  const configPath = s.xray_config_path?.trim() || "/etc/tzadmin-xray/config.json";
  const configShort = truncateMiddle(configPath, 28, 16);
  const vlessPort = s.sub_port ?? s.vless_port;
  const sshLine = `${s.ssh_user}@${s.host}:${s.ssh_port}`;
  const chips = subscriptionChips(s);
  const ssh = sshBadge(s);
  const xray = xrayBadge(s);
  const usersInSubs = (s.subscription_users_total ?? 0) > 0;
  const usersWithThisServer = Math.max(
    0,
    (s.subscription_users_total ?? 0) - (s.subscription_users_missing ?? 0),
  );
  const xrayInstalled = s.vless_deployed;
  const vlessTone: Tone = s.vless_deployed ? "ok" : "warn";
  const hy2Tone: Tone = s.hysteria2_deployed ? "ok" : "muted";
  const trojanTone: Tone = s.trojan_deployed ? "ok" : "muted";

  function flashCopied(key: string, okMsg: string) {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
    onNotify?.("ok", okMsg);
  }

  async function copyText(key: string, text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(key, okMsg);
    } catch (e) {
      onNotify?.("err", String(e));
    }
  }

  async function loadJsonPreview(openPanel = false) {
    setPreviewBusy(true);
    try {
      const { settings } = await loadServerSubscriptionSettings(s.id);
      const r = await previewServerSubscriptionSettings(s.id, settings);
      const text = JSON.stringify(r.json, null, 2);
      setJsonPreview(text);
      if (openPanel) setJsonOpen(true);
    } catch (e) {
      onNotify?.("err", String(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  function toggleMenu() {
    if (!menuOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuUp(window.innerHeight - rect.bottom < 260);
    }
    setMenuOpen((v) => !v);
  }

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave(name.trim() || s.host, cc);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDelete();
      setDeleteOpen(false);
      setMenuOpen(false);
      onNotify?.("ok", "Сервер удалён");
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  function openDeleteModal() {
    setMenuOpen(false);
    setDeleteError(null);
    setDeleteOpen(true);
  }

  function openLogs() {
    setMenuOpen(false);
    localStorage.setItem("xray_logs_server_id", String(s.id));
    localStorage.setItem("panel_logs_source", "xray");
    navigate(`/logs?source=xray&server=${s.id}`);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writeServerCardCollapsed(s.id, next);
      return next;
    });
  }

  function onHeaderClick(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
    toggleCollapsed();
  }

  const isBusy = disabled || saving || deleteBusy || previewBusy;
  const cardClass = [
    "server-card-v2",
    collapsed ? "server-card-v2--collapsed" : "",
    isBusy ? "server-card-v2--busy" : "",
    menuOpen ? "server-card-v2--menu-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <article className={cardClass} style={{ "--i": index } as CSSProperties}>
        <header className="server-card-v2__header" onClick={onHeaderClick}>
          <div className="server-card-v2__identity">
            <span className="server-card-v2__flag" title={cc ? countryCodeLabel(cc) : "Флаг не выбран"} aria-hidden>
              {previewFlag}
            </span>
            <div className="server-card-v2__title-block">
              <h3 className="server-card-v2__title">{displayName}</h3>
              <div className="server-card-v2__host-row">
                <span className="server-card-v2__host mono" title={sshLine}>
                  {sshLine}
                </span>
                <CopyButton
                  copyKey={`ssh-${s.id}`}
                  copiedKey={copiedKey}
                  disabled={isBusy}
                  title="Копировать SSH"
                  onCopy={() => void copyText(`ssh-${s.id}`, sshLine, "SSH скопирован")}
                />
              </div>
            </div>
          </div>

          <div className="server-card-v2__pills" aria-label="Статус протоколов">
            <ProtocolPill label="SSH" tone={ssh.tone} title={ssh.text} />
            <ProtocolPill label="Xray" tone={xray.tone} title={xray.text} />
            <ProtocolPill
              label="VLESS"
              tone={vlessTone}
              inSub={Boolean(s.vless_deployed && s.vless_in_subscriptions)}
              title={s.vless_deployed ? (s.vless_in_subscriptions ? "VLESS в подписке" : "VLESS развёрнут") : "VLESS не развёрнут"}
            />
            <ProtocolPill
              label="HY2"
              tone={hy2Tone}
              inSub={Boolean(s.hysteria2_deployed && s.hysteria2_in_subscriptions)}
              title={
                s.hysteria2_deployed
                  ? s.hysteria2_in_subscriptions
                    ? `HY2 :${s.hysteria2_port ?? "—"} в подписке`
                    : `HY2 :${s.hysteria2_port ?? "—"}`
                  : "HY2 выкл"
              }
            />
            <ProtocolPill
              label="Trojan"
              tone={trojanTone}
              inSub={Boolean(s.trojan_deployed && s.trojan_in_subscriptions)}
              title={
                s.trojan_deployed
                  ? s.trojan_in_subscriptions
                    ? `Trojan :${s.trojan_port ?? "—"} в подписке`
                    : `Trojan :${s.trojan_port ?? "—"}`
                  : "Trojan выкл"
              }
            />
          </div>

          <div className="server-card-v2__header-trailing">
            <span className="server-card-v2__clients" title="Клиенты с этим сервером в подписке">
              <strong>{usersWithThisServer}</strong>
              <span>кл.</span>
            </span>
            <div className="server-card-v2__more-wrap" ref={menuRef}>
              <button
                ref={moreBtnRef}
                type="button"
                className="ghost server-card-v2__more-btn"
                disabled={isBusy}
                aria-expanded={menuOpen}
                aria-label="Ещё действия"
                title="Ещё"
                onClick={toggleMenu}
              >
                <IconMore />
              </button>
              {menuOpen ? (
                <div
                  className={`server-card-v2__menu ${menuUp ? "server-card-v2__menu--up" : ""}`.trim()}
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void copyText(`menu-ssh-${s.id}`, sshLine, "SSH скопирован");
                    }}
                  >
                    Скопировать SSH
                  </button>
                  {s.vless_uuid ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void copyText(`menu-uuid-${s.id}`, s.vless_uuid!, "Server ID скопирован");
                      }}
                    >
                      Скопировать Server ID
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" onClick={openLogs}>
                    Открыть логи
                  </button>
                  <div className="server-card-v2__menu-divider" role="separator" aria-hidden />
                  <button
                    type="button"
                    role="menuitem"
                    className="server-card-v2__menu-danger"
                    disabled={isBusy}
                    onClick={openDeleteModal}
                  >
                    <IconTrash /> Удалить сервер
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="server-card-v2__collapse"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Развернуть карточку сервера" : "Свернуть карточку сервера"}
              title={collapsed ? "Развернуть" : "Свернуть"}
              onClick={toggleCollapsed}
            >
              <span className="server-card-v2__collapse-chevron" aria-hidden />
            </button>
          </div>
        </header>

        <div className="server-card-v2__reveal" aria-hidden={collapsed} {...(collapsed ? { inert: "" } : {})}>
          <div className="server-card-v2__reveal-inner">
            <div className="server-card-v2__main-grid">
              <section className="server-card-v2__section server-card-v2__section--main">
                <h4 className="server-card-v2__section-title">Основное</h4>
                <div className="server-card-v2__edit-row">
                  <span className="server-card-v2__edit-flag" aria-hidden>
                    {previewFlag}
                  </span>
                  <div className="server-card-v2__edit-fields">
                    <label className="server-card-v2__field">
                      <span className="server-card-v2__field-label">Название в подписке</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={s.host}
                        disabled={isBusy}
                      />
                    </label>
                    <label className="server-card-v2__field">
                      <span className="server-card-v2__field-label">Страна / флаг</span>
                      <select value={cc} onChange={(e) => setCc(e.target.value)} disabled={isBusy}>
                        <option value="">Без флага</option>
                        {COUNTRY_CODES_ALPHA2.map((code) => (
                          <option key={code} value={code}>
                            {countryFlagEmoji(code)} {countryCodeLabel(code)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="server-card-v2__edit-footer">
                  {dirty ? <span className="server-card-v2__dirty">Есть несохранённые изменения</span> : null}
                  <button
                    type="button"
                    className={dirty ? "primary" : "ghost"}
                    disabled={isBusy || !dirty || busyAction === "save"}
                    onClick={() => void handleSave()}
                  >
                    {saving || busyAction === "save" ? (
                      <>
                        <Spinner /> Сохранение…
                      </>
                    ) : (
                      "Сохранить имя и флаг"
                    )}
                  </button>
                </div>
              </section>

              <section className="server-card-v2__section server-card-v2__section--tech">
                <h4 className="server-card-v2__section-title">Техническая информация</h4>
                <div className="server-card-v2__tech">
                  <TechRow
                    label="SSH"
                    value={sshLine}
                    copyKey={`tech-ssh-${s.id}`}
                    copiedKey={copiedKey}
                    disabled={isBusy}
                    onCopy={() => void copyText(`tech-ssh-${s.id}`, sshLine, "SSH скопирован")}
                  />
                  <TechRow
                    label="VLESS"
                    value={`порт ${vlessPort} · ${s.vless_deployed ? "развёрнут" : "не развёрнут"}`}
                  />
                  {s.vless_uuid ? (
                    <TechRow
                      label="Server ID"
                      value={s.vless_uuid}
                      displayValue={truncateMiddle(s.vless_uuid, 8, 8)}
                      copyKey={`uuid-${s.id}`}
                      copiedKey={copiedKey}
                      disabled={isBusy}
                      onCopy={() => void copyText(`uuid-${s.id}`, s.vless_uuid!, "Server ID скопирован")}
                    />
                  ) : null}
                  <TechRow
                    label="Config"
                    value={configPath}
                    displayValue={configShort}
                    copyKey={`tech-cfg-${s.id}`}
                    copiedKey={copiedKey}
                    disabled={isBusy}
                    onCopy={() => void copyText(`tech-cfg-${s.id}`, configPath, "Config скопирован")}
                  />
                  <TechRow label="Обновлено" value={formatTs(s.updated_at)} />
                </div>
                {s.last_error ? <p className="server-card-v2__tech-error">{s.last_error}</p> : null}
              </section>

              <section className="server-card-v2__section server-card-v2__section--preview">
                <div className="server-card-v2__preview-intro">
                  <h4 className="server-card-v2__section-title server-card-v2__section-title--lg">В подписке</h4>
                  <p className="server-card-v2__preview-desc">
                    Эти параметры попадут в клиентский JSON/VLESS для этого сервера.
                  </p>
                </div>
                <div className="server-card-v2__preview-row">
                  <div className="server-card-v2__chips">
                    {chips.map((c) => (
                      <span key={c.label} className="server-card-v2__chip" title={c.title ?? `${c.label}: ${c.value}`}>
                        <span className="server-card-v2__chip-label">{c.label}</span>
                        <span className="server-card-v2__chip-value">{c.value}</span>
                      </span>
                    ))}
                  </div>
                  <div className="server-card-v2__preview-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={isBusy || previewBusy}
                      onClick={() => void loadJsonPreview(true)}
                    >
                      {previewBusy ? (
                        <>
                          <Spinner /> Загрузка…
                        </>
                      ) : (
                        "Предпросмотр JSON"
                      )}
                    </button>
                    <button
                      type="button"
                      className="primary server-card-v2__sub-link"
                      disabled={isBusy}
                      onClick={onOpenSubscriptionSettings}
                    >
                      <IconGear /> Настройка подписки
                    </button>
                  </div>
                </div>
                {jsonOpen && jsonPreview ? (
                  <details className="server-card-v2__json-preview" open>
                    <summary>JSON preview</summary>
                    <pre className="mono">{jsonPreview}</pre>
                  </details>
                ) : null}
              </section>

              <section className="server-card-v2__section server-card-v2__section--actions">
                <h4 className="server-card-v2__section-title">Протоколы</h4>
                <div className="server-card-v2__tiles">
                  <ProtocolTile
                    name="SSH"
                    tone={ssh.tone}
                    status={ssh.text}
                    busy={busyAction === "ssh"}
                    disabled={isBusy}
                    primaryKind="ghost"
                    primaryLabel={
                      busyAction === "ssh" ? "Проверяем…" : s.last_error && !s.last_ssh_ok ? "Повторить" : "Проверить"
                    }
                    onPrimary={onTestSsh}
                  />
                  <ProtocolTile
                    name="Xray"
                    tone={xray.tone}
                    status={xray.text}
                    busy={busyAction === "xray"}
                    disabled={isBusy}
                    primaryKind="ghost"
                    primaryLabel={
                      busyAction === "xray" ? "Устанавливаем…" : xrayInstalled ? "Переустановить" : "Установить"
                    }
                    onPrimary={onInstallXray}
                  />
                  <ProtocolTile
                    name="VLESS"
                    tone={vlessTone}
                    status={s.vless_deployed ? `порт ${vlessPort}` : "не развёрнут"}
                    busy={busyAction === "vless"}
                    disabled={isBusy}
                    primaryKind={s.vless_deployed ? "ghost" : "primary"}
                    primaryLabel={
                      busyAction === "vless"
                        ? s.vless_deployed
                          ? "Обновляем…"
                          : "Развертываем…"
                        : s.vless_deployed
                          ? "Обновить"
                          : "Развернуть"
                    }
                    onPrimary={onDeployVless}
                    showSubToggle={s.vless_deployed}
                    subOn={Boolean(s.vless_in_subscriptions)}
                    subBusy={busyAction === "vlessSubs"}
                    onToggleSub={onToggleVlessSubscriptions}
                  />
                  <ProtocolTile
                    name="Hysteria2"
                    tone={hy2Tone}
                    status={s.hysteria2_deployed ? `порт ${s.hysteria2_port ?? "—"}` : "выкл"}
                    busy={busyAction === "hysteria2"}
                    disabled={isBusy}
                    primaryKind={s.hysteria2_deployed ? "ghost" : "primary"}
                    primaryLabel={
                      busyAction === "hysteria2"
                        ? s.hysteria2_deployed
                          ? "Обновляем…"
                          : "Подключаем…"
                        : s.hysteria2_deployed
                          ? "Обновить"
                          : "Подключить"
                    }
                    onPrimary={onConnectHysteria2}
                    showSubToggle={Boolean(s.hysteria2_deployed)}
                    subOn={Boolean(s.hysteria2_in_subscriptions)}
                    subBusy={busyAction === "hy2Subs"}
                    onToggleSub={onToggleHysteria2Subscriptions}
                  />
                  <ProtocolTile
                    name="Trojan"
                    tone={trojanTone}
                    status={s.trojan_deployed ? `порт ${s.trojan_port ?? "—"}` : "выкл"}
                    busy={busyAction === "trojan"}
                    disabled={isBusy}
                    primaryKind={s.trojan_deployed ? "ghost" : "primary"}
                    primaryLabel={
                      busyAction === "trojan"
                        ? s.trojan_deployed
                          ? "Обновляем…"
                          : "Подключаем…"
                        : s.trojan_deployed
                          ? "Обновить"
                          : "Подключить"
                    }
                    onPrimary={onConnectTrojan}
                    showSubToggle={Boolean(s.trojan_deployed)}
                    subOn={Boolean(s.trojan_in_subscriptions)}
                    subBusy={busyAction === "trojanSubs"}
                    onToggleSub={onToggleTrojanSubscriptions}
                  />
                </div>
                {(onAddToAllSubscriptions &&
                  s.vless_deployed &&
                  s.subscription_users_missing != null &&
                  s.subscription_users_missing > 0) ||
                (onRemoveFromAllSubscriptions && s.vless_deployed && usersWithThisServer > 0) ? (
                  <div className="server-card-v2__bulk">
                    {onAddToAllSubscriptions &&
                    s.vless_deployed &&
                    s.subscription_users_missing != null &&
                    s.subscription_users_missing > 0 ? (
                      <button type="button" className="ghost" disabled={isBusy} onClick={onAddToAllSubscriptions}>
                        {busyAction === "addSubs" ? (
                          <>
                            <Spinner /> Добавляем…
                          </>
                        ) : (
                          `Во все подписки (${s.subscription_users_missing})`
                        )}
                      </button>
                    ) : null}
                    {onRemoveFromAllSubscriptions && s.vless_deployed && usersWithThisServer > 0 ? (
                      <button type="button" className="ghost" disabled={isBusy} onClick={onRemoveFromAllSubscriptions}>
                        {busyAction === "removeSubs" ? (
                          <>
                            <Spinner /> Убираем…
                          </>
                        ) : (
                          `Убрать из подписок (${usersWithThisServer})`
                        )}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </article>

      {deleteOpen ? (
        <ServerDeleteModal
          displayName={displayName}
          usersInSubs={usersInSubs}
          subscriptionUsersTotal={s.subscription_users_total ?? 0}
          deleteBusy={deleteBusy}
          deleteError={deleteError}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </>
  );
}

function ServerDeleteModal({
  displayName,
  usersInSubs,
  subscriptionUsersTotal,
  deleteBusy,
  deleteError,
  onCancel,
  onConfirm,
}: {
  displayName: string;
  usersInSubs: boolean;
  subscriptionUsersTotal: number;
  deleteBusy: boolean;
  deleteError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useModalEscape(() => {
    if (!deleteBusy) onCancel();
  }, true);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal server-card-v2__delete-modal" role="dialog">
        <div className="modal-head">
          <h2>Удалить сервер?</h2>
        </div>
        <div className="modal-body">
          <p>Вы действительно хотите удалить сервер «{displayName}» из панели?</p>
          <p className="muted server-card-v2__delete-note">
            Это действие уберёт сервер из панели. Перед удалением убедитесь, что сервер не используется в активных
            подписках.
          </p>
          {usersInSubs ? (
            <p className="server-card-v2__delete-warn">
              Сервер используется в активных подписках ({subscriptionUsersTotal} пользователей). Удаление может повлиять
              на пользователей.
            </p>
          ) : null}
          {deleteError ? <p className="server-card-v2__delete-error">Не удалось удалить сервер: {deleteError}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="ghost" disabled={deleteBusy} onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="danger" disabled={deleteBusy} onClick={onConfirm}>
            {deleteBusy ? (
              <>
                <Spinner /> Удаляем…
              </>
            ) : (
              "Удалить сервер"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
