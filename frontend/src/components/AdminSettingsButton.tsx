import type { SVGProps } from "react";

function IconGear(p: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

type Props = {
  onClick: () => void;
  /** icon — только иконка; full — кнопка с текстом «Настройки» */
  variant?: "icon" | "full";
  className?: string;
};

export default function AdminSettingsButton({ onClick, variant = "full", className }: Props) {
  if (variant === "icon") {
    return (
      <button
        type="button"
        className={`admin-settings-btn ghost ${className ?? ""}`.trim()}
        aria-label="Настройки панели"
        title="Настройки"
        onClick={onClick}
      >
        <IconGear />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`admin-settings-btn admin-settings-btn--full ghost ${className ?? ""}`.trim()}
      aria-label="Настройки панели"
      title="Настройки панели"
      onClick={onClick}
    >
      <IconGear />
      <span>Настройки</span>
    </button>
  );
}
