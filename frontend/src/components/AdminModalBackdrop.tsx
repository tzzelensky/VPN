import { type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
};

/** Модалка поверх всей админки (сайдбар, drawer). Рендер в document.body. */
export default function AdminModalBackdrop({ children, className, ...rest }: Props) {
  return createPortal(
    <div className={`modal-backdrop modal-backdrop--admin ${className ?? ""}`.trim()} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
