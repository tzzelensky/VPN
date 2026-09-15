import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addServerToAllSubscriptions,
  removeServerFromAllSubscriptions,
  connectHysteria2Stream,
  connectTrojanStream,
  deleteServer,
  deployVlessStream,
  installXrayStream,
  listServers,
  patchServer,
  setServerVlessInSubscriptions,
  setServerHysteria2InSubscriptions,
  setServerTrojanInSubscriptions,
  type NdjsonEvent,
  type ServerDto,
  testServerStream,
} from "../api";
import DashboardLayout from "../components/DashboardLayout";
import PageLoadingState from "../components/PageLoadingState";
import PageSectionHero from "../components/PageSectionHero";
import AddServerModal from "../components/AddServerModal";
import LiveLogPanel, { type LogLine } from "../components/LiveLogPanel";
import ServerCard, { type ServerBusyAction } from "../components/ServerCard";
import ServerSubscriptionSettingsPanel from "../components/ServerSubscriptionSettingsPanel";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";

function serversKpi(servers: ServerDto[]) {
  let sshOk = 0;
  let sshErr = 0;
  let vless = 0;
  let clients = 0;
  for (const s of servers) {
    if (s.last_ssh_ok) sshOk += 1;
    else if (s.last_error) sshErr += 1;
    if (s.vless_deployed) vless += 1;
    const total = s.subscription_users_total ?? 0;
    const missing = s.subscription_users_missing ?? 0;
    clients += Math.max(0, total - missing);
  }
  return { total: servers.length, sshOk, sshErr, vless, clients };
}

function ServersKpi({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: number;
  loading: boolean;
  tone: "total" | "ok" | "err" | "vless" | "clients";
}) {
  const animated = useAnimatedNumber(loading ? null : value);
  return (
    <div className={`servers-kpi servers-kpi--${tone}`}>
      <span className="servers-kpi__label">{label}</span>
      <span className={`servers-kpi__value${loading ? " servers-kpi__value--skeleton" : ""}`}>
        {loading ? "—" : (animated ?? 0)}
      </span>
    </div>
  );
}

