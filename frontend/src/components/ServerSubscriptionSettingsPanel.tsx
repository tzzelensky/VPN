import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SUBSCRIPTION_FINGERPRINTS,
  SUBSCRIPTION_FLOWS,
  SUBSCRIPTION_SNI_PRESETS,
  fetchSubscriptionSettingGenerators,
  fetchVlessAuthGenerator,
  checkServerSubscriptionSettings,
  loadServerSubscriptionSettings,
  previewServerSubscriptionSettings,
  resetServerSubscriptionSettings,
  saveServerSubscriptionSettings,
  syncServerSubscriptionSettings,
  type ServerDto,
  type ServerSubscriptionSettingsDto,
  type ServerSubscriptionSettingsVlessDto,
  type SubscriptionCheckItemDto,
} from "../api";
import Spinner from "./Spinner";

type Props = {
  server: ServerDto;
  onClose: () => void;
  onSaved: (server: ServerDto) => void;
  onToast: (type: "ok" | "err", text: string) => void;
};

type FieldErrors = Record<string, string>;

const MUX_DEFAULTS: ServerSubscriptionSettingsDto["mux"] = {
  enabled: false,
  concurrency: -1,
  xudp_concurrency: 8,
  xudp_proxy_udp443: "",
};

const SNIFF_DEFAULTS: ServerSubscriptionSettingsDto["sniffing"] = {
  enabled: true,
  dest_override: ["http", "tls", "quic"],
};

function sniPresetValue(sni: string): string {
  const v = sni.trim();
  if (SUBSCRIPTION_SNI_PRESETS.slice(0, -1).includes(v as (typeof SUBSCRIPTION_SNI_PRESETS)[number])) return v;
  return v ? "custom" : "www.microsoft.com";
}

