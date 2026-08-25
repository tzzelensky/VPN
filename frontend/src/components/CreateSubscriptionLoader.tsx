type Props = {
  title?: string;
  subtitle?: string;
};

/** Animated status card while a client/subscription is being created in the background. */
export default function CreateSubscriptionLoader({
  title = "Создаём подписку",
  subtitle = "Настраиваем доступ и синхронизируем с серверами…",
}: Props) {
  return (
    <div className="create-sub-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="create-sub-loader__glow" aria-hidden />
      <div className="create-sub-loader__orb" aria-hidden>
        <span className="create-sub-loader__ring create-sub-loader__ring--a" />
        <span className="create-sub-loader__ring create-sub-loader__ring--b" />
        <span className="create-sub-loader__ring create-sub-loader__ring--c" />
        <span className="create-sub-loader__core">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
            <path
              d="M7 8.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 1.6-.9 3-2.3 3.8L12 14l-2.7-1.7C7.9 11.5 7 10.1 7 8.5Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 16.5h5M10.5 19h3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
      <div className="create-sub-loader__copy">
        <div className="create-sub-loader__title">
          {title}
          <span className="create-sub-loader__dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
        <p className="create-sub-loader__sub">{subtitle}</p>
        <div className="create-sub-loader__track" aria-hidden>
          <span className="create-sub-loader__bar" />
        </div>
      </div>
    </div>
  );
}
