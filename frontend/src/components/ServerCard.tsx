import { useEffect, useRef, useState, type SVGProps } from "react";
import { useNavigate } from "react-router-dom";
import {
  loadServerSubscriptionSettings,
  previewServerSubscriptionSettings,
  type ServerDto,
} from "../api";
import { COUNTRY_CODES_ALPHA2, countryCodeLabel } from "../countryCodes";
import { countryFlagEmoji } from "../flagEmoji";
import Spinner from "./Spinner";

export type ServerBusyAction = "ssh" | "xray" | "vless" | "save" | "addSubs" | "removeSubs" | null;

type Props = {
  server: ServerDto;
  disabled: boolean;
  busyAction: ServerBusyAction;
  onSave: (name: string, countryCode: string) => Promise<void>;
  onOpenSubscriptionSettings: () => void;
  onTestSsh: () => void;
  onInstallXray: () => void;
  onDeployVless: () => void;
  onDelete: () => Promise<void>;
  onAddToAllSubscriptions?: () => void;
  onRemoveFromAllSubscriptions?: () => void;
  onNotify?: (type: "ok" | "err", text: string) => void;
};

type ChipItem = { label: string; value: string; title?: string };

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

function xrayBadge(server: ServerDto): { tone: "ok" | "warn" | "bad" | "muted"; text: string } {
  if (server.vless_deployed) return { tone: "ok", text: "Xray OK" };
  if (server.last_ssh_ok) return { tone: "warn", text: "Не установлен" };
  return { tone: "muted", text: "Xray ?" };
}

function vlessBadge(server: ServerDto): { tone: "ok" | "warn"; text: string } {
  return server.vless_deployed ? { tone: "ok", text: "VLESS OK" } : { tone: "warn", text: "Не развёрнут" };
}

