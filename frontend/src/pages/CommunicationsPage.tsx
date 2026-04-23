import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import {
  listCommunicationTargets,
  sendCommunication,
  type CommunicationTargetDto,
  type SendCommunicationResult,
} from "../api";

type Mode = "global" | "single";

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Не удалось прочитать файл"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(file);
  });
}

export default function CommunicationsPage({ onLogout }: { onLogout: () => void }) {
  const [targets, setTargets] = useState<CommunicationTargetDto[]>([]);
  const [mode, setMode] = useState<Mode>("global");
  const [userId, setUserId] = useState<number>(0);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<SendCommunicationResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await listCommunicationTargets();
        setTargets(data.users);
      } catch (e) {
        setMsg({ type: "err", text: String(e) });
      }
    })();
  }, []);

  const reachable = useMemo(() => {
    return targets.filter((u) => Number.isFinite(Number(u.tg_id)) && Number(u.tg_id) > 0);
  }, [targets]);

  async function submit() {
    setMsg(null);
    setLastResult(null);
    const cleanText = text.trim();
    if (!cleanText) {
      setMsg({ type: "err", text: "Введите текст сообщения." });
      return;
    }
    if (mode === "single" && (!userId || userId <= 0)) {
      setMsg({ type: "err", text: "Выберите клиента." });
      return;
    }

    setBusy(true);
    try {
      let photoBase64 = "";
      let photoMime = "";
      let photoName = "";
      if (photo) {
        photoBase64 = await fileToDataUrl(photo);
        photoMime = photo.type || "image/jpeg";
        photoName = photo.name || "photo.jpg";
      }
      const result = await sendCommunication({
        mode,
        text: cleanText,
        ...(mode === "single" ? { user_id: userId } : {}),
        ...(photoBase64
          ? {
              photo_base64: photoBase64,
              photo_mime: photoMime,
              photo_name: photoName,
            }
          : {}),
      });
      setLastResult(result);
      if (result.ok) {
        setMsg({
          type: "ok",
          text:
            mode === "global"
              ? `Глобальная рассылка завершена: ${result.sent}/${result.attempted}.`
              : `Сообщение отправлено: ${result.sent}/${result.attempted}.`,
        });
      } else {
        setMsg({
          type: "err",
          text: `Отправка завершена с ошибками: ${result.sent}/${result.attempted}, ошибок: ${result.failed}.`,
        });
      }
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <h1>Коммуникации</h1>
        <p className="sub users-hero-sub">
          Рассылка в Telegram: глобально всем клиентам или точечно выбранному клиенту. Можно прикрепить фото.
        </p>
        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
      </section>

      <section className="panel comms-panel">
        <div className="comms-mode-row">
          <button
            type="button"
            className={mode === "global" ? "primary" : "ghost"}
            disabled={busy}
            onClick={() => setMode("global")}
          >
            Глобально всем клиентам
          </button>
          <button
            type="button"
            className={mode === "single" ? "primary" : "ghost"}
            disabled={busy}
            onClick={() => setMode("single")}
          >
            Сообщение выбранному клиенту
          </button>
        </div>

        {mode === "single" ? (
          <div className="form-field" style={{ marginTop: "0.9rem" }}>
            <label>Клиент</label>
            <select
              value={userId > 0 ? String(userId) : ""}
              disabled={busy}
              onChange={(e) => setUserId(Number(e.target.value) || 0)}
            >
              <option value="">Выберите клиента</option>
              {reachable.map((u) => (
                <option key={u.id} value={u.id}>
                  #{u.id} {u.name} ({u.enable ? "вкл" : "выкл"})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="sub" style={{ marginTop: "0.9rem", marginBottom: "0.6rem" }}>
            Будет отправлено по {reachable.length} Telegram chat id.
          </p>
        )}

        <div className="form-field">
          <label>Текст сообщения</label>
          <textarea
            className="comms-textarea"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            placeholder="Введите сообщение для отправки..."
          />
        </div>

        <div className="form-field" style={{ marginTop: "0.8rem" }}>
          <label>Фото (опционально)</label>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <p className="field-hint">{photo ? `Выбрано: ${photo.name}` : "Фото не выбрано."}</p>
        </div>

        <div className="row-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Отправка..." : "Отправить"}
          </button>
        </div>

        {lastResult && lastResult.failures.length > 0 ? (
          <div className="comms-failures">
            <h3>Ошибки доставки</h3>
            <ul>
              {lastResult.failures.map((f) => (
                <li key={`${f.user_id}:${f.error}`}>
                  #{f.user_id} {f.user_name}: {f.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </DashboardLayout>
  );
}
