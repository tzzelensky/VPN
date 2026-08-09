import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MySubProfileDto } from "../api";
import type { MySubNavTabId } from "../components/MySubBottomNav";
import type { MySubTheme, MySubWebAppController, PayProduct } from "./types";

function NavIcon({ tab }: { tab: MySubNavTabId }) {
  if (tab === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.8v-5.5h-4.4V21H5a1 1 0 0 1-1-1z" />
      </svg>
    );
  }
  if (tab === "subscription") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2.4" ry="2.4" />
        <path d="M3 10.5h18" />
      </svg>
    );
  }
  if (tab === "friends") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="8" cy="8" r="3.2" />
        <circle cx="16.5" cy="9" r="2.7" />
        <path d="M3.7 19.3c0-2.8 2.4-4.9 5.3-4.9s5.3 2.1 5.3 4.9" />
        <path d="M13.2 19.3c.2-2.1 1.9-3.7 4.1-3.7 2.3 0 4.2 1.7 4.2 3.7" />
      </svg>
    );
  }
  if (tab === "game") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="8" width="16" height="9" rx="2" />
        <path d="M8 12h2.5v2H8zM13.5 12H16v2h-2.5z" fill="currentColor" stroke="none" />
        <path d="M4 14h16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.2 2.8-5.6 7-5.6s7 2.4 7 5.6" />
    </svg>
  );
}

function defaultNewSubscriptionName(userName: string): string {
  const base = String(userName || "VPN").trim().slice(0, 24) || "VPN";
  return `${base} #2`;
}

type Args = {
  profile: MySubProfileDto;
  theme: MySubTheme;
  onRefresh: () => Promise<void>;
  onThemeChange?: (theme: MySubTheme) => void;
};

