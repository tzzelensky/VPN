import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useModalEscape } from "../../hooks/useModalEscape";
import { useMySubPortalRoot } from "../portalContext";
import type { MySubTheme } from "../types";

type Props = {
  open: boolean;
  theme: MySubTheme;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
};

export default function MySubModalBackdrop({
  open,
  theme,
  onClose,
  children,
  className,
  closeOnBackdrop = true,
}: Props) {
  const portalRoot = useMySubPortalRoot();
  useModalEscape(onClose, open);

  if (!open) return null;

  return createPortal(
    <div
      className={`mn-modal-backdrop mn-modal-backdrop--portal mn-modal-backdrop--theme-${theme}${className ? ` ${className}` : ""}`}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      {children}
    </div>,
    portalRoot,
  );
}
