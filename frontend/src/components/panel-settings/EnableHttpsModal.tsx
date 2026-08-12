import { useEffect, useRef, useState } from "react";
import AdminModalBackdrop from "../AdminModalBackdrop";
import { enablePanelHttps, fetchPanelHttpsStatus, type PanelHttpsStatusDto } from "../../api";

type Phase = "idle" | "prepare" | "cert" | "nginx" | "done" | "error";

const PHASES: { id: Phase; label: string }[] = [
  { id: "prepare", label: "Подготовка" },
  { id: "cert", label: "Сертификат" },
  { id: "nginx", label: "Nginx" },
  { id: "done", label: "Готово" },
];

export default function EnableHttpsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<PanelHttpsStatusDto | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [httpsUrl, setHttpsUrl] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!open) return;
    setPhase("idle");
    setMessage("");
    setHttpsUrl(null);
    setLoadingStatus(true);
    void fetchPanelHttpsStatus()
      .then((s) => {
        setStatus(s);
        if (s.httpsUrl) setHttpsUrl(s.httpsUrl);
      })
      .catch((e) => setMessage(String(e)))
      .finally(() => setLoadingStatus(false));
  }, [open]);

  useEffect(() => {
    return () => {
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
    };
  }, []);

  if (!open) return null;

  const busy = phase === "prepare" || phase === "cert" || phase === "nginx";
  const phaseOrder = ["prepare", "cert", "nginx", "done"] as const;
  const activeIdx = phaseOrder.indexOf(phase as (typeof phaseOrder)[number]);

  async function start() {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
    setMessage("");
    setPhase("prepare");
    setMessage("Готовим сервер и ACME…");
    timersRef.current.push(
      window.setTimeout(() => {
        setPhase("cert");
        setMessage("Запрашиваем сертификат Let's Encrypt…");
      }, 1800),
    );
    timersRef.current.push(
      window.setTimeout(() => {
        setPhase((p) => (p === "done" || p === "error" ? p : "nginx"));
        setMessage((m) => (m.toLowerCase().includes("ошиб") ? m : "Настраиваем Nginx и cookie…"));
      }, 8000),
    );
    try {
      const r = await enablePanelHttps(status?.domain ?? undefined);
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
      setPhase("done");
      setHttpsUrl(r.httpsUrl);
      setMessage(r.message || "HTTPS подключён.");
      setStatus((s) =>
        s
          ? {
              ...s,
              httpsEnabled: true,
              certExists: true,
              canEnable: false,
              httpsUrl: r.httpsUrl,
              message: r.message,
            }
          : s,
      );
    } catch (e) {
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
      setPhase("error");
      setMessage(String(e));
    }
  }

  return (
    <AdminModalBackdrop
      className="https-enable-backdrop"
      onClose={busy ? undefined : onClose}
      escapeEnabled={!busy}
    >
      <div className="modal https-enable-modal" role="dialog" aria-modal="true" aria-labelledby="https-enable-title">
        <div className="https-enable-modal__glow" aria-hidden />
        <div className="modal-head https-enable-modal__head">
          <div>
            <p className="https-enable-modal__eyebrow">Безопасность</p>
            <h2 id="https-enable-title">HTTPS‑шифрование</h2>
          </div>
          <button
            type="button"
            className="ghost modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="https-enable-modal__body">
          {loadingStatus ? (
            <div className="https-enable-loader">
              <span className="https-enable-spinner" />
              <p>Проверяем текущий статус…</p>
            </div>
          ) : (
            <>
              <div className="https-enable-hero">
                <div className="https-enable-lock" aria-hidden>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                </div>
                <div className="https-enable-hero__content">
                  <p className="https-enable-hero__title">
                    {status?.httpsEnabled
                      ? "Соединение уже защищено"
                      : "Подключите шифрование для панели"}
                  </p>
                  {!status?.httpsEnabled ? (
                    <p className="https-enable-hero__lead">
                      Бесплатный сертификат Let&apos;s Encrypt для домена панели.
                    </p>
                  ) : null}
                </div>
              </div>

              {status?.domain || status?.httpsUrl ? (
                <dl className="https-enable-meta">
                  {status?.domain ? (
                    <div className="https-enable-meta__row">
                      <dt>Домен</dt>
                      <dd>{status.domain}</dd>
                    </div>
                  ) : null}
                  {status?.httpsUrl ? (
                    <div className="https-enable-meta__row">
                      <dt>URL</dt>
                      <dd>{status.httpsUrl}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {phase !== "idle" ? (
                <div className={`https-enable-progress https-enable-progress--${phase}`}>
                  {busy ? (
                    <div className="https-enable-loader https-enable-loader--inline">
                      <span className="https-enable-spinner" />
                      <p>{message || "Подключаем…"}</p>
                    </div>
                  ) : (
                    <p className="https-enable-progress__msg">{message}</p>
                  )}
                  {phase !== "error" ? (
                    <ol className="https-enable-steps">
                      {PHASES.map((step, idx) => {
                        const done = activeIdx > idx || phase === "done";
                        const current = phaseOrder[idx] === phase;
                        return (
                          <li
                            key={step.id}
                            className={`https-enable-steps__item${done ? " is-done" : ""}${
                              current ? " is-current" : ""
                            }`}
                          >
                            {step.label}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </div>
              ) : (
                <p className="https-enable-hint">{status?.message}</p>
              )}

              {phase === "done" && httpsUrl ? (
                <a className="https-enable-cta primary" href={httpsUrl}>
                  Открыть защищённую панель
                </a>
              ) : null}
            </>
          )}
        </div>

        <div className="https-enable-modal__footer">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            {phase === "done" ? "Закрыть" : "Отмена"}
          </button>
          {!status?.httpsEnabled && phase !== "done" ? (
            <button
              type="button"
              className="primary"
              disabled={busy || loadingStatus || !status?.canEnable}
              onClick={() => void start()}
            >
              {busy ? "Подключение…" : "Подключить HTTPS"}
            </button>
          ) : null}
        </div>
      </div>
    </AdminModalBackdrop>
  );
}
