type Props = {
  label?: string;
  className?: string;
};

/** Единый индикатор первичной загрузки страницы панели. */
export default function PageLoadingState({
  label = "Загрузка данных…",
  className = "",
}: Props) {
  return (
    <div className={`page-loading ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
      <div className="page-loading__center">
        <div className="page-loading__spinner" aria-hidden />
        <span className="page-loading__label">{label}</span>
        <span className="page-loading__dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
