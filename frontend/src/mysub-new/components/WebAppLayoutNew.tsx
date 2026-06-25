import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { MySubNavTabId } from "../../components/MySubBottomNav";
import BottomNavNew from "./BottomNavNew";
import type { BottomNavHandle } from "./bottomNavHandle";
import PullToRefresh from "./PullToRefresh";
import UserHeaderNew from "./UserHeaderNew";
import Toast from "./Toast";
import type { MySubProfileDto } from "../../api";
import type { MySubTheme } from "../types";

type NavItem = {
  id: MySubNavTabId;
  label: string;
  icon: ReactNode;
};

type Props = {
  theme: MySubTheme;
  data: MySubProfileDto;
  subscription: MySubProfileDto["subscriptions"][number] | null;
  tab: MySubNavTabId;
  hideNav?: boolean;
  toast?: string;
  toastTone?: "ok" | "err";
  onToastDismiss?: () => void;
  navItems: NavItem[];
  onTabChange: (tab: MySubNavTabId) => void;
  onRefresh?: () => Promise<void>;
  refreshDisabled?: boolean;
  navRef?: React.RefObject<BottomNavHandle | null>;
  headerShellRef?: React.MutableRefObject<HTMLDivElement | null>;
  contentRef?: React.MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
};

export default function WebAppLayoutNew({
  theme,
  data,
  subscription,
  tab,
  hideNav,
  toast,
  toastTone = "ok",
  onToastDismiss,
  navItems,
  onTabChange,
  onRefresh,
  refreshDisabled,
  navRef: navRefProp,
  headerShellRef,
  contentRef,
  children,
}: Props) {
  const navRefLocal = useRef<BottomNavHandle | null>(null);
  const navRef = navRefProp ?? navRefLocal;
  const headerShellLocalRef = useRef<HTMLDivElement | null>(null);
  const contentLocalRef = useRef<HTMLDivElement | null>(null);

  const bindHeaderShell = (el: HTMLDivElement | null) => {
    headerShellLocalRef.current = el;
    if (headerShellRef) headerShellRef.current = el;
  };

  const bindContent = (el: HTMLDivElement | null) => {
    contentLocalRef.current = el;
    if (contentRef) contentRef.current = el;
  };

  useLayoutEffect(() => {
    const shell = headerShellLocalRef.current;
    if (!shell) return;
    const inner = shell.querySelector(".mn-user-header") as HTMLElement | null;
    if (!inner) return;
    const h = `${inner.offsetHeight}px`;
    shell.style.setProperty("--mn-header-max", h);
    contentLocalRef.current?.style.setProperty("--mn-header-max", h);
  }, [data.name, data.avatar_url, subscription?.id, subscription?.stats.subscription_active]);

  const content = (
    <>
      <div className="mn-app__bg" aria-hidden />
      <div ref={bindContent} className="mn-app__content">
        <div ref={bindHeaderShell} className="mn-user-header-shell">
          <UserHeaderNew data={data} subscription={subscription} />
        </div>
        <main className="mn-main">{children}</main>
      </div>
    </>
  );

  return (
    <div className={`mn-app mn-app--${theme}${theme === "light" ? " mysub-wrap--light" : ""}`}>
      {onRefresh ? (
        <PullToRefresh onRefresh={onRefresh} disabled={refreshDisabled}>
          {content}
        </PullToRefresh>
      ) : (
        content
      )}
      {!hideNav ? <BottomNavNew ref={navRef as React.Ref<BottomNavHandle>} items={navItems} active={tab} onChange={onTabChange} /> : null}
      {toast && onToastDismiss ? <Toast message={toast} tone={toastTone} onDismiss={onToastDismiss} /> : null}
    </div>
  );
}