/** Контроллер WebApp для админ-превью: UI полный, мутации — no-op. */
export function useWebAppPreviewController({
  profile,
  theme,
  onRefresh,
  onThemeChange,
}: Args): MySubWebAppController {
  const [data, setData] = useState<MySubProfileDto>(profile);
  const [tab, setTab] = useState<MySubNavTabId>("home");
  const [msg, setMsg] = useState("");
  const [pickedSubId, setPickedSubId] = useState(() => profile.subscriptions[0]?.id ?? 0);
  const [homeSubId, setHomeSubId] = useState(() => profile.subscriptions[0]?.id ?? 0);
  const [showInstruction, setShowInstruction] = useState(false);
  const [showWhitelistInstruction, setShowWhitelistInstruction] = useState(false);
  const [showPickModal, setShowPickModal] = useState(false);
  const [payProduct, setPayProduct] = useState<PayProduct>("subscription");
  const [payComboOfferId, setPayComboOfferId] = useState("");
  const [payPlanId, setPayPlanId] = useState(1);
  const [payIsTest, setPayIsTest] = useState(false);
  const [payPhoto, setPayPhoto] = useState<File | null>(null);
  const [payTargetId, setPayTargetId] = useState(0);
  const [newSubName, setNewSubName] = useState("");
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<MySubWebAppController["promoApplied"]>(null);
  const [promoFeedback, setPromoFeedback] = useState<MySubWebAppController["promoFeedback"]>(null);
  const [friendRewardId, setFriendRewardId] = useState("");
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportText, setSupportText] = useState("");
  const [supportPhotos, setSupportPhotos] = useState<File[]>([]);
  const [profileSubModalId, setProfileSubModalId] = useState(0);
  const [dropperInstructionOpen, setDropperInstructionOpen] = useState(false);
  const [dropperPracticeModalOpen, setDropperPracticeModalOpen] = useState(false);
  const [dropperPracticeSkipNextHint, setDropperPracticeSkipNextHint] = useState(false);
  const deviceSlotFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setData(profile);
    const first = profile.subscriptions[0]?.id ?? 0;
    setPickedSubId((prev) => (prev > 0 && profile.subscriptions.some((s) => s.id === prev) ? prev : first));
    setHomeSubId((prev) => (prev > 0 && profile.subscriptions.some((s) => s.id === prev) ? prev : first));
    setTab("home");
    setMsg("");
    setShowInstruction(false);
    setShowWhitelistInstruction(false);
    setShowPickModal(false);
    setSupportOpen(false);
    setProfileSubModalId(0);
    setDropperInstructionOpen(false);
    setDropperPracticeModalOpen(false);
  }, [profile]);

  const previewBlock = useCallback(() => {
    setMsg("Превью — действия отключены");
  }, []);

  const homeSub = useMemo(() => {
    const targetId = homeSubId > 0 ? homeSubId : pickedSubId;
    return data.subscriptions.find((s) => s.id === targetId) ?? null;
  }, [data.subscriptions, homeSubId, pickedSubId]);

  const profileSub = useMemo(() => {
    if (!data.subscriptions.length) return undefined;
    const id = pickedSubId > 0 ? pickedSubId : data.subscriptions[0]!.id;
    return data.subscriptions.find((s) => s.id === id) ?? data.subscriptions[0];
  }, [data.subscriptions, pickedSubId]);

  const hasActiveSubscription = useMemo(
    () => data.subscriptions.some((s) => s.allowed),
    [data.subscriptions],
  );

  const payTargetSub = useMemo(() => {
    if (payTargetId <= 0) return null;
    return data.subscriptions.find((s) => s.id === payTargetId) ?? null;
  }, [data.subscriptions, payTargetId]);

  const suggestedNewSubName = useMemo(() => defaultNewSubscriptionName(data.name), [data.name]);
  const selectedPlan = useMemo(() => data.plans.find((p) => p.id === payPlanId) ?? null, [data.plans, payPlanId]);
  const selectedTopUpPlan = useMemo(
    () => data.topup_plans?.find((p) => p.id === payPlanId) ?? null,
    [data.topup_plans, payPlanId],
  );
  const selectedComboOffer = useMemo(() => {
    if (!data.combo_offers?.length || !payComboOfferId) return null;
    return data.combo_offers.find((o) => o.id === payComboOfferId) ?? null;
  }, [data.combo_offers, payComboOfferId]);

  const autoDiscountPercent = !payIsTest && !promoApplied ? data.roulette_purchase_discount?.discount_percent ?? 0 : 0;
  const activeDiscountPercent = promoApplied?.type === "percent" ? promoApplied.discount_percent : autoDiscountPercent;

  const discountedPriceForPlan = useCallback(
    (priceRub: number) => {
      if (promoApplied?.type === "rub") return Math.max(0, priceRub - promoApplied.discount_rub);
      if (activeDiscountPercent > 0) return Math.max(0, Math.round(priceRub * (1 - activeDiscountPercent / 100)));
      return priceRub;
    },
    [activeDiscountPercent, promoApplied],
  );

  const switchPayProduct = useCallback(
    (next: PayProduct) => {
      if (next !== "combo") setPayComboOfferId("");
      setPayIsTest(false);
      setPromoApplied(null);
      setPromoFeedback(null);
      setPromoCodeInput("");
      setPayPlanId(1);
      setPayProduct(next);
      if ((next === "topup" || next === "white_lists" || next === "device_slot") && data.subscriptions.length) {
        setPayTargetId(data.subscriptions[0]!.id);
      }
    },
    [data.subscriptions],
  );

  const selectComboOffer = useCallback(
    (id: string) => {
      if (payProduct === "combo" && payComboOfferId === id) {
        switchPayProduct("subscription");
        return;
      }
      setPayIsTest(false);
      setPromoApplied(null);
      setPromoFeedback(null);
      setPromoCodeInput("");
      setPayComboOfferId(id);
      setPayProduct("combo");
    },
    [payComboOfferId, payProduct, switchPayProduct],
  );

  const gameVisible = Boolean(data.game_tab_visible ?? data.dropper.enabled ?? data.roulette?.enabled);
  const activeGame =
    data.active_game ?? (data.roulette?.enabled ? "roulette" : data.dropper.enabled ? "dropper" : "none");
  const gameTickets = data.roulette?.enabled
    ? (data.roulette.tickets ?? data.dropper.tickets)
    : data.dropper.tickets ?? 0;

  useEffect(() => {
    if (!gameVisible && tab === "game") setTab("home");
  }, [gameVisible, tab]);

  const dropperTargetUserId = useMemo(() => {
    if (!data.subscriptions.length) return 0;
    if (pickedSubId > 0 && data.subscriptions.some((s) => s.id === pickedSubId)) return pickedSubId;
    return data.subscriptions[0]!.id;
  }, [data.subscriptions, pickedSubId]);

  const bottomNavItems = useMemo(() => {
    const rows: Array<{ id: MySubNavTabId; label: string; gameTickets?: number; gameEnabled?: boolean }> = [
      { id: "home", label: "Главная" },
      { id: "subscription", label: "Оплата" },
    ];
    if (gameVisible) {
      rows.push({ id: "game", label: "Игра", gameTickets, gameEnabled: true });
    }
    rows.push({ id: "friends", label: "Друзья" }, { id: "profile", label: "Профиль" });
    return rows.map((row) => ({
      ...row,
      icon: <NavIcon tab={row.id} /> as ReactNode,
    }));
  }, [gameVisible, gameTickets]);

  const applyMySubTheme = useCallback(
    (next: MySubTheme) => {
      onThemeChange?.(next);
    },
    [onThemeChange],
  );

  const refreshProfile = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  return {
    data,
    err: "",
    msg,
    setMsg,
    tab,
    setTab,
    theme,
    applyMySubTheme,
    initData: "",
    setData: setData as MySubWebAppController["setData"],
    previewMode: true,
    homeSub,
    homeSubId,
    setHomeSubId,
    pickedSubId,
    setPickedSubId,
    profileSub,
    hasActiveSubscription,
    showInstruction,
    setShowInstruction,
    showWhitelistInstruction,
    setShowWhitelistInstruction,
    showPickModal,
    setShowPickModal,
    payProduct,
    switchPayProduct,
    payComboOfferId,
    setPayComboOfferId,
    selectedComboOffer,
    selectComboOffer,
    payPlanId,
    setPayPlanId,
    payIsTest,
    setPayIsTest,
    payPhoto,
    setPayPhoto,
    busyPay: false,
    payTargetId,
    setPayTargetId,
    payTargetSub,
    newSubName: newSubName || suggestedNewSubName,
    setNewSubName,
    suggestedNewSubName,
    selectedPlan,
    selectedTopUpPlan,
    testPlanAvailable: data.test_plan?.available === true,
    salesDisabledForNew: data.sales_disabled_for_new === true,
    submitPaymentProof: async () => previewBlock(),
    openTestPay: () => {
      setPayProduct("subscription");
      setPayIsTest(true);
      setPayPlanId(1);
      setTab("subscription");
    },
    promoCodeInput,
    setPromoCodeInput,
    promoApplied,
    promoFeedback,
    applyPromoCode: async () => previewBlock(),
    activeDiscountPercent,
    autoDiscountPercent,
    discountedPriceForPlan,
    copySubscription: async (url: string) => {
      try {
        await navigator.clipboard.writeText(url);
        setMsg("Ссылка скопирована");
      } catch {
        setMsg("Не удалось скопировать");
      }
    },
    openPickForCopy: () => setShowPickModal(true),
    busyDevicePay: false,
    deviceSlotFileRef,
    submitDeviceSlotPayment: async () => previewBlock(),
    openDeviceSlotPay: () => previewBlock(),
    refreshProfile,
    shareReferralInTelegram: () => previewBlock(),
    friendRewardId,
    setFriendRewardId,
    friendRewardBusy: false,
    claimFriendReward: async () => previewBlock(),
    supportOpen,
    setSupportOpen,
    supportText,
    setSupportText,
    supportPhotos,
    setSupportPhotos,
    supportBusy: false,
    openSupportProfile: () => setSupportOpen(true),
    submitSupportAppeal: async () => previewBlock(),
    profileSubModalId,
    setProfileSubModalId,
    gameVisible,
    activeGame,
    gameTickets,
    dropperPlaying: false,
    isGameTab: tab === "game" && gameVisible,
    dropperTargetUserId,
    dropperSession: null,
    dropperInstructionOpen,
    setDropperInstructionOpen,
    dropperPracticeModalOpen,
    setDropperPracticeModalOpen,
    dropperPracticeSkipNextHint,
    setDropperPracticeSkipNextHint,
    dropperNoTickets: false,
    dropperStartBusy: false,
    startDropperPlay: async () => previewBlock(),
    openDropperPracticeIntro: () => {
      if (dropperPracticeSkipNextHint) return;
      setDropperPracticeModalOpen(true);
    },
    confirmDropperPracticePlay: () => {
      setDropperPracticeModalOpen(false);
      previewBlock();
    },
    finishDropperAndRefresh: async () => undefined,
    bottomNavItems,
  };
}
