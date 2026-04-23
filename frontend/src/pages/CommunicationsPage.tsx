import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import {
  listCommunicationTargets,
  sendCommunication,
  type CommunicationTargetDto,
  type SendCommunicationResult,
} from "../api";

type Mode = "global" | "single";
const MAX_REQUEST_IMAGE_BYTES = 750_000;

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Не удалось прочитать файл"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(file);
  });
}

function dataUrlApproxBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось обработать изображение"));
    img.src = dataUrl;
  });
}

async function prepareCompressedPhoto(file: File): Promise<{ base64: string; mime: string; name: string; note: string }> {
  const original = await fileToDataUrl(file);
  if (dataUrlApproxBytes(original) <= MAX_REQUEST_IMAGE_BYTES) {
    return { base64: original, mime: file.type || "image/jpeg", name: file.name || "photo.jpg", note: "" };
  }

  const img = await loadImageFromDataUrl(original);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось подготовить фото");

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const maxSide = 1280;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  let best = canvas.toDataURL("image/jpeg", 0.78);
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) {
    best = canvas.toDataURL("image/jpeg", 0.62);
  }
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) {
    canvas.width = Math.max(1, Math.round(w * 0.78));
    canvas.height = Math.max(1, Math.round(h * 0.78));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    best = canvas.toDataURL("image/jpeg", 0.58);
  }
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) {
    throw new Error("Фото слишком большое. Выберите изображение меньшего размера.");
  }

  const cleanName = (file.name || "photo")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 64);
  return {
    base64: best,
    mime: "image/jpeg",
    name: `${cleanName || "photo"}-compressed.jpg`,
    note: "Фото было автоматически сжато для отправки через сервер.",
  };
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
  const [photoNotice, setPhotoNotice] = useState("");

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
    setPhotoNotice("");
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
        const prepared = await prepareCompressedPhoto(photo);
        photoBase64 = prepared.base64;
        photoMime = prepared.mime;
        photoName = prepared.name;
        setPhotoNotice(prepared.note);
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
        {photoNotice ? <div className="flash ok">{photoNotice}</div> : null}
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
