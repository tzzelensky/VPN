import { useEffect, useState } from "react";

const SLOGANS = [
  "Ютуб без лагов",
  "Стабильные сервера",
  "Низкий пинг",
  "Обход блокировок",
  "Защита ваших данных",
  "Работает везде",
  "Подключение за минуту",
];

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

type Props = { theme?: "dark" | "light" };

export default function MySubLoadingScreen({ theme = "dark" }: Props) {
  const [percent, setPercent] = useState(0);
  const [sloganIdx, setSloganIdx] = useState(() => Math.floor(Math.random() * SLOGANS.length));

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const sec = (Date.now() - start) / 1000;
      setPercent(Math.min(92, Math.round(100 * (1 - Math.exp(-sec / 2.4)))));
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSloganIdx((i) => (i + 1) % SLOGANS.length);
    }, 800);
    return () => window.clearInterval(id);
  }, []);

  const offset = RING_C * (1 - percent / 100);

  return (
    <div className={`mysub-loading-screen mysub-loading-screen--progress${theme === "light" ? " mysub-loading-screen--light" : ""}`} aria-live="polite">
      <div className="mysub-load-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <svg className="mysub-load-progress__svg" viewBox="0 0 100 100" aria-hidden>
          <defs>
            <linearGradient id="mysub-load-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#62a8ff" />
              <stop offset="100%" stopColor="#64e1aa" />
            </linearGradient>
          </defs>
          <circle className="mysub-load-progress__track" cx="50" cy="50" r={RING_R} />
          <circle
            className="mysub-load-progress__fill"
            cx="50"
            cy="50"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="mysub-load-progress__pct">{percent}%</span>
      </div>
      <p className="mysub-load-slogan" key={sloganIdx}>
        {SLOGANS[sloganIdx]}
      </p>
    </div>
  );
}
