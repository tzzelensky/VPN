import { useEffect, useState } from "react";
import { panelLastDeployAtMs, panelVersionLabel } from "../panelVersion";
import { usePanelSettings } from "../panelSettingsContext";

const DEFAULT_TZ = "Asia/Yekaterinburg";

const TZ_CITY_LABEL: Record<string, string> = {
  "Asia/Yekaterinburg": "Екатеринбург",
  "Europe/Moscow": "Москва",
  "Asia/Yerevan": "Ереван",
};

function cityLabelForTimezone(timeZone: string): string {
  return TZ_CITY_LABEL[timeZone] || timeZone;
}

function formatPanelDateTime(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

type Props = {
  brandName: string;
};

export default function AdminPageFooter({ brandName }: Props) {
  const panel = usePanelSettings();
  const timeZone = panel.settings?.ui.timezone?.trim() || DEFAULT_TZ;
  const cityLabel = cityLabelForTimezone(timeZone);

  const [now, setNow] = useState(() => Date.now());
  const lastDeployAt = panelLastDeployAtMs();
  const lastDeployLabel = formatPanelDateTime(lastDeployAt, timeZone);
  const year = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(new Date(now));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const brand = brandName.trim() || "Сервис";

  return (
    <footer className="admin-page-footer" role="contentinfo">
      <p className="admin-page-footer__copy">
        © {year} {brand}. Все права защищены.
      </p>
      <ul className="admin-page-footer__meta">
        <li>
          <span className="admin-page-footer__meta-label">Версия</span>
          <span
            className="admin-page-footer__meta-value admin-page-footer__version"
            title={`Последнее обновление: ${lastDeployLabel} (${cityLabel})`}
          >
            {panelVersionLabel()}
          </span>
        </li>
        <li>
          <span className="admin-page-footer__meta-label">{cityLabel}</span>
          <time className="admin-page-footer__meta-value" dateTime={new Date(now).toISOString()}>
            {formatPanelDateTime(now, timeZone)}
          </time>
        </li>
        <li>
          <span className="admin-page-footer__meta-label">Обновление панели</span>
          <time
            className="admin-page-footer__meta-value"
            dateTime={new Date(lastDeployAt).toISOString()}
            title={`Последнее обновление: ${lastDeployLabel} (${cityLabel})`}
          >
            {lastDeployLabel}
          </time>
        </li>
      </ul>
    </footer>
  );
}
