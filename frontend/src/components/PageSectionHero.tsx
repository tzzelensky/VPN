import { useId, useState, type ReactNode } from "react";

export type PageHelpCard = {
  kicker: string;
  title: string;
  text: string;
};

function HelpInfoIcon() {
  return (
    <svg className="page-help-toggle__icon" viewBox="0 0 20 20" width="15" height="15" aria-hidden>
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="6.6" r="1.05" fill="currentColor" />
      <path
        d="M10 9.2v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HelpChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`page-help-toggle__chevron${open ? " is-open" : ""}`}
      viewBox="0 0 12 12"
      width="11"
      height="11"
      aria-hidden
    >
      <path
        d="M2.5 4.25L6 7.75l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PageSectionHero({
  title,
  helpCards,
  actions,
  children,
  className,
}: {
  title: string;
  helpCards: PageHelpCard[];
  actions?: ReactNode;
  /** Extra content under the help panel (flash, loaders, etc.). */
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section className={`panel page-hero${className ? ` ${className}` : ""}`}>
      <div className="page-hero__top">
        <div className="page-hero__title-row">
          <h1 className="page-hero__title">{title}</h1>
          {helpCards.length > 0 ? (
            <button
              type="button"
              className={`page-help-toggle${open ? " is-open" : ""}`}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
            >
              <HelpInfoIcon />
              <span className="page-help-toggle__label">Справка</span>
              <HelpChevron open={open} />
            </button>
          ) : null}
        </div>
        {actions ? <div className="page-hero__actions">{actions}</div> : null}
      </div>

      {helpCards.length > 0 ? (
        <div
          id={panelId}
          className={`page-help-panel${open ? " is-open" : ""}`}
          aria-hidden={!open}
        >
          <div className="page-help-grid">
            {helpCards.map((card) => (
              <article key={`${card.kicker}-${card.title}`} className="page-help-card">
                <div className="page-help-card__kicker">{card.kicker}</div>
                <h3 className="page-help-card__title">{card.title}</h3>
                <p className="page-help-card__text">{card.text}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {children}
    </section>
  );
}
