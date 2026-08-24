import { useEffect, useState } from "react";
import { panelBuiltAtMs, panelVersionLabel } from "../panelVersion";

const EKB_TZ = "Asia/Yekaterinburg";

function formatEkbDateTime(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: EKB_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

function formatEkbDate(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: EKB_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(ts));
}

type Props = {
  brandName: string;
};

export default function AdminPageFooter({ brandName }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const builtAt = panelBuiltAtMs();
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: EKB_TZ, year: "numeric" }).format(new Date(now));

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
          <span className="admin-page-footer__meta-value">{panelVersionLabel()}</span>
        </li>
        <li>
          <span className="admin-page-footer__meta-label">Екатеринбург</span>
          <time className="admin-page-footer__meta-value" dateTime={new Date(now).toISOString()}>
            {formatEkbDateTime(now)}
          </time>
        </li>
        <li>
          <span className="admin-page-footer__meta-label">Обновление панели</span>
          <time className="admin-page-footer__meta-value" dateTime={new Date(builtAt).toISOString()}>
            {formatEkbDate(builtAt)}
          </time>
        </li>
      </ul>
    </footer>
  );
}
