import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import DashboardLayout from "../components/DashboardLayout";
import {
  activateMobilePreset,
  checkExperimentPort,
  createExperiment,
  deleteExperiment,
  diagnoseExperiment,
  fetchExperimentClientJson,
  fetchExperimentDiagnosticReport,
  fetchExperimentPortPlan,
  fetchMobileTestInfo,
  type FirewallOpenDto,
  listExperimentPresets,
  listExperiments,
  listServers,
  patchExperimentNote,
  patchServer,
  type CreateExperimentPayload,
  type ExperimentDto,
  type ExperimentPresetDto,
  type PortCheckDto,
  type PortPlanDto,
  type ServerDto,
} from "../api";

const FP_OPTIONS = ["chrome", "firefox", "safari", "randomized"] as const;
const EXP16_PRESET_ID = "exp16_mobile_working";
const EXP16_DEFAULT_PORT = 444;

const MOBILE_PRESET_IDS = [
  "mobile_reality_tcp_vision",
  "mobile_reality_tcp_no_vision",
  "mobile_reality_grpc",
] as const;

const NOTE_OPTIONS: { v: "" | "works" | "fail" | "partial"; label: string }[] = [
  { v: "", label: "—" },
  { v: "works", label: "работает" },
  { v: "partial", label: "частично" },
  { v: "fail", label: "не работает" },
];

const DIAG_LEGEND = [
  "Нет входящих подключений — клиент не дошёл до сервера (блок IP/порт или Xray не слушает порт).",
  "Клиент дошёл до сервера — TCP есть, смотрите handshake / access log.",
  "Есть accepted-запросы — VPN пропускает трафик.",
  "failed to read client hello — проблема REALITY/TLS ClientHello.",
  "received request, но сайты не работают — проверьте DNS / MTU / routing.",
];

