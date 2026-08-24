import { useEffect, useRef, useCallback, useLayoutEffect, useState } from "react";
import MySubProfileStats from "../components/MySubProfileStats";
import type { MySubNavTabId } from "../components/MySubBottomNav";
import WebAppLayoutNew from "./components/WebAppLayoutNew";
import TabSwipeViews from "./components/TabSwipeViews";
import type { BottomNavHandle } from "./components/bottomNavHandle";
import { computeGameHeaderCollapse, type SwipeVisualState } from "./headerCollapse";
import InstructionModal from "./components/InstructionModal";
import MySubTabPanel from "./components/MySubTabPanel";
import PrimaryButton from "./components/PrimaryButton";
import SecondaryButton from "./components/SecondaryButton";
import MySubModalBackdrop from "./components/MySubModalBackdrop";
import PickSubscriptionModal from "./components/PickSubscriptionModal";
import WebAppAdminPanelModal from "./components/WebAppAdminPanelModal";
import type { MySubWebAppController } from "./types";
import { MySubPortalProvider } from "./portalContext";
import { useWebAppAdminPanelEntry } from "./useWebAppAdminPanelEntry";

type Props = { ctrl: MySubWebAppController; embedInAdmin?: boolean };

export default function MySubWebAppNew(props: Props) {
  const [portalMount, setPortalMount] = useState<HTMLElement | null>(null);
  return (
    <MySubPortalProvider root={portalMount}>
      <MySubWebAppNewBody {...props} portalMountRef={setPortalMount} />
    </MySubPortalProvider>
  );
}

