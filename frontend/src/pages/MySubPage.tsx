import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { loadMySubProfile, type MySubProfileDto } from "../api";

type Tab = "stats" | "subs";

export default function MySubPage() {
  const { tgId } = useParams();
  const tgNum = Number(tgId);
  const [data, setData] = useState<MySubProfileDto | null>(null);
  const [tab, setTab] = useState<Tab>("stats");
  const [pickedSubId, setPickedSubId] = useState<number>(0);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    void (async () => {
      setErr("");
      if (!Number.isFinite(tgNum) || tgNum <= 0) {
        setErr("Некорректный tg id.");
        return;
      }
      try {
        const profile = await loadMySubProfile(Math.floor(tgNum));
        setData(profile);
        if (profile.subscriptions.length === 1) {
          setPickedSubId(profile.subscriptions[0]!.id);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [tgNum]);

  const pickedSub = useMemo(() => {
    if (!data) return null;
    return data.subscriptions.find((s) => s.id === pickedSubId) ?? null;
  }, [data, pickedSubId]);

  async function copySubscription(url: string) {
    setMsg("");
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Ссылка скопирована.");
    } catch {
      setMsg("Не удалось скопировать автоматически. Скопируйте вручную.");
    }
  }

  return (
    <div className="mysub-wrap">
      <div className="mysub-card">
        {err ? <div className="flash err">{err}</div> : null}
        {!err && !data ? <div className="sub">Загрузка…</div> : null}
        {data ? (
          <>
            <div className="mysub-head">
              {data.avatar_url ? (
                <img src={data.avatar_url} alt="avatar" className="mysub-avatar" />
              ) : (
                <div className="mysub-avatar-fallback">{(data.name || "U").trim().slice(0, 1).toUpperCase()}</div>
              )}
              <h1 className="mysub-name">{data.name}</h1>
            </div>

            {tab === "stats" ? (
              <section className="mysub-section">
                <div className="mysub-html" dangerouslySetInnerHTML={{ __html: data.stats_html }} />
              </section>
            ) : (
              <section className="mysub-section">
                {data.subscriptions.length > 1 ? (
                  <div className="form-field">
                    <label>Выберите подписку</label>
                    <select value={pickedSubId > 0 ? String(pickedSubId) : ""} onChange={(e) => setPickedSubId(Number(e.target.value) || 0)}>
                      <option value="">Выберите</option>
                      {data.subscriptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {pickedSub ? (
                  <div className="mysub-sub-box">
                    <p className="sub" style={{ marginBottom: "0.55rem" }}>
                      #{pickedSub.id} {pickedSub.name}
                    </p>
                    <div className="mysub-url">{pickedSub.subscription_url}</div>
                    <div className="row-actions">
                      <button type="button" className="primary" onClick={() => void copySubscription(pickedSub.subscription_url)}>
                        Копировать подписку
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="sub">Выберите подписку, чтобы открыть ссылку.</p>
                )}
              </section>
            )}

            {msg ? <div className="flash ok">{msg}</div> : null}
            <div className="mysub-bottom-actions">
              <button type="button" className={tab === "stats" ? "primary" : "ghost"} onClick={() => setTab("stats")}>
                Статистика по подписке
              </button>
              <button type="button" className={tab === "subs" ? "primary" : "ghost"} onClick={() => setTab("subs")}>
                Подписки
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
