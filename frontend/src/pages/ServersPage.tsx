import { useCallback, useEffect, useState } from "react";
import {
  addServerToAllSubscriptions,
  removeServerFromAllSubscriptions,
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
import AddServerModal from "../components/AddServerModal";
import LiveLogPanel, { type LogLine } from "../components/LiveLogPanel";
import ServerCard, { type ServerBusyAction } from "../components/ServerCard";
import ServerSubscriptionSettingsPanel from "../components/ServerSubscriptionSettingsPanel";

export default function ServersPage({ onLogout }: { onLogout: () => void }) {
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activity, setActivity] = useState<{ title: string; lines: LogLine[] } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<ServerBusyAction>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
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
        <div className="servers-page-head">
          <div>
            <h1>Сервера</h1>
            <p className="sub servers-page-head__sub">
              SSH к VPS, проверка, установка Xray, развёртывание VLESS. Имя и страна отображаются у клиентов в
              подписке.
            </p>
          </div>
          <button type="button" className="primary servers-page-head__add" onClick={() => setAddModalOpen(true)}>
            Добавить сервер
          </button>
        </div>

        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
        {activity ? <LiveLogPanel title={activity.title} lines={activity.lines} /> : null}
      </section>

      <section className="panel">
        <h1 style={{ fontSize: "1.1rem" }}>Список</h1>
        {servers.length === 0 ? (
          <p className="sub" style={{ marginBottom: 0 }}>
            Пока нет серверов — нажмите «Добавить сервер».
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
                onRemoveFromAllSubscriptions={() => {
                  const total = s.subscription_users_total ?? 0;
                  const missing = s.subscription_users_missing ?? 0;
                  const n = Math.max(0, total - missing);
                  if (
                    !window.confirm(
                      `Убрать «${s.name || s.host}» из подписок у ${n} клиент${n === 1 ? "а" : n < 5 ? "ов" : "ов"}? Остальные узлы в подписках сохранятся.`,
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    setBusyId(s.id);
                    setBusyAction("removeSubs");
                    setMsg(null);
                    try {
                      const r = await removeServerFromAllSubscriptions(s.id);
                      await refresh();
                      setMsg({
                        type: "ok",
                        text:
                          r.updated_users > 0
                            ? `Сервер убран из подписок (${r.updated_users} клиент${r.updated_users === 1 ? "" : "ов"}).`
                            : "Сервер уже не был ни в одной подписке.",
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

      <AddServerModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={refresh}
        onToast={(type, text) => setMsg({ type, text })}
      />
    </DashboardLayout>
  );
}
