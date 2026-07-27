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

export async function prepareCompressedPhoto(
  file: File,
): Promise<{ base64: string; mime: string; name: string; note: string }> {
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
