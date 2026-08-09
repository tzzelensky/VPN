import { createContext, useContext, type ReactNode } from "react";

const MySubPortalContext = createContext<HTMLElement | null>(null);

/** Корень для createPortal; в админ-превью — экран телефона, иначе document.body. */
export function MySubPortalProvider({
  root,
  children,
}: {
  root: HTMLElement | null;
  children: ReactNode;
}) {
  return <MySubPortalContext.Provider value={root}>{children}</MySubPortalContext.Provider>;
}

export function useMySubPortalRoot(): HTMLElement {
  const root = useContext(MySubPortalContext);
  if (typeof document === "undefined") {
    return null as unknown as HTMLElement;
  }
  return root ?? document.body;
}