export default function ExperimentsPage({ onLogout }: { onLogout: () => void }) {
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [presets, setPresets] = useState<ExperimentPresetDto[]>([]);
  const [rows, setRows] = useState<ExperimentDto[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logHighlights, setLogHighlights] = useState<string[][]>([]);
  const [portPlan, setPortPlan] = useState<PortPlanDto | null>(null);
  const [portCheck, setPortCheck] = useState<PortCheckDto | null>(null);
  const [mobileInfo, setMobileInfo] = useState<{
    mobile_warning: string;
    honest_test_hint: string;
    options: string[];
  } | null>(null);

  const [serverId, setServerId] = useState<number | "">("");
  const [name, setName] = useState("EXP-тест");
  const [presetId, setPresetId] = useState("mobile_reality_tcp_vision");
  const [useExp16Template, setUseExp16Template] = useState(false);
  const [forceNon443, setForceNon443] = useState(false);
  const [customPort, setCustomPort] = useState("8443");
  const [exp16Port, setExp16Port] = useState(String(EXP16_DEFAULT_PORT));
  const [lastFirewall, setLastFirewall] = useState<FirewallOpenDto | null>(null);
  const [network, setNetwork] = useState<"tcp" | "ws" | "grpc">("tcp");
  const [security, setSecurity] = useState<"reality" | "tls" | "none">("reality");
  const [flow, setFlow] = useState("xtls-rprx-vision");
  const [fingerprint, setFingerprint] = useState("firefox");
  const [serverName, setServerName] = useState("www.apple.com");
  const [queryStrategy, setQueryStrategy] = useState<"UseIP" | "UseIPv4">("UseIPv4");
  const [sniffQuic, setSniffQuic] = useState(false);
  const [dnsMode, setDnsMode] = useState<"default" | "proxy" | "no_direct_dns">("no_direct_dns");
  const [muxEnabled, setMuxEnabled] = useState(false);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const selectedServer = useMemo(
    () => (serverId ? servers.find((s) => s.id === serverId) : undefined),
    [servers, serverId],
  );
  const active443OnServer = useMemo(
    () => (serverId ? rows.find((r) => r.server_id === serverId && r.active_on_443) : null),
    [rows, serverId],
  );

  const refresh = useCallback(async () => {
    const [{ experiments }, presetRes, s, mInfo] = await Promise.all([
      listExperiments(),
      listExperimentPresets(),
      listServers(),
      fetchMobileTestInfo().catch(() => null),
    ]);
    setRows(experiments);
    setPresets(presetRes.presets);
    setServers(s);
    if (mInfo) setMobileInfo(mInfo);
    if (!serverId && s.length) setServerId(s.find((x) => x.experimental_only)?.id ?? s.find((x) => x.vless_deployed)?.id ?? s[0]!.id);
  }, [serverId]);

  useEffect(() => {
    refresh().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, [refresh]);

  useEffect(() => {
    if (!serverId) {
      setPortPlan(null);
      return;
    }
    const port = useExp16Template
      ? Number(exp16Port) || EXP16_DEFAULT_PORT
      : forceNon443
        ? Number(customPort) || 8443
        : 443;
    void fetchExperimentPortPlan(Number(serverId), port)
      .then(setPortPlan)
      .catch(() => setPortPlan(null));
  }, [serverId, forceNon443, customPort, useExp16Template, exp16Port]);

  useEffect(() => {
    if (!selected?.sub_url) {
      setQrUrl(null);
      return;
    }
    void QRCode.toDataURL(selected.sub_url, { width: 220, margin: 1 }).then(setQrUrl).catch(() => setQrUrl(null));
  }, [selected?.sub_url]);

  function applyPreset(id: string) {
    const p = presets.find((x) => x.id === id);
    if (!p?.defaults) return;
    const d = p.defaults as Record<string, unknown>;
    setPresetId(id);
    if (d.network) setNetwork(d.network as "tcp" | "ws" | "grpc");
    if (d.security) setSecurity(d.security as "reality" | "tls" | "none");
    if (d.flow !== undefined) setFlow(String(d.flow));
    if (d.fingerprint) setFingerprint(String(d.fingerprint));
    if (d.server_name) setServerName(String(d.server_name));
    if (d.query_strategy) setQueryStrategy(d.query_strategy as "UseIP" | "UseIPv4");
    if (d.sniff_quic !== undefined) setSniffQuic(Boolean(d.sniff_quic));
    if (d.dns_mode) setDnsMode(d.dns_mode as typeof dnsMode);
    if (d.mux_enabled !== undefined) setMuxEnabled(Boolean(d.mux_enabled));
    if (d.port) setExp16Port(String(d.port));
  }

  function toggleExp16Template(checked: boolean) {
    setUseExp16Template(checked);
    if (checked) {
      setName("EXP-16 mobile working clone");
      applyPreset(EXP16_PRESET_ID);
      setForceNon443(false);
      setExp16Port(String(EXP16_DEFAULT_PORT));
    }
  }

  const exp16PortNum = Number(exp16Port) || EXP16_DEFAULT_PORT;
  const exp16PortWarning =
    useExp16Template && exp16PortNum !== EXP16_DEFAULT_PORT
      ? "Рабочий шаблон был проверен на порту 444. При смене порта результат может отличаться."
      : null;

  function buildPayload(overrides?: Partial<CreateExperimentPayload>): CreateExperimentPayload {
    const port = useExp16Template
      ? exp16PortNum
      : forceNon443
        ? Number(customPort) || 8443
        : 443;
    const pid = useExp16Template ? EXP16_PRESET_ID : presetId === "custom" ? "custom" : presetId;
    return {
      name: name.trim() || (useExp16Template ? "EXP-16 mobile working clone" : "EXP-тест"),
      server_id: Number(serverId),
      preset_id: pid,
      port,
      network,
      security,
      flow: flow.trim() || undefined,
      fingerprint,
      server_name: serverName.trim(),
      query_strategy: queryStrategy,
      sniff_quic: sniffQuic,
      dns_mode: dnsMode,
      mux_enabled: muxEnabled,
      log_level: "warning",
      force_non_443: forceNon443 || undefined,
      ...overrides,
    };
  }

  async function onCreate() {
    if (!serverId) return;
    setBusy(true);
    setMsg(null);
    try {
      const exp = await createExperiment(buildPayload());
      setSelectedId(exp.id);
      setPortCheck(exp.deploy_post_check ?? null);
      setLastFirewall(exp.firewall_open ?? null);
      await refresh();
      const warn = exp.port_warning ? ` ${exp.port_warning}` : "";
      const fw = exp.firewall_open;
      const fwNote = fw
        ? fw.opened
          ? ` Firewall: ${fw.detail}`
          : ` Firewall: ${fw.detail}${fw.manual_command ? ` Команда: ${fw.manual_command}` : ""}`
        : "";
      const diag = exp.deploy_post_check?.diag_status ? ` ${exp.deploy_post_check.diag_status}` : "";
      setMsg({ type: "ok", text: `Эксперимент «${exp.name}» создан (порт ${exp.port}).${warn}${fwNote}${diag}` });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onActivateMobile(preset: string) {
    if (!serverId) return;
    setBusy(true);
    setMsg(null);
    try {
      const exp = await activateMobilePreset(Number(serverId), preset);
      setSelectedId(exp.id);
      setPortCheck(null);
      await refresh();
      setMsg({
        type: "ok",
        text: `Активен пресет на 443: ${presets.find((p) => p.id === preset)?.label ?? preset}`,
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleExperimentalOnly(checked: boolean) {
    if (!serverId) return;
    setBusy(true);
    try {
      await patchServer(Number(serverId), { experimental_only: checked });
      await refresh();
      setMsg({
        type: "ok",
        text: checked
          ? "Сервер помечен как «только эксперименты» — на 443 можно свободно тестировать."
          : "Флаг «только эксперименты» снят.",
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm("Удалить эксперимент и inbound EXP-* на сервере? Продакшен не затрагивается.")) return;
    setBusy(true);
    try {
      await deleteExperiment(id);
      if (selectedId === id) {
        setSelectedId(null);
        setPortCheck(null);
      }
      await refresh();
      setMsg({ type: "ok", text: "Эксперимент удалён." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onDiagnose(id: number) {
    setBusy(true);
    try {
      const r = await diagnoseExperiment(id);
      setLogLines(r.logs.lines);
      setLogHighlights(r.logs.highlights);
      setSelectedId(id);
      await refresh();
      setMsg({ type: "ok", text: r.logs.status });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onPortCheck(id: number) {
    setBusy(true);
    try {
      const r = await checkExperimentPort(id);
      setPortCheck(r);
      setSelectedId(id);
      setMsg({
        type: r.ok ? "ok" : "err",
        text: r.diag_status || (r.ok ? "Проверка порта пройдена." : "Есть проблемы с портом — см. детали ниже."),
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onCopyReport(id: number) {
    setBusy(true);
    try {
      const { text } = await fetchExperimentDiagnosticReport(id);
      await navigator.clipboard.writeText(text);
      setMsg({ type: "ok", text: "Диагностический отчёт скопирован." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text).then(
      () => setMsg({ type: "ok", text: "Скопировано." }),
      () => setMsg({ type: "err", text: "Не удалось скопировать." }),
    );
  }

  function downloadConfig(exp: ExperimentDto) {
    const blob = new Blob([`${exp.vless_uri}\n\n${exp.sub_url}\n`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exp.name.replace(/[^\w.-]+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadClientJson(exp: ExperimentDto) {
    setBusy(true);
    try {
      const { json } = await fetchExperimentClientJson(exp.id);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${exp.name.replace(/[^\w.-]+/g, "_")}-client.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ type: "ok", text: "JSON скачан." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const mobileWarning =
    mobileInfo?.mobile_warning ??
    "Тесты на портах кроме 443 не доказывают, что протокол не работает. Мобильный оператор может блокировать сам порт. Для честного теста используйте 443 на отдельном IP/сервере или через SNI routing.";

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="page-head">
        <h1>Экспериментальные настройки</h1>
        <p className="muted page-sub">
          Отдельные inbound EXP-*, подписка /api/exp-sub/… — рабочие пользователи и подписки не изменяются.
        </p>
      </div>

      <div className="banner banner--warn experiments-mobile-warn">{mobileWarning}</div>

      {msg ? <div className={`banner banner--${msg.type}`}>{msg.text}</div> : null}

      <div className="card stack-sm experiments-honest">
        <h2 className="h3">Честный мобильный тест</h2>
        <p className="muted">{mobileInfo?.honest_test_hint ?? "Лучший тест — только порт 443."}</p>
        {mobileInfo?.options?.length ? (
          <ul className="experiments-honest-list muted">
            {mobileInfo.options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        ) : null}
        <p className="muted">
          На сервере с флагом «только эксперименты» одновременно активен один inbound на 443 — при смене пресета
          старый EXP на 443 снимается автоматически.
        </p>
        <label className="field experiments-exp-only">
          <span className="field-label">Сервер для теста</span>
          <select value={serverId} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">—</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.experimental_only ? "🧪 " : ""}
                {s.name || s.host} ({s.host})
              </option>
            ))}
          </select>
        </label>
        {selectedServer ? (
          <label className="experiments-toggles">
            <input
              type="checkbox"
              checked={Boolean(selectedServer.experimental_only)}
              disabled={busy}
              onChange={(e) => void toggleExperimentalOnly(e.target.checked)}
            />
            Только эксперименты (experimental only) — свободный 443 для тестов
          </label>
        ) : null}
        {portPlan ? (
          <div className={`experiments-port-plan ${portPlan.can_use_443 ? "" : "experiments-port-plan--warn"}`}>
            <strong>Порт {portPlan.requested_port}</strong> на {portPlan.host}
            {portPlan.listen_ip ? ` (${portPlan.listen_ip})` : ""}:{" "}
            {portPlan.can_use_443 ? "можно использовать 443" : "443 занят или недоступен"}
            {portPlan.warning ? <div className="err-text">{portPlan.warning}</div> : null}
            {!portPlan.honest_mobile_test_possible && portPlan.requested_port === 443 ? (
              <div className="muted">
                {portPlan.mobile_test_hint}
                {portPlan.port_443_blockers.length > 0 ? (
                  <ul>
                    {portPlan.port_443_blockers.map((b) => (
                      <li key={b.tag}>
                        {b.tag} — {b.port}/{b.protocol}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {active443OnServer ? (
          <p className="ok-text">
            Активен на 443: <strong>{active443OnServer.name}</strong> ({active443OnServer.preset_id})
          </p>
        ) : null}
        <div className="experiments-actions">
          {MOBILE_PRESET_IDS.map((pid) => {
            const p = presets.find((x) => x.id === pid);
            return (
              <button
                key={pid}
                type="button"
                className="btn"
                disabled={busy || !serverId || !selectedServer?.experimental_only}
                title={
                  selectedServer?.experimental_only
                    ? undefined
                    : "Включите «только эксперименты» на сервере или используйте отдельный тестовый хост"
                }
                onClick={() => void onActivateMobile(pid)}
              >
                {p?.label?.replace(/^Preset [A-C] — /, "") ?? pid}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card stack-sm experiments-form">
        <h2 className="h3">Ручной эксперимент</h2>
        <label className="experiments-toggles experiments-exp16-flag">
          <input
            type="checkbox"
            checked={useExp16Template}
            onChange={(e) => toggleExp16Template(e.target.checked)}
          />
          <span>
            <strong>Использовать рабочий мобильный шаблон EXP-16</strong>
            <span className="muted" style={{ display: "block", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              VLESS TCP REALITY Vision, port 444, fingerprint firefox, SNI www.apple.com, QUIC off, mux off.
            </span>
          </span>
        </label>
        <div className="experiments-form-grid">
          <label className="field">
            <span className="field-label">Сервер</span>
            <select value={serverId} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.experimental_only ? "🧪 " : ""}
                  {s.name || s.host} ({s.host})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Название</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Пресет</span>
            <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id.includes("deprecated")}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Свои параметры</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Порт</span>
            {useExp16Template ? (
              <>
                <input
                  value={exp16Port}
                  onChange={(e) => setExp16Port(e.target.value)}
                  style={{ marginTop: "0.35rem" }}
                />
                {exp16PortWarning ? (
                  <div className="banner banner--warn" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                    {exp16PortWarning}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
                    Рабочий шаблон проверен на порту 444.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="muted">По умолчанию 443 (мобильный тест)</div>
                <label className="experiments-toggles" style={{ marginTop: "0.35rem" }}>
                  <input type="checkbox" checked={forceNon443} onChange={(e) => setForceNon443(e.target.checked)} />
                  Нечестный тест: порт ≠ 443
                </label>
                {forceNon443 ? (
                  <input
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    style={{ marginTop: "0.35rem" }}
                    placeholder="8443"
                  />
                ) : null}
                {forceNon443 ? (
                  <div className="banner banner--warn" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                    Этот порт может блокироваться мобильными операторами. Для честного теста нужен 443.
                  </div>
                ) : null}
              </>
            )}
          </label>
          <label className="field">
            <span className="field-label">Сеть</span>
            <select value={network} onChange={(e) => setNetwork(e.target.value as typeof network)}>
              <option value="tcp">tcp</option>
              <option value="ws">ws</option>
              <option value="grpc">grpc</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Security</span>
            <select value={security} onChange={(e) => setSecurity(e.target.value as typeof security)}>
              <option value="reality">reality</option>
              <option value="tls">tls (+ сертификат)</option>
              <option value="none">none</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Flow</span>
            <select value={flow} onChange={(e) => setFlow(e.target.value)}>
              <option value="xtls-rprx-vision">xtls-rprx-vision</option>
              <option value="">none</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Fingerprint</span>
            <select value={fingerprint} onChange={(e) => setFingerprint(e.target.value)}>
              {FP_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">SNI / serverName</span>
            <input value={serverName} onChange={(e) => setServerName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">queryStrategy</span>
            <select value={queryStrategy} onChange={(e) => setQueryStrategy(e.target.value as typeof queryStrategy)}>
              <option value="UseIPv4">UseIPv4</option>
              <option value="UseIP">UseIP</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">DNS mode</span>
            <select value={dnsMode} onChange={(e) => setDnsMode(e.target.value as typeof dnsMode)}>
              <option value="default">default</option>
              <option value="proxy">proxy DNS</option>
              <option value="no_direct_dns">direct DNS disabled</option>
            </select>
          </label>
        </div>
        <div className="experiments-toggles">
          <label>
            <input type="checkbox" checked={sniffQuic} onChange={(e) => setSniffQuic(e.target.checked)} /> sniffing QUIC
          </label>
          <label>
            <input type="checkbox" checked={muxEnabled} onChange={(e) => setMuxEnabled(e.target.checked)} /> mux
          </label>
        </div>
        <div className="experiments-actions">
          <button type="button" className="btn" disabled={busy || !serverId} onClick={() => void onCreate()}>
            Создать эксперимент
          </button>
        </div>
      </div>

      <div className="card experiments-diag-legend">
        <h2 className="h3">Как читать диагностику</h2>
        <ul className="muted">
          {DIAG_LEGEND.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="h3">Эксперименты</h2>
        <div className="table-wrap">
          <table className="data-table experiments-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Порт</th>
                <th>Сеть</th>
                <th>fp</th>
                <th>flow</th>
                <th>SNI</th>
                <th>Статус</th>
                <th>Диагностика</th>
                <th>Заметка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted">
                    Нет экспериментов
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={selectedId === r.id ? "experiments-row--active" : ""}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => setSelectedId(r.id)}>
                        {r.name}
                        {r.active_on_443 ? " · 443" : ""}
                      </button>
                      {r.port_warning ? (
                        <div className="err-text" style={{ fontSize: "0.7rem" }}>
                          {r.port_warning}
                        </div>
                      ) : null}
                    </td>
                    <td>{r.port}</td>
                    <td>
                      {r.network}/{r.security}
                    </td>
                    <td>{r.fingerprint}</td>
                    <td>{r.flow || "—"}</td>
                    <td>{r.server_name_sni}</td>
                    <td>
                      <span className={r.status === "deployed" ? "ok-text" : r.status === "failed" ? "err-text" : ""}>
                        {r.status}
                      </span>
                      {r.deploy_error ? (
                        <div className="muted" style={{ fontSize: "0.72rem" }}>
                          {r.deploy_error}
                        </div>
                      ) : null}
                    </td>
                    <td className="muted" style={{ fontSize: "0.75rem", maxWidth: "14rem" }}>
                      {r.diag_status || "—"}
                    </td>
                    <td>
                      <select
                        value={r.user_note}
                        onChange={(e) =>
                          void patchExperimentNote(r.id, e.target.value as "" | "works" | "fail" | "partial").then(refresh)
                        }
                      >
                        {NOTE_OPTIONS.map((o) => (
                          <option key={o.v || "empty"} value={o.v}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => void onDiagnose(r.id)}>
                        Логи
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <div className="card experiments-detail stack-sm">
          <h2 className="h3">{selected.name}</h2>
          <p className="muted">
            Inbound: <code>{selected.inbound_tag}</code> · UUID: {selected.vless_uuid_masked} · pbk:{" "}
            {selected.reality_pbk_masked}
            {selected.active_on_443 ? " · активен на 443" : ""}
          </p>
          <p>
            <strong>{selected.diag_status || "Диагностика не запускалась"}</strong>
          </p>
          {selected.port_warning ? <p className="err-text">{selected.port_warning}</p> : null}
          <div className="experiments-detail-actions">
            <button type="button" className="btn btn-secondary" onClick={() => copyText(selected.sub_url)}>
              Скопировать ссылку
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => copyText(selected.vless_uri)}>
              Скопировать VLESS
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => downloadConfig(selected)}>
              Скачать конфиг
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void downloadClientJson(selected)}>
              Скачать JSON
            </button>
            <button type="button" className="btn" onClick={() => void onDiagnose(selected.id)}>
              Обновить логи
            </button>
            <button type="button" className="btn" onClick={() => void onPortCheck(selected.id)}>
              Проверить серверный порт
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onCopyReport(selected.id)}>
              Скопировать диагностический отчёт
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void onDelete(selected.id)}>
              Удалить эксперимент
            </button>
          </div>
          {lastFirewall && selectedId === selected.id ? (
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              Firewall ({lastFirewall.kind}): {lastFirewall.detail}
              {lastFirewall.manual_command && !lastFirewall.opened ? (
                <div>
                  <code>{lastFirewall.manual_command}</code>
                </div>
              ) : null}
              {lastFirewall.cloud_security_group_hint ? <div>{lastFirewall.cloud_security_group_hint}</div> : null}
            </div>
          ) : null}
          {portCheck && selectedId === selected.id ? (
            <div className="experiments-port-check">
              <h3 className="h4">Проверка порта {portCheck.host}:{portCheck.port}</h3>
              {portCheck.diag_status ? <p><strong>{portCheck.diag_status}</strong></p> : null}
              <ul>
                {portCheck.checks.map((c) => (
                  <li key={c.name} className={c.ok ? "ok-text" : "err-text"}>
                    {c.name}: {c.detail}
                  </li>
                ))}
              </ul>
              {portCheck.firewall_hint ? <p className="muted">{portCheck.firewall_hint}</p> : null}
              {portCheck.cloud_security_group_hint ? (
                <p className="banner banner--warn" style={{ fontSize: "0.85rem" }}>
                  {portCheck.cloud_security_group_hint}
                </p>
              ) : null}
            </div>
          ) : null}
          {qrUrl ? (
            <div className="experiments-qr">
              <img src={qrUrl} alt="QR подписки эксперимента" width={220} height={220} />
              <p className="muted" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                {selected.sub_url}
              </p>
            </div>
          ) : null}
          {logLines.length > 0 ? (
            <div className="xray-log-body">
              {logLines.map((line, i) => {
                const kinds = logHighlights[i] ?? [];
                const cls = kinds.map((k) => `xray-log-hl-${k}`).join(" ");
                return (
                  <div key={i} className={cls ? `xray-log-line ${cls}` : "xray-log-line"}>
                    {line}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </DashboardLayout>
  );
}
