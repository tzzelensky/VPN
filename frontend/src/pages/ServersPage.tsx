import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  addServer,
  addServerToAllSubscriptions,
  deleteServer,
  deployVlessStream,
  installXrayStream,
  listServers,
  patchServer,
  type NdjsonEvent,
  type ServerDto,
  testServerStream,
} from "../api";
import DashboardLayout from "../components/DashboardLayout";
import LiveLogPanel, { type LogLine } from "../components/LiveLogPanel";
import ServerCard, { type ServerBusyAction } from "../components/ServerCard";
import ServerSubscriptionSettingsPanel from "../components/ServerSubscriptionSettingsPanel";
import { COUNTRY_CODES_ALPHA2, countryCodeLabel } from "../countryCodes";
import { countryFlagEmoji } from "../flagEmoji";

export default function ServersPage({ onLogout }: { onLogout: () => void }) {
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activity, setActivity] = useState<{ title: string; lines: LogLine[] } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<ServerBusyAction>(null);

  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [host, setHost] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [sshPass, setSshPass] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [vlessPort, setVlessPort] = useState("8443");
  const [subSettingsServer, setSubSettingsServer] = useState<ServerDto | null>(null);

  const refresh = useCallback(async () => {
    const s = await listServers();
    setServers(s);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, [refresh]);

  function appendLog(line: string) {
    setActivity((a) =>
      a ? { ...a, lines: [...a.lines, { msg: line }] } : { title: "Журнал", lines: [{ msg: line }] },
    );
  }

  function handleNdjson(_title: string, ev: NdjsonEvent): boolean {
    if (ev.type === "log") {
      appendLog(ev.msg);
      return false;
    }
    if (ev.type === "error") {
      appendLog(`Ошибка: ${ev.message}`);
      setMsg({ type: "err", text: ev.message });
      return true;
    }
    if (ev.type === "done") {
      if (ev.ok === false && ev.detail) {
        appendLog(ev.detail);
        setMsg({ type: "err", text: ev.detail });
      } else if (ev.detail) {
        appendLog(ev.detail);
        setMsg({ type: "ok", text: ev.detail });
      } else {
        appendLog("Готово.");
        setMsg({ type: "ok", text: "Операция завершена." });
      }
      return true;
    }
    return false;
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await addServer({
        name: name || undefined,
        country_code: countryCode || undefined,
        host: host.trim(),
        ssh_user: sshUser.trim(),
        ssh_password: sshPass,
        ssh_port: Number(sshPort) || 22,
        vless_port: Number(vlessPort) || 8443,
      });
      setHost("");
      setSshPass("");
      setName("");
      setCountryCode("");
      await refresh();
      setMsg({ type: "ok", text: "Сервер добавлен." });
    } catch (err) {
      setMsg({ type: "err", text: String(err) });
    }
  }

  async function runServerStream(
    serverId: number,
    action: ServerBusyAction,
    title: string,
    run: (emit: (ev: NdjsonEvent) => void) => Promise<void>,
  ) {
    setMsg(null);
    setBusyId(serverId);
    setBusyAction(action);
    setActivity({ title, lines: [] });
    let finished = false;
    try {
      await run((ev) => {
        if (handleNdjson(title, ev)) finished = true;
      });
      if (!finished) appendLog("(поток завершён без финального события)");
    } catch (e) {
      const t = String(e);
      appendLog(t);
      setMsg({ type: "err", text: t });
    } finally {
      setBusyId(null);
      setBusyAction(null);
      await refresh();
    }
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel" style={{ marginBottom: "1.25rem" }}>
        <h1>Сервера</h1>
        <p className="sub">
          SSH к VPS, проверка, установка Xray, развёртывание VLESS (inbound с тегом <span className="mono">tzadmin-vless</span>).
          Имя и страна попадают в подписку клиентов (флаг + название узла).
        </p>

        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
        {activity ? <LiveLogPanel title={activity.title} lines={activity.lines} /> : null}

        <form onSubmit={onAdd}>
          <div className="grid grid-2">
            <div>
              <label>Название в подписке</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, HSN-VPN" />
            </div>
            <div>
              <label>Страна (флаг)</label>
              <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                <option value="">Без флага</option>
                {COUNTRY_CODES_ALPHA2.map((code) => (
                  <option key={code} value={code}>
                    {countryFlagEmoji(code)} {countryCodeLabel(code)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>IP или домен</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" required />
            </div>
            <div>
              <label>SSH пользователь</label>
              <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} required />
            </div>
            <div>
              <label>SSH пароль</label>
              <input
                type="password"
                value={sshPass}
                onChange={(e) => setSshPass(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label>SSH порт</label>
              <input value={sshPort} onChange={(e) => setSshPort(e.target.value)} />
            </div>
            <div>
              <label>Порт VLESS</label>
              <input value={vlessPort} onChange={(e) => setVlessPort(e.target.value)} />
            </div>
          </div>
          <div className="row-actions">
            <button className="primary" type="submit">
              Добавить сервер
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h1 style={{ fontSize: "1.1rem" }}>Список</h1>
        {servers.length === 0 ? (
          <p className="sub" style={{ marginBottom: 0 }}>
            Пока нет серверов — заполните форму выше.
          </p>
        ) : (
          <div className="server-card-grid">
            {servers.map((s) => (
              <ServerCard
                key={s.id}
                server={s}
                disabled={busyId === s.id}
                busyAction={busyId === s.id ? busyAction : null}
                onNotify={(type, text) => setMsg({ type, text })}
                onSave={async (newName, cc) => {
                  setMsg(null);
                  setBusyId(s.id);
                  setBusyAction("save");
                  try {
                    await patchServer(s.id, { name: newName, country_code: cc });
                    setMsg({ type: "ok", text: "Имя и страна сервера сохранены. Клиентам обновите подписку." });
                    await refresh();
                  } finally {
                    setBusyId(null);
                    setBusyAction(null);
                  }
                }}
                onOpenSubscriptionSettings={() => setSubSettingsServer(s)}
                onTestSsh={() =>
                  void runServerStream(s.id, "ssh", `SSH: ${s.host}`, async (emit) => {
                    await testServerStream(s.id, emit);
                  })
                }
                onInstallXray={() =>
                  void runServerStream(s.id, "xray", `Установка Xray: ${s.host}`, async (emit) => {
                    await installXrayStream(s.id, emit);
                  })
                }
                onDeployVless={() =>
                  void runServerStream(s.id, "vless", `VLESS: ${s.host}`, async (emit) => {
                    await deployVlessStream(s.id, emit);
                  })
                }
                onAddToAllSubscriptions={() => {
                  const n = s.subscription_users_missing ?? 0;
                  if (
                    !window.confirm(
                      `Добавить «${s.name || s.host}» в подписку у ${n} клиент${n === 1 ? "а" : n < 5 ? "ов" : "ов"}?`,
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    setBusyId(s.id);
                    setBusyAction("addSubs");
                    setMsg(null);
                    try {
                      const r = await addServerToAllSubscriptions(s.id);
                      await refresh();
                      setMsg({
                        type: "ok",
                        text:
                          r.updated_users > 0
                            ? `Сервер добавлен в подписки (${r.updated_users} клиент${r.updated_users === 1 ? "" : "ов"}).`
                            : "Сервер уже был во всех подписках.",
                      });
                    } catch (e) {
                      setMsg({ type: "err", text: String(e) });
                    } finally {
                      setBusyId(null);
                      setBusyAction(null);
                    }
                  })();
                }}
                onDelete={async () => {
                  await deleteServer(s.id);
                  await refresh();
                }}
              />
            ))}
          </div>
        )}
      </section>

      {subSettingsServer ? (
        <ServerSubscriptionSettingsPanel
          server={subSettingsServer}
          onClose={() => setSubSettingsServer(null)}
          onSaved={(srv) => {
            setServers((rows) => rows.map((r) => (r.id === srv.id ? srv : r)));
          }}
          onToast={(type, text) => setMsg({ type, text })}
        />
      ) : null}
    </DashboardLayout>
  );
}
