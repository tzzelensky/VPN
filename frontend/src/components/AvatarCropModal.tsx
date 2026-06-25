import { useCallback, useEffect, useRef, useState } from "react";
import {
  AVATAR_CROP_OUTPUT,
  AVATAR_CROP_VIEWPORT,
  getBaseCoverScale,
  loadImage,
  readFileAsDataUrl,
  renderAvatarCrop,
} from "../avatarCrop";

type Props = {
  open: boolean;
  initialSrc: string | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (dataUrl: string, mime: string) => void | Promise<void>;
};

export default function AvatarCropModal({ open, initialSrc, busy, onClose, onSave }: Props) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetTransform = useCallback(() => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  }, []);

  useEffect(() => {
    if (!open) {
      setImageSrc(null);
      setImgEl(null);
      setLoadErr(null);
      resetTransform();
      return;
    }
    if (!initialSrc) return;
    let cancelled = false;
    setLoadErr(null);
    void loadImage(initialSrc)
      .then((img) => {
        if (cancelled) return;
        setImageSrc(initialSrc);
        setImgEl(img);
        resetTransform();
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialSrc, resetTransform]);

  async function onPickFile(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setLoadErr("Исходный файл больше 5 МБ.");
      return;
    }
    setLoadErr(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const img = await loadImage(dataUrl);
      setImageSrc(dataUrl);
      setImgEl(img);
      resetTransform();
    } catch (e) {
      setLoadErr(String(e));
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!imgEl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffsetX(drag.ox + (e.clientX - drag.x));
    setOffsetY(drag.oy + (e.clientY - drag.y));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  async function handleSave() {
    if (!imgEl) return;
    try {
      const { dataUrl, mime } = renderAvatarCrop(imgEl, {
        viewport: AVATAR_CROP_VIEWPORT,
        outputSize: AVATAR_CROP_OUTPUT,
        zoom,
        offsetX,
        offsetY,
      });
      await onSave(dataUrl, mime);
    } catch (e) {
      setLoadErr(String(e));
    }
  }

  if (!open) return null;

  const baseScale = imgEl
    ? getBaseCoverScale(imgEl.naturalWidth, imgEl.naturalHeight, AVATAR_CROP_VIEWPORT) * zoom
    : 1;
  const displayW = imgEl ? imgEl.naturalWidth * baseScale : 0;
  const displayH = imgEl ? imgEl.naturalHeight * baseScale : 0;
  const imgLeft = AVATAR_CROP_VIEWPORT / 2 - displayW / 2 + offsetX;
  const imgTop = AVATAR_CROP_VIEWPORT / 2 - displayH / 2 + offsetY;

  return (
    <div
      className="modal-backdrop modal-backdrop--nested avatar-crop-backdrop"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal modal--sm avatar-crop-modal" role="dialog" aria-labelledby="avatar-crop-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="avatar-crop-title">Аватарка</h2>
          <button type="button" className="modal-close ghost" onClick={onClose} disabled={busy} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="modal-body avatar-crop-body">
          <p className="avatar-crop-hint">Перетащите изображение и настройте масштаб, чтобы выровнять его по кругу.</p>
          {loadErr ? <div className="flash err">{loadErr}</div> : null}
          <div
            className="avatar-crop-viewport"
            style={{ width: AVATAR_CROP_VIEWPORT, height: AVATAR_CROP_VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {imgEl && imageSrc ? (
              <img
                src={imageSrc}
                alt=""
                className="avatar-crop-image"
                draggable={false}
                style={{
                  width: displayW,
                  height: displayH,
                  left: imgLeft,
                  top: imgTop,
                }}
              />
            ) : (
              <div className="avatar-crop-empty">Выберите изображение</div>
            )}
            <div className="avatar-crop-ring" aria-hidden />
          </div>
          <label className="avatar-crop-zoom">
            <span>Масштаб</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              disabled={!imgEl || busy}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="panel-avatar-file-input"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
        <div className="modal-footer avatar-crop-footer">
          <button type="button" className="ghost" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            Выбрать файл
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn" disabled={!imgEl || busy} onClick={() => void handleSave()}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