function StatusBadge({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: string }) {
  return <span className={`server-card-v2__badge server-card-v2__badge--${tone}`}>{children}</span>;
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

function HeaderChip({
  label,
  value,
  mono,
  copyKey,
  copiedKey,
  onCopy,
  disabled,
}: {
  label?: string;
  value: string;
  mono?: boolean;
  copyKey?: string;
  copiedKey?: string | null;
  onCopy?: () => void;
  disabled?: boolean;
}) {
  return (
    <span className={`server-card-v2__header-chip ${mono ? "mono" : ""}`.trim()} title={value}>
      {label ? <span className="server-card-v2__header-chip-label">{label}</span> : null}
      <span className="server-card-v2__header-chip-value">{value}</span>
      {onCopy && copyKey ? (
        <CopyButton
          copyKey={copyKey}
          copiedKey={copiedKey ?? null}
          disabled={disabled}
          title="Копировать"
          onCopy={onCopy}
        />
      ) : null}
    </span>
  );
}

export default function ServerCard({
  server: s,
  disabled,
  busyAction,
  onSave,
  onOpenSubscriptionSettings,
  onTestSsh,
  onInstallXray,
  onDeployVless,
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

  useEffect(() => {
    setName(s.name);
    setCc(s.country_code || "");
  }, [s.id, s.updated_at, s.name, s.country_code]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
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
  const vless = vlessBadge(s);
  const usersInSubs = (s.subscription_users_total ?? 0) > 0;
  const usersWithThisServer = Math.max(
    0,
    (s.subscription_users_total ?? 0) - (s.subscription_users_missing ?? 0),
  );
  const xrayInstalled = s.vless_deployed;

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
    navigate("/logs");
  }

  const isBusy = disabled || saving || deleteBusy || previewBusy;

  return (
    <>
      <article className="server-card-v2">
        <header className="server-card-v2__header">
          <div className="server-card-v2__identity">
            <span className="server-card-v2__flag" title={cc ? countryCodeLabel(cc) : "Флаг не выбран"} aria-hidden>
              {previewFlag}
            </span>
            <div className="server-card-v2__title-block">
              <h3 className="server-card-v2__title">{displayName}</h3>
              <div className="server-card-v2__header-chips">
                <HeaderChip
                  value={sshLine}
                  mono
                  copyKey={`ssh-${s.id}`}
                  copiedKey={copiedKey}
                  disabled={isBusy}
                  onCopy={() => void copyText(`ssh-${s.id}`, sshLine, "SSH скопирован")}
                />
                <HeaderChip label="VLESS порт" value={String(vlessPort)} />
                <HeaderChip
                  label="config"
                  value={configShort}
                  mono
                  copyKey={`cfg-${s.id}`}
                  copiedKey={copiedKey}
                  disabled={isBusy}
                  onCopy={() => void copyText(`cfg-${s.id}`, configPath, "Путь config скопирован")}
                />
              </div>
            </div>
          </div>
          <div className="server-card-v2__header-badges">
            <StatusBadge tone={ssh.tone}>{ssh.text}</StatusBadge>
            <StatusBadge tone={xray.tone}>{xray.text}</StatusBadge>
            <StatusBadge tone={vless.tone}>{vless.text}</StatusBadge>
            <StatusBadge tone="muted">{`:${vlessPort}`}</StatusBadge>
          </div>
        </header>

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
              <h4 className="server-card-v2__section-title server-card-v2__section-title--lg">Что попадёт в подписку</h4>
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
                <button type="button" className="primary server-card-v2__sub-link" disabled={isBusy} onClick={onOpenSubscriptionSettings}>
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
            <h4 className="server-card-v2__section-title">Действия</h4>
            <div className="server-card-v2__actions-bar">
              <div className="server-card-v2__actions">
                <button type="button" className="ghost" disabled={isBusy} onClick={onTestSsh}>
                  {busyAction === "ssh" ? (
                    <>
                      <Spinner /> Проверяем…
                    </>
                  ) : s.last_error && !s.last_ssh_ok ? (
                    "Повторить SSH"
                  ) : (
                    "Проверить SSH"
                  )}
                </button>
                <button type="button" className="ghost" disabled={isBusy} onClick={onInstallXray}>
                  {busyAction === "xray" ? (
                    <>
                      <Spinner /> Устанавливаем…
                    </>
                  ) : xrayInstalled ? (
                    "Переустановить Xray"
                  ) : (
                    "Установить Xray"
                  )}
                </button>
                <button
                  type="button"
                  className={s.vless_deployed ? "ghost" : "primary"}
                  disabled={isBusy}
                  onClick={onDeployVless}
                >
                  {busyAction === "vless" ? (
                    <>
                      <Spinner /> {s.vless_deployed ? "Обновляем…" : "Развертываем…"}
                    </>
                  ) : s.vless_deployed ? (
                    "Обновить VLESS"
                  ) : (
                    "Развернуть VLESS"
                  )}
                </button>
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
                {onRemoveFromAllSubscriptions &&
                s.vless_deployed &&
                usersWithThisServer > 0 ? (
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

              <div className="server-card-v2__more-wrap" ref={menuRef}>
                <button
                  ref={moreBtnRef}
                  type="button"
                  className="ghost server-card-v2__more-btn"
                  disabled={isBusy}
                  aria-expanded={menuOpen}
                  onClick={toggleMenu}
                >
                  Ещё ▾
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
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void copyText(`menu-cfg-${s.id}`, configPath, "Config скопирован");
                      }}
                    >
                      Скопировать config path
                    </button>
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
            </div>
          </section>
        </div>
      </article>

      {deleteOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !deleteBusy && setDeleteOpen(false)}>
          <div className="modal server-card-v2__delete-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Удалить сервер?</h2>
            </div>
            <div className="modal-body">
              <p>
                Вы действительно хотите удалить сервер «{displayName}» из панели?
              </p>
              <p className="muted server-card-v2__delete-note">
                Это действие уберёт сервер из панели. Перед удалением убедитесь, что сервер не используется в активных
                подписках.
              </p>
              {usersInSubs ? (
                <p className="server-card-v2__delete-warn">
                  Сервер используется в активных подписках ({s.subscription_users_total ?? 0} пользователей). Удаление
                  может повлиять на пользователей.
                </p>
              ) : null}
              {deleteError ? <p className="server-card-v2__delete-error">Не удалось удалить сервер: {deleteError}</p> : null}
            </div>
            <div className="modal-footer">
              <button type="button" className="ghost" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>
                Отмена
              </button>
              <button type="button" className="danger" disabled={deleteBusy} onClick={() => void confirmDelete()}>
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
      ) : null}
    </>
  );
}
