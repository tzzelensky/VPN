import { getPanelSettings } from "./panelSettings.js";

/** Публичное имя бренда для заголовков/пушей/WebApp (без хардкода «HSN VPN»). */
export function publicBrandName(fallback = "Сервис"): string {
  const brand = getPanelSettings().panel.brandName.trim();
  return brand || fallback;
}
