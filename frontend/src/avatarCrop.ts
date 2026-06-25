export const AVATAR_CROP_VIEWPORT = 280;
export const AVATAR_CROP_OUTPUT = 256;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение."));
    img.src = src;
  });
}

export function getBaseCoverScale(imgW: number, imgH: number, viewport: number): number {
  return Math.max(viewport / imgW, viewport / imgH);
}

export function renderAvatarCrop(
  img: HTMLImageElement,
  opts: { viewport: number; outputSize: number; zoom: number; offsetX: number; offsetY: number },
): { dataUrl: string; mime: string } {
  const { viewport, outputSize, zoom, offsetX, offsetY } = opts;
  const baseScale = getBaseCoverScale(img.naturalWidth, img.naturalHeight, viewport) * zoom;
  const ratio = outputSize / viewport;

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
  ctx.clip();

  const dw = img.naturalWidth * baseScale * ratio;
  const dh = img.naturalHeight * baseScale * ratio;
  const dx = outputSize / 2 - dw / 2 + offsetX * ratio;
  const dy = outputSize / 2 - dh / 2 + offsetY * ratio;
  ctx.drawImage(img, dx, dy, dw, dh);

  let dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  if (dataUrl.length > 4_000_000) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.75);
  }
  return { dataUrl, mime: "image/jpeg" };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}