function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}****${v.slice(-4)}`;
}

function defaultVlessBlock(flow: ServerSubscriptionSettingsDto["flow"] = ""): ServerSubscriptionSettingsVlessDto {
  return {
    flow,
    encryption: "none",
    auth_mode: "",
    decrypt_value: "",
    encrypt_value: "",
  };
}

function ensureSettingsVless(s: ServerSubscriptionSettingsDto): ServerSubscriptionSettingsDto {
  const flow = s.flow ?? "";
  return syncLocalVless({
    ...s,
    vless: s.vless ?? defaultVlessBlock(flow),
    sniffing: s.sniffing ?? { ...SNIFF_DEFAULTS },
  });
}

function resolveLocalEncryption(vless: ServerSubscriptionSettingsVlessDto, fallback = "none"): string {
  const enc = (vless.encryption ?? "").trim();
  if (enc && enc !== "none") return enc;
  const ev = (vless.encrypt_value ?? "").trim();
  if (ev) return ev;
  return fallback;
}

function syncLocalVless(settings: ServerSubscriptionSettingsDto): ServerSubscriptionSettingsDto {
  const vless = {
    ...(settings.vless ?? defaultVlessBlock(settings.flow)),
    flow: settings.flow,
  };
  const encryption = resolveLocalEncryption(vless, "none");
  let flow = settings.flow ?? "";
  if (encryption.startsWith("mlkem")) {
    flow = "";
  } else if (!flow && settings.security === "reality" && settings.network === "tcp" && encryption === "none") {
    flow = "xtls-rprx-vision";
  }
  return {
    ...settings,
    flow,
    vless: { ...vless, flow, encryption },
    encryption,
  };
}

function authModeLabel(mode: ServerSubscriptionSettingsVlessDto["auth_mode"]): string {
  if (mode === "x25519") return "Аутентификация X25519";
  if (mode === "ml-kem-768") return "Аутентификация ML-KEM-768";
  return "не выбрано";
}

function resolveLocalFlow(settings: ServerSubscriptionSettingsDto): string {
  const explicit = (settings.flow ?? settings.vless?.flow ?? "").trim();
  if (explicit) return explicit;
  const enc = resolveLocalEncryption(settings.vless ?? defaultVlessBlock(settings.flow), "none");
  if (settings.security === "reality" && settings.network === "tcp" && enc === "none") {
    return "xtls-rprx-vision";
  }
  return "";
}

function buildLocalOutcomeLines(settings: ServerSubscriptionSettingsDto, serverHost: string): string[] {
  const vless = settings.vless ?? defaultVlessBlock(settings.flow);
  const encryption = resolveLocalEncryption(vless, "none");
  const flow = resolveLocalFlow(settings);
  const address =
    settings.address_mode === "custom" && settings.address_override.trim()
      ? settings.address_override.trim()
      : serverHost;
  return [
    `Address: ${address}`,
    `Порт: ${settings.vless_port}`,
    `uTLS: ${settings.reality.fingerprint}`,
    `Flow: ${flow || "none"}`,
    `Encryption: ${encryption}`,
    `authMode: ${settings.vless?.auth_mode || "none"}`,
    `SNI: ${settings.reality.server_name}`,
    `shortId: ${settings.reality.short_id || "—"}`,
    `spiderX: ${settings.reality.spider_x || "/"}`,
    `allowInsecure: ${settings.reality.allow_insecure}`,
    `show: ${settings.reality.show}`,
    `network: ${settings.network}`,
    `security: ${settings.security}`,
    `MUX enabled: ${settings.mux.enabled}`,
    `sniffing: ${settings.sniffing?.enabled ?? true}`,
    `dns.queryStrategy: ${settings.dns.query_strategy}`,
    `remarks: ${settings.remarks}`,
  ];
}

function validateSettings(settings: ServerSubscriptionSettingsDto): FieldErrors {
  const errors: FieldErrors = {};
  const vless = settings.vless ?? defaultVlessBlock(settings.flow);
  if (!settings.remarks.trim()) errors.remarks = "Укажите название в подписке";
  if (!Number.isFinite(settings.vless_port) || settings.vless_port < 1 || settings.vless_port > 65535) {
    errors.vless_port = "Порт должен быть от 1 до 65535";
  }
  if (settings.address_mode === "custom" && !settings.address_override.trim()) {
    errors.address_override = "Укажите адрес или выберите «из поля сервера»";
  }
  const authMode = vless.auth_mode ?? "";
  const encryptValue = (vless.encrypt_value ?? "").trim();
  const resolvedEnc = resolveLocalEncryption(vless, "none");
  if (resolvedEnc.startsWith("mlkem")) {
    const dec = (vless.decrypt_value ?? "").trim();
    if (!dec.startsWith("mlkem")) {
      errors["vless.decrypt_value"] = "Укажите decryption для inbound или сгенерируйте пару";
    }
    if (settings.flow) {
      errors.flow = "При PQ-шифровании flow должен быть пустым";
    }
  } else if (authMode === "x25519" || authMode === "ml-kem-768") {
    if (!encryptValue || encryptValue === "none") {
      errors["vless.encrypt_value"] = "Введите значение шифрования или сгенерируйте его";
    }
  }
  if (!settings.network) errors.network = "Выберите network";
  if (!settings.security) errors.security = "Выберите security";
  if (!SUBSCRIPTION_FLOWS.includes(settings.flow)) {
    errors.flow = "Недопустимый flow";
  }
  if (settings.flow === "xtls-rprx-vision" && settings.network !== "tcp") {
    errors.network = "flow xtls-rprx-vision требует network tcp";
  }
  if (!["UseIP", "UseIPv4", "UseIPv6", "UseIPv4v6"].includes(settings.dns.query_strategy)) {
    errors["dns.query_strategy"] = "Недопустимый queryStrategy";
  }
  if (!SUBSCRIPTION_FINGERPRINTS.includes(settings.reality.fingerprint as (typeof SUBSCRIPTION_FINGERPRINTS)[number])) {
    errors["reality.fingerprint"] = "Недопустимый fingerprint";
  }
  if (settings.security === "reality") {
    if (!settings.reality.public_key.trim()) errors["reality.public_key"] = "Укажите Reality pbk";
    if (!settings.reality.server_name.trim()) errors["reality.server_name"] = "Укажите Reality SNI";
    if (!settings.reality.short_id.trim()) errors["reality.short_id"] = "Укажите Reality shortId";
  }
  const spx = settings.reality.spider_x.trim() || "/";
  if (!spx.startsWith("/")) errors["reality.spider_x"] = "spiderX должен начинаться с /";
  return errors;
}

function parseApiErrors(raw: string): FieldErrors | null {
  try {
    const parsed = JSON.parse(raw) as { errors?: { field: string; message: string }[] };
    if (!parsed.errors?.length) return null;
    const map: FieldErrors = {};
    for (const x of parsed.errors) map[x.field] = x.message;
    return map;
  } catch {
    return null;
  }
}

function SubCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="server-sub-card">
      <header className="server-sub-card__head">
        <h3>{title}</h3>
        {desc ? <p className="server-sub-card__desc">{desc}</p> : null}
      </header>
      <div className="server-sub-card__body">{children}</div>
    </section>
  );
}

function SubField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`server-sub-field ${className ?? ""}`.trim()}>
      <span className="server-sub-field__label">{label}</span>
      <span className="server-sub-field__control">
        {children}
        {hint ? <span className="server-sub-field__hint">{hint}</span> : null}
        {error ? <span className="field-hint err">{error}</span> : null}
      </span>
    </label>
  );
}

function SubToggleCard({
  title,
  desc,
  warn,
  on,
  onToggle,
}: {
  title: string;
  desc: string;
  warn?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`server-sub-toggle-card ${on ? "is-on" : ""}`.trim()}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="server-sub-toggle-card__body">
        <div className="server-sub-toggle-card__title">{title}</div>
        <div className="server-sub-toggle-card__desc">{desc}</div>
        {on && warn ? <div className="server-sub-toggle-card__warn">{warn}</div> : null}
      </div>
      <button
        type="button"
        className={`toggle toggle-sm ${on ? "on" : ""}`}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
    </div>
  );
}

export default function ServerSubscriptionSettingsPanel({ server, onClose, onSaved, onToast }: Props) {
  const [settings, setSettings] = useState<ServerSubscriptionSettingsDto | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [previewJson, setPreviewJson] = useState("");
  const [previewUri, setPreviewUri] = useState("");
  const [previewSummary, setPreviewSummary] = useState<Record<string, unknown> | null>(null);
  const [checklist, setChecklist] = useState<SubscriptionCheckItemDto[]>([]);
  const [outcomeLines, setOutcomeLines] = useState<string[]>([]);
  const [sniPreset, setSniPreset] = useState("www.microsoft.com");
  const [showPublicKey, setShowPublicKey] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await loadServerSubscriptionSettings(server.id);
        if (cancelled) return;
        const next = ensureSettingsVless(r.settings);
        setSettings(next);
        setSavedJson(JSON.stringify(next));
        setCustom(r.custom);
        setSniPreset(sniPresetValue(next.reality.server_name));
        setErrors({});
        setPreviewJson("");
        setPreviewUri("");
        setPreviewSummary(null);
        setChecklist([]);
        setOutcomeLines([]);
      } catch (e) {
        if (!cancelled) onToastRef.current("err", String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [server.id]);

  const dirty = useMemo(() => {
    if (!settings || !savedJson) return false;
    return JSON.stringify(settings) !== savedJson;
  }, [settings, savedJson]);

  const err = (field: string) => errors[field];

  function patchSettings(patch: Partial<ServerSubscriptionSettingsDto>) {
    setSettings((s) => (s ? syncLocalVless({ ...s, ...patch }) : s));
  }

  function patchVless(patch: Partial<ServerSubscriptionSettingsVlessDto>) {
    setSettings((s) => {
      if (!s) return s;
      const baseVless = s.vless ?? defaultVlessBlock(s.flow);
      const vless = { ...baseVless, ...patch, flow: s.flow };
      const encryption = (patch.encrypt_value ?? patch.encryption ?? resolveLocalEncryption(vless, "none")).trim() || "none";
      return syncLocalVless({
        ...s,
        vless: { ...vless, encryption },
        encryption,
      });
    });
  }

  function applyVlessAuthPair(pair: {
    auth_mode: "x25519" | "ml-kem-768";
    encrypt_value: string;
    decrypt_value: string;
    encryption: string;
  }) {
    const pq = pair.encryption.startsWith("mlkem");
    setSettings((s) => {
      if (!s) return s;
      const baseVless = s.vless ?? defaultVlessBlock(s.flow);
      const vless = {
        ...baseVless,
        auth_mode: pair.auth_mode,
        encrypt_value: pair.encrypt_value,
        decrypt_value: pair.decrypt_value,
        encryption: pair.encryption,
        flow: pq ? "" : s.flow,
      };
      return syncLocalVless({
        ...s,
        flow: pq ? "" : s.flow,
        vless,
        encryption: pair.encryption,
      });
    });
  }

  function runClientValidation(): boolean {
    if (!settings) return false;
    const map = validateSettings(settings);
    setErrors(map);
    const keys = Object.keys(map);
    if (keys.length > 0) {
      onToastRef.current("err", map[keys[0]!] ?? "Исправьте ошибки в форме.");
    }
    return keys.length === 0;
  }

  const liveOutcome = useMemo(() => {
    if (!settings) return [];
    return buildLocalOutcomeLines(settings, server.host);
  }, [settings, server.host]);

  async function runCheck(scroll = false) {
    if (!settings) return;
    setBusy(true);
    try {
      const r = await checkServerSubscriptionSettings(server.id, settings);
      setChecklist(r.checklist);
      setOutcomeLines(r.outcome);
      const map: FieldErrors = {};
      for (const e of r.validation_errors) map[e.field] = e.message;
      setErrors(map);
      if (r.ok) onToastRef.current("ok", "Проверка пройдена — настройки готовы к сохранению.");
      else onToastRef.current("err", "Есть ошибки в настройках — см. список проверки.");
      if (scroll) {
        requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (e) {
      onToastRef.current("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(scroll = false) {
    if (!settings) return;
    if (!runClientValidation()) {
      return;
    }
    setBusy(true);
    try {
      const r = await previewServerSubscriptionSettings(server.id, settings);
      setPreviewJson(JSON.stringify(r.json, null, 2));
      setPreviewUri(r.vless_uri);
      setPreviewSummary(r.summary);
      setChecklist(r.checklist ?? []);
      setOutcomeLines(r.outcome ?? []);
      setErrors({});
      if (scroll) {
        requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (e) {
      const map = parseApiErrors(String(e));
      if (map) setErrors(map);
      else onToast("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  async function persistSettings() {
    if (!settings) return false;
    if (!runClientValidation()) {
      return false;
    }
    setBusy(true);
    try {
      const r = await saveServerSubscriptionSettings(server.id, settings);
      const next = ensureSettingsVless(r.settings);
      setSettings(next);
      setSavedJson(JSON.stringify(next));
      setCustom(true);
      onSaved(r.server);
      if (r.server_apply?.ok) {
        const pushed = r.server_apply.pushed?.length ? ` · ${r.server_apply.pushed.join(", ")}` : "";
        const fw = r.server_apply.firewall;
        const fwMsg =
          fw && !fw.opened
            ? ` Внимание: ${fw.detail}${fw.manual_command ? ` (${fw.manual_command})` : ""}`
            : fw?.opened
              ? ` Firewall: порт ${r.server_apply.applied_port ?? settings.vless_port}/tcp открыт.`
              : "";
        onToast(
          "ok",
          `Применено на сервере${r.server_apply.applied_port ? ` (порт ${r.server_apply.applied_port})` : ""}${pushed}.${fwMsg} Обновите подписку в клиенте.`,
        );
      } else if (r.server_apply) {
        onToast(
          "err",
          `${r.server_apply.detail} Настройки сохранены в панели, но сервер не обновлён — нажмите «Из конфига» и сохраните снова.`,
        );
      } else {
        onToast(
          "ok",
          `Настройки подписки для сервера ${server.name || server.host} сохранены.`,
        );
      }
      return true;
    } catch (e) {
      const map = parseApiErrors(String(e));
      if (map) setErrors(map);
      else onToast("err", String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!window.confirm("Сбросить настройки подписки к значениям по умолчанию (из конфига сервера)?")) return;
    setBusy(true);
    try {
      const r = await resetServerSubscriptionSettings(server.id);
      setSettings(ensureSettingsVless(r.settings));
      setSavedJson(JSON.stringify(ensureSettingsVless(r.settings)));
      setCustom(false);
      setSniPreset(sniPresetValue(r.settings.reality.server_name));
      onSaved(r.server);
      setPreviewJson("");
      setPreviewSummary(null);
      onToast("ok", "Настройки сброшены.");
    } catch (e) {
      onToast("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      const r = await syncServerSubscriptionSettings(server.id);
      setSettings(ensureSettingsVless(r.settings));
      setSniPreset(sniPresetValue(r.settings.reality.server_name));
      onSaved(r.server);
      onToast("ok", "Настройки загружены из конфига сервера.");
    } catch (e) {
      onToast("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  async function genShortId() {
    const r = await fetchSubscriptionSettingGenerators();
    patchSettings({ reality: { ...settings!.reality, short_id: r.short_id } });
  }

  async function genSpiderX() {
    const r = await fetchSubscriptionSettingGenerators();
    patchSettings({ reality: { ...settings!.reality, spider_x: r.spider_x } });
  }

  async function genRealityKeyPair() {
    setBusy(true);
    try {
      const r = await fetchSubscriptionSettingGenerators();
      patchSettings({
        reality: {
          ...settings!.reality,
          public_key: r.public_key,
          private_key: r.private_key,
        },
      });
      setShowPublicKey(true);
      setShowPrivateKey(true);
      onToast("ok", "Reality-ключи сгенерированы.");
    } catch (e) {
      onToast("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  async function selectVlessAuth(mode: "x25519" | "ml-kem-768") {
    setBusy(true);
    try {
      const pair = await fetchVlessAuthGenerator(server.id, mode);
      applyVlessAuthPair(pair);
      onToastRef.current("ok", `${authModeLabel(mode)} — пара сгенерирована на сервере через xray vlessenc.`);
    } catch (e) {
      onToastRef.current("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  function clearVlessAuth() {
    patchVless({
      auth_mode: "",
      encrypt_value: "",
      decrypt_value: "",
      encryption: "none",
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next["vless.encrypt_value"];
      return next;
    });
    onToastRef.current("ok", "VLESS encryption сброшен на none.");
  }

  function resetMuxDefaults() {
    patchSettings({ mux: { ...MUX_DEFAULTS } });
  }

  function handleClose() {
    if (dirty && !window.confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
    onClose();
  }

  const dnsServersText = useMemo(
    () => (settings?.dns.servers ?? []).join("\n"),
    [settings?.dns.servers],
  );

  if (loading || !settings) {
    return (
      <div className="modal-backdrop">
        <div className="modal modal--wide server-sub-modal">
          <div className="modal-body server-sub-loading">
            <Spinner /> Загрузка…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal modal--wide server-sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Настройка подписки — {server.name || server.host}</h2>
          <button type="button" className="modal-close" onClick={handleClose}>
            ×
          </button>
        </div>

        <div className="modal-body server-sub-body">
          <div className="server-sub-info" role="status">
            Эти настройки применяются только к текущему серверу и всем подпискам, где используется этот сервер.
            Другие серверы не изменятся.
            {custom ? " · сохранены вручную" : " · синхронизация с конфигом включена"}
            {" · "}
            <strong>«Сохранить» записывает inbound на сервере и перезапускает Xray.</strong>
          </div>
          <div className="server-sub-warn-inline">
            Проверьте, что inbound Xray на сервере использует те же REALITY/X25519-настройки (port, pbk, shortId, SNI, encryption).
            Иначе клиентский конфиг может не подключиться.
          </div>
          {resolveLocalEncryption(settings.vless ?? defaultVlessBlock(settings.flow), "none").startsWith("mlkem") ? (
            <div className="server-sub-warn-inline" role="status">
              PQ-шифрование (mlkem): при сохранении на inbound запишется decryption, flow не используется.
            </div>
          ) : null}

          <SubCard title="Основное" desc="Адрес, порт и название узла в клиентской подписке.">
            <div className="server-sub-grid">
              <SubField label="Адрес в подписке">
                <select
                  className="input"
                  value={settings.address_mode}
                  onChange={(e) => patchSettings({ address_mode: e.target.value as "host" | "custom" })}
                >
                  <option value="host">Из поля сервера ({server.host})</option>
                  <option value="custom">Свой адрес / домен</option>
                </select>
              </SubField>
              <SubField
                label="Порт VLESS (подписка + сервер)"
                hint="При сохранении inbound переключится на этот порт; UFW/firewalld откроет TCP автоматически."
                error={err("vless_port")}
              >
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={settings.vless_port}
                  onChange={(e) => patchSettings({ vless_port: Number(e.target.value) || 443 })}
                />
              </SubField>
              {settings.address_mode === "custom" ? (
                <SubField label="Переопределение address" error={err("address_override")} className="server-sub-field--wide">
                  <input
                    className="input"
                    value={settings.address_override}
                    onChange={(e) => patchSettings({ address_override: e.target.value })}
                    placeholder="vpn.example.com"
                  />
                </SubField>
              ) : null}
              <SubField label="Название в подписке (remarks)" error={err("remarks")} className="server-sub-field--wide">
                <input
                  className="input"
                  value={settings.remarks}
                  onChange={(e) => patchSettings({ remarks: e.target.value })}
                  placeholder="🇫🇷 HSN-VPN"
                />
              </SubField>
            </div>
          </SubCard>

          <SubCard title="VLESS" desc="Параметры протокола и аутентификация users[].encryption в JSON подписки.">
            <div className="server-sub-auth">
              <div className="server-sub-auth__buttons">
                <button
                  type="button"
                  className={`btn btn-sm ${settings.vless.auth_mode === "x25519" ? "primary" : "ghost"}`}
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    selectVlessAuth("x25519");
                  }}
                >
                  Аутентификация X25519
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${settings.vless.auth_mode === "ml-kem-768" ? "primary" : "ghost"}`}
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    selectVlessAuth("ml-kem-768");
                  }}
                >
                  Аутентификация ML-KEM-768
                </button>
                <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={(e) => { e.preventDefault(); clearVlessAuth(); }}>
                  Очистить
                </button>
              </div>
              <p className="server-sub-auth__selected">
                Выбрано: <strong>{authModeLabel(settings.vless.auth_mode)}</strong>
              </p>
              <div className="server-sub-grid">
                <SubField label="Расшифрование" hint="Для inbound на сервере; в подписку не попадает." className="server-sub-field--wide">
                  <input
                    className="input mono"
                    value={settings.vless.decrypt_value}
                    onChange={(e) => patchVless({ decrypt_value: e.target.value })}
                    placeholder="Значение decrypt для inbound"
                  />
                </SubField>
                <SubField
                  label="Шифрование"
                  hint="Попадает в outbounds[].settings.vnext[].users[].encryption"
                  error={err("vless.encrypt_value")}
                  className="server-sub-field--wide"
                >
                  <input
                    className="input mono"
                    value={settings.vless.encrypt_value}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchVless({
                        encrypt_value: v,
                        encryption: v.trim() || "none",
                      });
                    }}
                    placeholder={settings.vless.auth_mode ? "mlkem768x25519plus.native.0rtt...." : "none"}
                  />
                </SubField>
              </div>
            </div>
            <div className="server-sub-grid">
              <SubField label="Network" error={err("network")}>
                <select
                  className="input"
                  value={settings.network}
                  onChange={(e) => patchSettings({ network: e.target.value as ServerSubscriptionSettingsDto["network"] })}
                >
                  <option value="tcp">tcp</option>
                  <option value="grpc">grpc</option>
                  <option value="ws">ws</option>
                  <option value="xhttp">xhttp</option>
                </select>
              </SubField>
              <SubField label="Security" error={err("security")}>
                <select
                  className="input"
                  value={settings.security}
                  onChange={(e) => patchSettings({ security: e.target.value as ServerSubscriptionSettingsDto["security"] })}
                >
                  <option value="reality">reality</option>
                  <option value="tls">tls</option>
                  <option value="none">none</option>
                </select>
              </SubField>
            </div>
          </SubCard>

          <SubCard title="Поток" desc="VLESS flow в outbound подписки (users[].flow). Для REALITY обычно используется xtls-rprx-vision.">
            <div className="server-sub-grid server-sub-grid--1">
              <SubField
                label="Flow"
                hint="Пустое значение — flow не попадёт в JSON и VLESS URI."
                error={err("flow")}
              >
                <select
                  className="input"
                  value={settings.flow}
                  onChange={(e) =>
                    patchSettings({ flow: e.target.value as ServerSubscriptionSettingsDto["flow"] })
                  }
                >
                  <option value="">none (без flow)</option>
                  <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                </select>
              </SubField>
            </div>
          </SubCard>

          {settings.security === "reality" ? (
            <SubCard title="REALITY" desc="Параметры streamSettings.realitySettings для этого сервера.">
              <div className="server-sub-grid server-sub-grid--1">
                <div className="server-sub-x25519-head">
                  <h4>Reality-ключи (pbk / privateKey)</h4>
                  <p className="server-sub-card__desc">
                    publicKey попадает в подписку клиента; privateKey указывается только в inbound Xray на сервере.
                  </p>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void genRealityKeyPair()}>
                    {busy ? <Spinner /> : "Сгенерировать пару Reality-ключей"}
                  </button>
                </div>
              </div>
              <div className="server-sub-grid">
                <SubField label="Public Key (pbk)" error={err("reality.public_key")} className="server-sub-field--wide">
                  <div className="server-sub-input-row">
                    <input
                      className="input mono"
                      value={showPublicKey ? settings.reality.public_key : maskSecret(settings.reality.public_key)}
                      readOnly={!showPublicKey}
                      onFocus={() => setShowPublicKey(true)}
                      onChange={(e) => patchSettings({ reality: { ...settings.reality, public_key: e.target.value } })}
                    />
                    <button type="button" className="btn btn-sm ghost" onClick={() => setShowPublicKey((v) => !v)}>
                      {showPublicKey ? "Скрыть" : "Показать"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm ghost"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(settings.reality.public_key)
                          .then(() => onToast("ok", "publicKey скопирован"))
                      }
                    >
                      Скопировать
                    </button>
                  </div>
                </SubField>
                <SubField
                  label="Private Key (inbound)"
                  hint="Не попадает в клиентскую подписку. Сохраняется для настройки сервера."
                  className="server-sub-field--wide"
                >
                  <div className="server-sub-input-row">
                    <input
                      className="input mono"
                      value={showPrivateKey ? settings.reality.private_key : maskSecret(settings.reality.private_key)}
                      readOnly={!showPrivateKey}
                      onFocus={() => setShowPrivateKey(true)}
                      onChange={(e) => patchSettings({ reality: { ...settings.reality, private_key: e.target.value } })}
                      placeholder="Только для realitySettings.privateKey на сервере"
                    />
                    <button type="button" className="btn btn-sm ghost" onClick={() => setShowPrivateKey((v) => !v)}>
                      {showPrivateKey ? "Скрыть" : "Показать"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm ghost"
                      disabled={!settings.reality.private_key.trim()}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(settings.reality.private_key)
                          .then(() => onToast("ok", "privateKey скопирован"))
                      }
                    >
                      Скопировать
                    </button>
                  </div>
                </SubField>
                <SubField label="Reality SNI / serverName" error={err("reality.server_name")}>
                  <select
                    className="input"
                    value={sniPreset}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSniPreset(v);
                      if (v !== "custom") patchSettings({ reality: { ...settings.reality, server_name: v } });
                    }}
                  >
                    {SUBSCRIPTION_SNI_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {p === "custom" ? "Свой SNI…" : p}
                      </option>
                    ))}
                  </select>
                </SubField>
                {sniPreset === "custom" ? (
                  <SubField label="Свой SNI">
                    <input
                      className="input"
                      value={settings.reality.server_name}
                      onChange={(e) => patchSettings({ reality: { ...settings.reality, server_name: e.target.value } })}
                    />
                  </SubField>
                ) : null}
                <SubField label="Reality shortId" error={err("reality.short_id")}>
                  <div className="server-sub-input-row">
                    <input
                      className="input mono"
                      value={settings.reality.short_id}
                      onChange={(e) => patchSettings({ reality: { ...settings.reality, short_id: e.target.value } })}
                    />
                    <button type="button" className="btn btn-sm ghost" onClick={() => void genShortId()}>
                      Сгенерировать
                    </button>
                  </div>
                </SubField>
                <SubField label="Reality spiderX" error={err("reality.spider_x")}>
                  <div className="server-sub-input-row">
                    <input
                      className="input mono"
                      value={settings.reality.spider_x}
                      onChange={(e) => patchSettings({ reality: { ...settings.reality, spider_x: e.target.value } })}
                    />
                    <button type="button" className="btn btn-sm ghost" onClick={() => void genSpiderX()}>
                      Сгенерировать
                    </button>
                  </div>
                </SubField>
                <SubField
                  label="uTLS / Fingerprint"
                  hint="Fingerprint влияет на TLS-отпечаток в клиентской подписке."
                  error={err("reality.fingerprint")}
                >
                  <select
                    className="input"
                    value={settings.reality.fingerprint}
                    onChange={(e) => patchSettings({ reality: { ...settings.reality, fingerprint: e.target.value } })}
                  >
                    {SUBSCRIPTION_FINGERPRINTS.map((fp) => (
                      <option key={fp} value={fp}>
                        {fp}
                      </option>
                    ))}
                  </select>
                  {settings.reality.fingerprint === "unsafe" ? (
                    <span className="server-sub-inline-warn">unsafe не рекомендуется для боевого использования.</span>
                  ) : null}
                </SubField>
              </div>
              <div className="server-sub-toggle-grid">
                <SubToggleCard
                  title="allowInsecure"
                  desc="Разрешает небезопасную проверку соединения. Для боевого конфига обычно должно быть выключено."
                  warn="Не рекомендуется для боевого использования."
                  on={settings.reality.allow_insecure}
                  onToggle={() =>
                    patchSettings({ reality: { ...settings.reality, allow_insecure: !settings.reality.allow_insecure } })
                  }
                />
                <SubToggleCard
                  title="show"
                  desc="Debug-параметр REALITY. Обычно должен быть выключен."
                  warn="Для обычных подписок рекомендуется show=false."
                  on={settings.reality.show}
                  onToggle={() => patchSettings({ reality: { ...settings.reality, show: !settings.reality.show } })}
                />
              </div>
            </SubCard>
          ) : null}

          {settings.network === "tcp" ? (
            <SubCard title="TCP" desc="Настройки TCP transport для VLESS.">
              <div className="server-sub-grid server-sub-grid--1">
                <SubField label="Header type">
                  <select
                    className="input"
                    value={settings.tcp.header_type}
                    onChange={(e) => patchSettings({ tcp: { header_type: e.target.value } })}
                  >
                    <option value="none">none</option>
                  </select>
                </SubField>
              </div>
            </SubCard>
          ) : null}

          <SubCard title="MUX" desc="Только клиентская подписка (outbound.mux). На inbound сервера не применяется.">
            <SubToggleCard
              title="MUX"
              desc="Объединение соединений. Для совместимости обычно выключено."
              on={settings.mux.enabled}
              onToggle={() => patchSettings({ mux: { ...settings.mux, enabled: !settings.mux.enabled } })}
            />
            <div className={`server-sub-grid ${!settings.mux.enabled ? "is-disabled" : ""}`.trim()}>
              <SubField label="concurrency">
                <input
                  className="input"
                  type="number"
                  disabled={!settings.mux.enabled}
                  value={settings.mux.concurrency}
                  onChange={(e) => patchSettings({ mux: { ...settings.mux, concurrency: Number(e.target.value) } })}
                />
              </SubField>
              <SubField label="xudpConcurrency">
                <input
                  className="input"
                  type="number"
                  disabled={!settings.mux.enabled}
                  value={settings.mux.xudp_concurrency}
                  onChange={(e) => patchSettings({ mux: { ...settings.mux, xudp_concurrency: Number(e.target.value) } })}
                />
              </SubField>
              <SubField label="xudpProxyUDP443">
                <input
                  className="input"
                  disabled={!settings.mux.enabled}
                  value={settings.mux.xudp_proxy_udp443}
                  onChange={(e) => patchSettings({ mux: { ...settings.mux, xudp_proxy_udp443: e.target.value } })}
                />
              </SubField>
            </div>
            <button type="button" className="btn btn-sm ghost server-sub-reset-mux" onClick={resetMuxDefaults}>
              Сбросить MUX к дефолту
            </button>
          </SubCard>

          <SubCard title="Sniffing" desc="Sniffing на VLESS inbound сервера (как в 3x-ui) + локальные inbounds в подписке.">
            <SubToggleCard
              title="Sniffing inbound"
              desc="destOverride: http, tls, quic — помогает маршрутизации на сервере."
              on={settings.sniffing?.enabled ?? true}
              onToggle={() =>
                patchSettings({
                  sniffing: {
                    ...(settings.sniffing ?? SNIFF_DEFAULTS),
                    enabled: !(settings.sniffing?.enabled ?? true),
                  },
                })
              }
            />
          </SubCard>

          <SubCard title="DNS" desc="Записывается в config.json на сервере и в JSON подписки клиента.">
            <div className="server-sub-grid">
              <SubField
                label="queryStrategy"
                hint="Для мобильной совместимости чаще используется UseIPv4."
                error={err("dns.query_strategy")}
              >
                <div className="server-sub-select-row">
                  <select
                    className="input"
                    value={settings.dns.query_strategy}
                    onChange={(e) =>
                      patchSettings({
                        dns: {
                          ...settings.dns,
                          query_strategy: e.target.value as ServerSubscriptionSettingsDto["dns"]["query_strategy"],
                        },
                      })
                    }
                  >
                    <option value="UseIP">UseIP</option>
                    <option value="UseIPv4">UseIPv4</option>
                    <option value="UseIPv6">UseIPv6</option>
                    <option value="UseIPv4v6">UseIPv4v6</option>
                  </select>
                  {settings.dns.query_strategy === "UseIPv4" ? (
                    <span className="pill ok server-sub-badge">Рекомендуется для мобильных сетей</span>
                  ) : null}
                </div>
              </SubField>
              <SubField label="DNS servers (по одному на строку)" className="server-sub-field--wide">
                <textarea
                  className="input"
                  rows={3}
                  value={dnsServersText}
                  onChange={(e) =>
                    patchSettings({
                      dns: {
                        ...settings.dns,
                        servers: e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
                      },
                    })
                  }
                />
              </SubField>
            </div>
          </SubCard>

          <SubCard title="Предпросмотр подписки" desc="Preview и реальная подписка используют одну функцию генерации на backend.">
            <div ref={previewRef} className="server-sub-preview-actions">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void runCheck(true)}>
                {busy ? <Spinner /> : "Проверить настройки"}
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void runPreview(true)}>
                {busy ? <Spinner /> : "Обновить preview"}
              </button>
              <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => void runPreview(false)}>
                Проверить генерацию
              </button>
              {previewJson ? (
                <button
                  type="button"
                  className="btn btn-sm ghost"
                  onClick={() => void navigator.clipboard.writeText(previewJson).then(() => onToast("ok", "JSON скопирован"))}
                >
                  Скопировать JSON
                </button>
              ) : null}
            </div>

            <h4 className="server-sub-preview-title">В итоговую подписку попадёт</h4>
            <ul className="server-sub-outcome">
              {(outcomeLines.length ? outcomeLines : liveOutcome).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {checklist.length ? (
              <>
                <h4 className="server-sub-preview-title">Результат проверки</h4>
                <ul className="server-sub-checklist">
                  {checklist.map((item, i) => (
                    <li key={`${item.level}-${i}`} className={`server-sub-checklist__item is-${item.level}`}>
                      {item.level === "ok" ? "✅" : item.level === "warn" ? "⚠️" : "❌"} {item.text}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {previewSummary ? (
              <>
                <h4 className="server-sub-preview-title">Ключевые значения</h4>
                <pre className="server-sub-preview">{JSON.stringify(previewSummary, null, 2)}</pre>
              </>
            ) : (
              <p className="server-sub-preview-empty muted">Нажмите «Обновить preview», чтобы увидеть итоговый JSON.</p>
            )}
            {previewUri ? (
              <details className="server-sub-preview-details">
                <summary>VLESS URI</summary>
                <pre className="server-sub-preview mono">{previewUri}</pre>
              </details>
            ) : null}
            {previewJson ? (
              <details className="server-sub-preview-details">
                <summary>Полный JSON</summary>
                <pre className="server-sub-preview mono">{previewJson}</pre>
              </details>
            ) : null}
          </SubCard>
        </div>

        <div className="server-sub-sticky-bar">
          <div className="server-sub-sticky-bar__meta">
            {dirty ? <span className="server-sub-dirty">Есть несохранённые изменения</span> : <span className="muted">Все изменения сохранены</span>}
          </div>
          <div className="server-sub-sticky-bar__actions">
            <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => void handleSync()}>
              Из конфига
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void handleReset()}>
              Сбросить к дефолту
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void runPreview(false)}>
              Проверить генерацию
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void persistSettings()}>
              Применить
            </button>
            <button type="button" className="btn btn-sm primary" disabled={busy} onClick={() => void persistSettings()}>
              {busy ? <Spinner /> : "Сохранить и применить на сервере"}
            </button>
            <button type="button" className="btn btn-sm" onClick={handleClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