function MySubWebAppNewBody({
  ctrl,
  embedInAdmin = false,
  portalMountRef,
}: Props & { portalMountRef: (el: HTMLDivElement | null) => void }) {
  const {
    data,
    err,
    msg,
    setMsg,
    tab,
    setTab,
    theme,
    homeSub,
    dropperPlaying,
    showInstruction,
    setShowInstruction,
    showWhitelistInstruction,
    setShowWhitelistInstruction,
    showPickModal,
    setShowPickModal,
    pickedSubId,
    setPickedSubId,
    copySubscription,
    bottomNavItems,
    supportOpen,
    setSupportOpen,
    supportText,
    setSupportText,
    supportPhotos,
    setSupportPhotos,
    supportBusy,
    submitSupportAppeal,
    dropperPracticeModalOpen,
    setDropperPracticeModalOpen,
    dropperPracticeSkipNextHint,
    setDropperPracticeSkipNextHint,
    confirmDropperPracticePlay,
    dropperInstructionOpen,
    setDropperInstructionOpen,
    profileSubModalId,
    setProfileSubModalId,
    refreshProfile,
  } = ctrl;
  const adminGate = useWebAppAdminPanelEntry(ctrl.initData, embedInAdmin || Boolean(ctrl.previewMode));

  useEffect(() => {
    if (embedInAdmin) return;
    const root = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = root.style.overflowX;
    const prevBodyOverflow = body.style.overflowX;
    root.style.overflowX = "hidden";
    body.style.overflowX = "hidden";

    const tg = (
      window as unknown as {
        Telegram?: { WebApp?: { setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void } };
      }
    ).Telegram?.WebApp;
    if (theme === "light") {
      root.classList.add("mysub-app-light");
      try {
        tg?.setHeaderColor?.("#eef4ff");
        tg?.setBackgroundColor?.("#eef4ff");
      } catch {
        /* ignore */
      }
    } else {
      root.classList.remove("mysub-app-light");
      try {
        tg?.setHeaderColor?.("#0f172a");
        tg?.setBackgroundColor?.("#0b1220");
      } catch {
        /* ignore */
      }
    }
    return () => {
      root.classList.remove("mysub-app-light");
      root.style.overflowX = prevHtmlOverflow;
      body.style.overflowX = prevBodyOverflow;
    };
  }, [theme, embedInAdmin]);

  if (err) {
    return (
      <div className="mn-app mn-app--light">
        <div className="mn-app__content">
          <div className="mn-error">{err}</div>
        </div>
      </div>
    );
  }

  const toastTone = msg.includes("не удалось") || msg.includes("ошиб") ? "err" : "ok";
  const gameIndex = bottomNavItems.findIndex((item) => item.id === "game");
  const headerShellRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headerCollapseRef = useRef(-1);
  const headerDraggingRef = useRef(false);
  const headerSnapRafRef = useRef(0);
  const headerSlotRef = useRef(1);
  const HEADER_SNAP_MS = 260;
  const [pcLayout, setPcLayout] = useState(false);
  const pcLayoutRef = useRef(false);
  pcLayoutRef.current = pcLayout;

  const computeSnapLift = useCallback((collapse: number, start: number, target: number, fromCollapsedSlot: boolean) => {
    const v = Math.max(0, Math.min(1, collapse));
    if (target >= 0.98) {
      if (start <= 0.02) return v;
      const span = 1 - start;
      return span > 0.02 ? Math.max(0, (v - start) / span) : v;
    }
    if (fromCollapsedSlot && start >= 0.98) return v;
    return 0;
  }, []);
  const hideNav = dropperPlaying;
  const swipeDisabled =
    pcLayout ||
    dropperPlaying ||
    supportOpen ||
    showPickModal ||
    profileSubModalId > 0 ||
    showInstruction ||
    showWhitelistInstruction ||
    dropperPracticeModalOpen ||
    dropperInstructionOpen ||
    adminGate.open;
  const refreshDisabled = swipeDisabled;
  const navRef = useRef<BottomNavHandle | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const cancelHeaderSnap = useCallback(() => {
    if (headerSnapRafRef.current) {
      window.cancelAnimationFrame(headerSnapRafRef.current);
      headerSnapRafRef.current = 0;
    }
  }, []);

  const applyHeaderVisual = useCallback(
    (
      collapse: number,
      mode: "drag" | "snap",
      snap?: { start: number; target: number; fromCollapsedSlot: boolean },
    ) => {
      const shell = headerShellRef.current;
      const content = contentRef.current;
      if (!shell) return;
      const v = Math.max(0, Math.min(1, collapse));
      headerCollapseRef.current = v;
      shell.style.setProperty("--mn-header-collapse", String(v));
      shell.setAttribute("aria-hidden", v >= 0.98 ? "true" : "false");

      if (mode === "drag") {
        headerSlotRef.current = 1;
        shell.classList.add("is-header-dragging");
        shell.style.setProperty("--mn-header-slot", "1");
        content?.classList.remove("is-header-lifting");
        content?.style.removeProperty("--mn-header-lift");
        return;
      }

      headerSlotRef.current = 1;
      shell.classList.add("is-header-dragging");
      shell.style.setProperty("--mn-header-slot", "1");
      content?.classList.add("is-header-lifting");
      const lift = snap ? computeSnapLift(v, snap.start, snap.target, snap.fromCollapsedSlot) : v;
      content?.style.setProperty("--mn-header-lift", String(lift));
    },
    [computeSnapLift],
  );

  const finishHeaderSnap = useCallback(
    (target: number) => {
      cancelHeaderSnap();
      const shell = headerShellRef.current;
      const content = contentRef.current;
      if (!shell) return;

      const slot = target >= 0.98 ? 0 : 1;
      headerCollapseRef.current = target;
      headerSlotRef.current = slot;
      shell.style.setProperty("--mn-header-collapse", String(target));
      shell.style.setProperty("--mn-header-slot", String(slot));
      shell.setAttribute("aria-hidden", target >= 0.98 ? "true" : "false");
      shell.classList.remove("is-header-dragging");
      content?.classList.remove("is-header-lifting");
      content?.style.removeProperty("--mn-header-lift");
    },
    [cancelHeaderSnap],
  );

  const easeHeaderSnap = useCallback((t: number) => {
    const u = 1 - t;
    return 1 - u * u * u;
  }, []);

  const animateHeaderSnap = useCallback(
    (forceTab: MySubNavTabId, onComplete?: () => void) => {
      const target = forceTab === "game" ? 1 : 0;
      const start = headerCollapseRef.current < 0 ? target : headerCollapseRef.current;

      const done = () => {
        finishHeaderSnap(target);
        requestAnimationFrame(() => onComplete?.());
      };

      if (Math.abs(target - start) < 0.02) {
        done();
        return;
      }

      cancelHeaderSnap();

      const fromCollapsedSlot = headerSlotRef.current < 0.02;
      const snap = { start, target, fromCollapsedSlot };

      // С игры: слот схлопнут — разворачиваем shell + lift до первого кадра, иначе рывок.
      if (target < start && fromCollapsedSlot) {
        applyHeaderVisual(start, "snap", snap);
      }

      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / HEADER_SNAP_MS);
        applyHeaderVisual(start + (target - start) * easeHeaderSnap(t), "snap", snap);
        if (t < 1) {
          headerSnapRafRef.current = window.requestAnimationFrame(tick);
          return;
        }
        done();
      };
      headerSnapRafRef.current = window.requestAnimationFrame(tick);
    },
    [HEADER_SNAP_MS, applyHeaderVisual, cancelHeaderSnap, easeHeaderSnap, finishHeaderSnap],
  );

  const applyHeaderSettled = useCallback(
    (instant: boolean, forceTab?: MySubNavTabId) => {
      const tabId = forceTab ?? tabRef.current;
      const target = pcLayoutRef.current ? 0 : tabId === "game" ? 1 : 0;
      if (instant || pcLayoutRef.current) {
        finishHeaderSnap(target);
        return;
      }
      animateHeaderSnap(tabId);
    },
    [animateHeaderSnap, finishHeaderSnap],
  );

  const applyHeaderCollapse = useCallback(
    (visual: SwipeVisualState | null, dragging: boolean) => {
      if (pcLayoutRef.current) return;
      const shell = headerShellRef.current;
      if (!shell) return;

      headerDraggingRef.current = dragging;

      if (!dragging || !visual || visual.pageWidth <= 0 || visual.dragPx === 0) {
        return;
      }

      cancelHeaderSnap();

      const collapse = computeGameHeaderCollapse(gameIndex, tabRef.current, visual);
      const rounded = Math.max(0, Math.min(1, collapse));
      if (Math.abs(rounded - headerCollapseRef.current) < 0.004 && shell.classList.contains("is-header-dragging")) {
        return;
      }

      applyHeaderVisual(rounded, "drag");
    },
    [applyHeaderVisual, cancelHeaderSnap, gameIndex],
  );

  const onSwipeVisual = useCallback(
    (visual: SwipeVisualState) => {
      applyHeaderCollapse(visual, true);
    },
    [applyHeaderCollapse],
  );

  const onSwipeEnd = useCallback(() => {
    headerDraggingRef.current = false;
  }, []);

  const onTabTransitionStart = useCallback(
    (toIndex: number, fromIndex: number, onComplete?: () => void) => {
      if (pcLayoutRef.current) {
        onComplete?.();
        return;
      }
      const gameIdx = gameIndex;
      const id = bottomNavItems[toIndex]?.id;
      if (!id) {
        onComplete?.();
        return;
      }

      const involvesGame = gameIdx >= 0 && (toIndex === gameIdx || fromIndex === gameIdx);
      const snapBack = toIndex === fromIndex;
      if (involvesGame || snapBack) {
        animateHeaderSnap(id, onComplete);
        return;
      }
      onComplete?.();
    },
    [animateHeaderSnap, bottomNavItems, gameIndex],
  );

  useLayoutEffect(() => {
    applyHeaderSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcLayout]);

  useEffect(() => () => cancelHeaderSnap(), [cancelHeaderSnap]);

  const renderPanel = useCallback((id: MySubNavTabId) => <MySubTabPanel id={id} ctrl={ctrl} />, [ctrl]);

  return (
    <>
      <WebAppLayoutNew
        theme={theme}
        data={data}
        subscription={homeSub}
        tab={tab}
        headerShellRef={headerShellRef}
        contentRef={contentRef}
        hideNav={hideNav}
        toast={msg}
        toastTone={toastTone}
        onToastDismiss={() => setMsg("")}
        navItems={bottomNavItems}
        onTabChange={setTab}
        onRefresh={embedInAdmin ? undefined : refreshProfile}
        refreshDisabled={embedInAdmin ? true : refreshDisabled}
        navRef={navRef}
        portalMountRef={portalMountRef}
        onAvatarTap={embedInAdmin ? undefined : adminGate.onAvatarTap}
        onPcLayoutChange={setPcLayout}
      >
        <TabSwipeViews
          items={bottomNavItems}
          active={tab}
          onChange={setTab}
          disabled={swipeDisabled}
          navRef={navRef}
          gameIndex={gameIndex}
          onVisualUpdate={onSwipeVisual}
          onSwipeEnd={onSwipeEnd}
          onTabTransitionStart={onTabTransitionStart}
          renderPanel={renderPanel}
        />
      </WebAppLayoutNew>

      <WebAppAdminPanelModal
        open={adminGate.open}
        busy={adminGate.busy}
        theme={theme}
        onConfirm={() => void adminGate.confirm()}
        onCancel={adminGate.cancel}
      />

      <InstructionModal
        open={showInstruction}
        onClose={() => setShowInstruction(false)}
        theme={theme}
        copyUrl={homeSub?.subscription_url}
        onCopyLink={homeSub ? () => void copySubscription(homeSub.subscription_url) : undefined}
      />

      {profileSubModalId > 0 ? (
        <MySubModalBackdrop open theme={theme} onClose={() => setProfileSubModalId(0)}>
          {(() => {
            const s = data.subscriptions.find((x) => x.id === profileSubModalId);
            return (
              <div className="mn-modal mn-modal--solid" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="mn-modal__head">
                  <h2>Подписка</h2>
                  <button type="button" className="mn-modal__close" onClick={() => setProfileSubModalId(0)} aria-label="Закрыть">
                    ×
                  </button>
                </div>
                <div className="mn-modal__body">
                  {!s ? (
                    <p className="mn-muted">Подписка не найдена.</p>
                  ) : (
                    <>
                      <MySubProfileStats subscription={s} whitelist={data.whitelist} />
                      <div className="mn-stack" style={{ marginTop: "0.65rem" }}>
                        <p className="mn-muted" style={{ margin: 0 }}>
                          Срок: {s.expiry_time > 0 ? new Date(s.expiry_time).toLocaleDateString("ru-RU") : "без срока"}
                        </p>
                      </div>
                    </>
                  )}
                </div>
                {s ? (
                  <div className="mn-modal__foot mn-modal__foot--stack">
                    <PrimaryButton fullWidth onClick={() => void copySubscription(s.subscription_url)}>
                      Скопировать ссылку
                    </PrimaryButton>
                    <SecondaryButton fullWidth onClick={() => setProfileSubModalId(0)}>
                      Закрыть
                    </SecondaryButton>
                  </div>
                ) : null}
              </div>
            );
          })()}
        </MySubModalBackdrop>
      ) : null}

      {showWhitelistInstruction && data.whitelist?.instruction ? (
        <MySubModalBackdrop open theme={theme} onClose={() => setShowWhitelistInstruction(false)}>
          <div className="mn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mn-modal__head">
              <h2>{data.whitelist.instruction.title || "Как обновить подписку"}</h2>
              <button type="button" className="mn-modal__close" onClick={() => setShowWhitelistInstruction(false)}>
                ×
              </button>
            </div>
            <div className="mn-modal__body">
              {data.whitelist.instruction.photo_url ? (
                <img src={data.whitelist.instruction.photo_url} alt="" className="mn-modal__photo" />
              ) : null}
              <p className="mn-muted" style={{ whiteSpace: "pre-wrap" }}>
                {data.whitelist.instruction.text}
              </p>
            </div>
            <div className="mn-modal__foot">
              <PrimaryButton fullWidth onClick={() => setShowWhitelistInstruction(false)}>
                Понятно
              </PrimaryButton>
            </div>
          </div>
        </MySubModalBackdrop>
      ) : null}

      <PickSubscriptionModal
        open={showPickModal}
        theme={theme}
        subscriptions={data.subscriptions}
        pickedSubId={pickedSubId}
        onPick={setPickedSubId}
        onClose={() => setShowPickModal(false)}
        onConfirm={() => {
          const sub = data.subscriptions.find((s) => s.id === pickedSubId);
          if (sub) void copySubscription(sub.subscription_url);
          setShowPickModal(false);
        }}
      />

      {supportOpen ? (
        <MySubModalBackdrop
          open
          theme={theme}
          onClose={() => !supportBusy && setSupportOpen(false)}
          closeOnBackdrop={!supportBusy}
        >
              <div className="mn-modal mn-modal--support" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="mn-modal__head">
                  <h2>Сообщить о проблеме</h2>
                  <button type="button" className="mn-modal__close" disabled={supportBusy} onClick={() => setSupportOpen(false)}>
                    ×
                  </button>
                </div>
                <div className="mn-modal__body">
                  <p className="mn-muted" style={{ marginTop: 0 }}>
                    Опишите проблему. При необходимости приложите фото.
                  </p>
                  <textarea
                    className="mn-input mn-textarea"
                    rows={5}
                    value={supportText}
                    onChange={(e) => setSupportText(e.target.value)}
                    placeholder="Что произошло?"
                    maxLength={8000}
                    disabled={supportBusy}
                  />
                  <label className="mn-upload__btn mn-file-label">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      disabled={supportBusy || supportPhotos.length >= 5}
                      onChange={(e) => {
                        const list = Array.from(e.target.files ?? []);
                        setSupportPhotos((prev) => [...prev, ...list].slice(0, 5));
                        e.target.value = "";
                      }}
                    />
                    Выбрать фото
                  </label>
                  <p className="mn-muted">
                    {supportPhotos.length ? `Выбрано файлов: ${supportPhotos.length}` : "До 5 изображений."}
                  </p>
                </div>
                <div className="mn-modal__foot mn-modal__foot--stack">
                  <PrimaryButton fullWidth disabled={supportBusy} onClick={() => void submitSupportAppeal()}>
                    {supportBusy ? "Отправка…" : "Отправить"}
                  </PrimaryButton>
                  <SecondaryButton fullWidth disabled={supportBusy} onClick={() => setSupportOpen(false)}>
                    Отмена
                  </SecondaryButton>
                </div>
              </div>
        </MySubModalBackdrop>
      ) : null}

      {dropperPracticeModalOpen ? (
        <MySubModalBackdrop open theme={theme} onClose={() => setDropperPracticeModalOpen(false)}>
          <div className="mn-modal mn-modal--solid" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="mn-modal__head">
              <h2>Тренировка</h2>
            </div>
            <div className="mn-modal__body">
              <p className="mn-muted">
                Бесплатный режим без билета и наград. Когда будете готовы — играйте с билетом.
              </p>
              <label className="mn-check">
                <input
                  type="checkbox"
                  checked={dropperPracticeSkipNextHint}
                  onChange={(e) => setDropperPracticeSkipNextHint(e.target.checked)}
                />
                Не показывать это окно
              </label>
            </div>
            <div className="mn-modal__foot">
              <SecondaryButton onClick={() => setDropperPracticeModalOpen(false)}>Отмена</SecondaryButton>
              <PrimaryButton onClick={confirmDropperPracticePlay}>Играть</PrimaryButton>
            </div>
          </div>
        </MySubModalBackdrop>
      ) : null}

      {dropperInstructionOpen ? (
        <MySubModalBackdrop open theme={theme} onClose={() => setDropperInstructionOpen(false)}>
          <div className="mn-modal mn-modal--solid" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="mn-modal__head">
              <h2>Как играть</h2>
            </div>
            <div className="mn-modal__body">
              <p className="mn-muted">
                Ведите пальцем влево и вправо. Пролетайте между препятствиями и приземлитесь на жёлтую полосу.
              </p>
            </div>
            <div className="mn-modal__foot">
              <PrimaryButton fullWidth onClick={() => setDropperInstructionOpen(false)}>
                Понятно
              </PrimaryButton>
            </div>
          </div>
        </MySubModalBackdrop>
      ) : null}
    </>
  );
}
