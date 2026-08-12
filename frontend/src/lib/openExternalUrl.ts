/** Открыть внешнюю ссылку из Telegram WebApp (иначе — обычный браузер). */
export function openExternalUrl(url: string): void {
  const u = String(url ?? "").trim();
  if (!u) return;
  const tg = (window as Window & { Telegram?: { WebApp?: { openLink?: (link: string) => void } } }).Telegram?.WebApp;
  if (typeof tg?.openLink === "function") {
    tg.openLink(u);
    return;
  }
  window.open(u, "_blank", "noopener,noreferrer");
}
