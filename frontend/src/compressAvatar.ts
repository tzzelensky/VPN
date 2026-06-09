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
