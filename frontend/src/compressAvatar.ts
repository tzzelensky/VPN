/** Сжимает изображение перед отправкой (обход лимита nginx на JSON body). */
export async function compressImageForAvatar(
  file: File,
  maxSide = 256,
  quality = 0.82,
): Promise<{ dataUrl: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, quality);
  if (dataUrl.length > 4_000_000) {
    const jpeg = canvas.toDataURL("image/jpeg", 0.75);
    return { dataUrl: jpeg, mime: "image/jpeg" };
  }
  return { dataUrl, mime };
}

function dataUrlApproxBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Сжатие под лимит nginx client_max_body_size (часто 1m).
 * Цель: decoded ~500KB → base64+JSON < 1MB.
 */
export async function compressImageForPanelUpload(
  file: File,
  opts?: { maxSide?: number; maxBytes?: number },
): Promise<{ dataUrl: string; mime: string }> {
  const maxSide = opts?.maxSide ?? 1280;
  const maxBytes = opts?.maxBytes ?? 500_000;
  const bitmap = await createImageBitmap(file);
  let w = bitmap.width;
  let h = bitmap.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas_unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
  if (dataUrlApproxBytes(dataUrl) > maxBytes) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.62);
  }
  if (dataUrlApproxBytes(dataUrl) > maxBytes) {
    canvas.width = Math.max(1, Math.round(w * 0.75));
    canvas.height = Math.max(1, Math.round(h * 0.75));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bmp2 = await createImageBitmap(file);
    ctx.drawImage(bmp2, 0, 0, canvas.width, canvas.height);
    bmp2.close();
    dataUrl = canvas.toDataURL("image/jpeg", 0.55);
  }
  if (dataUrlApproxBytes(dataUrl) > maxBytes) {
    throw new Error("Фото слишком большое даже после сжатия. Выберите файл поменьше.");
  }
  return { dataUrl, mime: "image/jpeg" };
}
