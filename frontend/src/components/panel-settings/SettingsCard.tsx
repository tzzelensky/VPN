import type { ReactNode } from "react";

export default function SettingsCard({
  title,
  sub,
  children,
  collapsible,
  open,
  onToggle,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  if (collapsible) {
    return (
      <section className="panel-settings-card">
        <button
          type="button"
          className="panel-settings-card__head panel-settings-card__head--toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="panel-settings-card__titles">
            <span className="panel-settings-card__title">{title}</span>
            {sub ? <span className="panel-settings-card__sub">{sub}</span> : null}
          </span>
          <span className="panel-settings-card__chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
        {open ? <div className="panel-settings-card__body">{children}</div> : null}
      </section>
    );
  }

  return (
    <section className="panel-settings-card">
      <div className="panel-settings-card__head">
        <span className="panel-settings-card__titles">
          <span className="panel-settings-card__title">{title}</span>
          {sub ? <span className="panel-settings-card__sub">{sub}</span> : null}
        </span>
      </div>
      <div className="panel-settings-card__body">{children}</div>
    </section>
  );
}
