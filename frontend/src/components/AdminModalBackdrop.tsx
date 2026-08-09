import { type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalEscape } from "../hooks/useModalEscape";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "onClick"> & {
  children: ReactNode;
  className?: string;
  /** Закрытие по Escape (клик по тени не закрывает). */
  onClose?: () => void;
  /** Разрешить Escape (например выключить во время busy). */
  escapeEnabled?: boolean;
};

/** Модалка поверх всей админки (сайдбар, drawer). Рендер в document.body. */
export default function AdminModalBackdrop({
  children,
  className,
  onClose,
  escapeEnabled = true,
  ...rest
}: Props) {
  useModalEscape(onClose, escapeEnabled && Boolean(onClose));

  return createPortal(
    <div className={`modal-backdrop modal-backdrop--admin ${className ?? ""}`.trim()} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