export default function ServersPage({ onLogout }: { onLogout: () => void }) {
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activity, setActivity] = useState<{ title: string; lines: LogLine[] } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<ServerBusyAction>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [subSettingsServer, setSubSettingsServer] = useState<ServerDto | null>(null);

  const refresh = useCallback(async () => {
    const s = await listServers();
    setServers(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, [refresh]);

  const kpi = useMemo(() => serversKpi(servers), [servers]);

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
      <div className="servers-page">
        <PageSectionHero
          title="Серверы"
          helpCards={[
            {
              kicker: "SSH",
              title: "VPS и Xray",
              text: "Подключение по SSH, установка и проверка Xray на серверах панели.",
            },
            {
              kicker: "Протоколы",
              title: "VLESS / HY2 / Trojan",
              text: "Развёртывание протоколов и отображение имени и страны сервера у клиентов.",
            },
            {
              kicker: "Клиенты",
              title: "Подписки",
              text: "Управление тем, какие серверы попадают в VPN-подписки пользователям.",
            },
          ]}
          actions={
            <button type="button" className="primary" onClick={() => setAddModalOpen(true)}>
              Добавить сервер
            </button>
          }
        />

        <div className="servers-kpi-row" aria-label="Сводка по серверам">
          <ServersKpi label="Всего" value={kpi.total} loading={loading} tone="total" />
          <ServersKpi label="SSH OK" value={kpi.sshOk} loading={loading} tone="ok" />
          <ServersKpi label="С ошибкой" value={kpi.sshErr} loading={loading} tone="err" />
          <ServersKpi label="VLESS" value={kpi.vless} loading={loading} tone="vless" />
          <ServersKpi label="В подписках" value={kpi.clients} loading={loading} tone="clients" />
        </div>

        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
        {activity ? <LiveLogPanel title={activity.title} lines={activity.lines} /> : null}

        {loading ? (
          <section className="panel servers-list-shell">
            <PageLoadingState />
          </section>
        ) : servers.length === 0 ? (
          <section className="panel servers-empty">
            <div className="servers-empty__icon" aria-hidden>
              <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="6" y="10" width="36" height="26" rx="4" />
                <path d="M6 18h36" />
                <circle cx="14" cy="14" r="1.2" fill="currentColor" stroke="none" />
                <circle cx="19" cy="14" r="1.2" fill="currentColor" stroke="none" />
                <path d="M16 28h16M20 32h8" strokeLinecap="round" />
              </svg>
            </div>
            <h2 className="servers-empty__title">Пока нет серверов</h2>
            <p className="servers-empty__text">
              Добавьте VPS — панель проверит SSH, поставит Xray и развернёт протоколы для подписки.
            </p>
            <button type="button" className="primary" onClick={() => setAddModalOpen(true)}>
              Добавить сервер
            </button>
          </section>
        ) : (
          <div className="server-card-grid">
            {servers.map((s, index) => (
              <ServerCard
                key={s.id}
                server={s}
                index={index}
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
                onToggleVlessSubscriptions={() => {
                  const enable = !s.vless_in_subscriptions;
                  const msgText = enable
                    ? `Добавить VLESS «${s.name || s.host}» в подписки клиентов, у которых выбран этот сервер?`
                    : `Убрать VLESS «${s.name || s.host}» из подписок? Trojan и Hysteria2 останутся.`;
                  if (!window.confirm(msgText)) return;
                  void (async () => {
                    setBusyId(s.id);
                    setBusyAction("vlessSubs");
                    setMsg(null);
                    try {
                      await setServerVlessInSubscriptions(s.id, enable);
                      await refresh();
                      setMsg({
                        type: "ok",
                        text: enable ? "VLESS добавлен в подписки. Клиентам обновите подписку." : "VLESS убран из подписок.",
                      });
                    } catch (e) {
                      setMsg({ type: "err", text: String(e) });
                    } finally {
                      setBusyId(null);
                      setBusyAction(null);
                    }
                  })();
                }}
                onConnectHysteria2={() =>
                  void runServerStream(s.id, "hysteria2", `Hysteria2: ${s.host}`, async (emit) => {
                    await connectHysteria2Stream(s.id, emit);
                  })
                }
                onToggleHysteria2Subscriptions={() => {
                  const enable = !s.hysteria2_in_subscriptions;
                  const msgText = enable
                    ? `Добавить Hysteria2 «${s.name || s.host}» в подписки клиентов, у которых выбран этот сервер?`
                    : `Убрать Hysteria2 «${s.name || s.host}» из подписок? VLESS останется.`;
                  if (!window.confirm(msgText)) return;
                  void (async () => {
                    setBusyId(s.id);
                    setBusyAction("hy2Subs");
                    setMsg(null);
                    try {
                      await setServerHysteria2InSubscriptions(s.id, enable);
                      await refresh();
                      setMsg({
                        type: "ok",
                        text: enable
                          ? "Hysteria2 добавлен в подписки. Клиентам обновите подписку."
                          : "Hysteria2 убран из подписок.",
                      });
                    } catch (e) {
                      setMsg({ type: "err", text: String(e) });
                    } finally {
                      setBusyId(null);
                      setBusyAction(null);
                    }
                  })();
                }}
                onConnectTrojan={() =>
                  void runServerStream(s.id, "trojan", `Trojan: ${s.host}`, async (emit) => {
                    await connectTrojanStream(s.id, emit);
                  })
                }
                onToggleTrojanSubscriptions={() => {
                  const enable = !s.trojan_in_subscriptions;
                  const msgText = enable
                    ? `Добавить Trojan «${s.name || s.host}» в подписки клиентов, у которых выбран этот сервер?`
                    : `Убрать Trojan «${s.name || s.host}» из подписок? VLESS останется.`;
                  if (!window.confirm(msgText)) return;
                  void (async () => {
                    setBusyId(s.id);
                    setBusyAction("trojanSubs");
                    setMsg(null);
                    try {
                      await setServerTrojanInSubscriptions(s.id, enable);
                      await refresh();
                      setMsg({
                        type: "ok",
                        text: enable
                          ? "Trojan добавлен в подписки. Клиентам обновите подписку."
                          : "Trojan убран из подписок.",
                      });
                    } catch (e) {
                      setMsg({ type: "err", text: String(e) });
                    } finally {
                      setBusyId(null);
                      setBusyAction(null);
                    }
                  })();
                }}
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
      </div>

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
