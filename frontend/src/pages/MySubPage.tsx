import { useEffect, useMemo, useRef, useState } from "react";
import { type MySubNavTabId } from "../components/MySubBottomNav";
import MySubLoadingScreen from "../mysub-new/components/MySubLoadingScreen";
import { prefetchDailyGiftImages } from "../mysub-new/dailyGiftPrefetch";
import MySubWebAppNew from "../mysub-new/MySubWebAppNew";
import type { MySubWebAppController } from "../mysub-new/types";
import {
  claimMySubReferralReward,
  loadMySubWebAppProfile,
  previewMySubPromoCode,
  sendMySubPaymentProof,
  sendMySubSupportAppeal,
  startDropperSession,
  type MySubProfileDto,
} from "../api";
import { applyReferralInviteVars } from "../referralInvitePreview";
import { getTelegramWebApp, loadTelegramWebAppScript, maximizeTelegramWebApp, startTelegramWebAppMaximize } from "../lib/telegramWebApp";

type Tab = "home" | "subscription" | "game" | "friends" | "profile";

const MYSUB_THEME_KEY = "mysub_theme";
type MySubTheme = "dark" | "light";

function readMySubTheme(): MySubTheme {
  try {
    const s = localStorage.getItem(MYSUB_THEME_KEY);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* ignore */
  }
  const tg = (window as unknown as { Telegram?: { WebApp?: { colorScheme?: string } } }).Telegram?.WebApp;
  if (tg?.colorScheme === "light") return "light";
  return "dark";
}

/** Имя по умолчанию для новой подписки — @username или имя из профиля Telegram. */
function defaultNewSubscriptionName(profileName: string): string {
  const base = String(profileName ?? "").trim();
  if (base) return base.slice(0, 25);
  return "Подписка";
}

function resolveLocalDevInitData(): string {
  if (typeof window === "undefined") return "";
  const host = String(window.location.hostname ?? "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") return "";
  const query = new URLSearchParams(window.location.search);
  const explicit = String(query.get("dev_tg_id") ?? "").trim();
  if (explicit) return `local-dev:${explicit}`;
  const pathMatch = window.location.pathname.match(/^\/mysub\/(\d+)$/);
  if (pathMatch?.[1]) return `local-dev:${pathMatch[1]}`;
  return "local-dev:504445187";
}

function NavIcon({ tab }: { tab: Tab }) {
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

export default function MySubPage() {
  const [data, setData] = useState<MySubProfileDto | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [pickedSubId, setPickedSubId] = useState<number>(0);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [showInstruction, setShowInstruction] = useState(false);
  const [showWhitelistInstruction, setShowWhitelistInstruction] = useState(false);
  const [showPickModal, setShowPickModal] = useState(false);
  const [payProduct, setPayProduct] = useState<"subscription" | "topup" | "white_lists" | "device_slot" | "combo">("subscription");
  const [payComboOfferId, setPayComboOfferId] = useState("");
  const [payPlanId, setPayPlanId] = useState<number>(1);
  const [payIsTest, setPayIsTest] = useState(false);
  const [payPhoto, setPayPhoto] = useState<File | null>(null);
  const [busyPay, setBusyPay] = useState(false);
  const [busyDevicePay, setBusyDevicePay] = useState(false);
  const deviceSlotFileRef = useRef<HTMLInputElement>(null);
  const [payTargetId, setPayTargetId] = useState<number>(0); // 0 = "Новая подписка"
  const [newSubName, setNewSubName] = useState("");
  const [profileSubModalId, setProfileSubModalId] = useState<number>(0);
  const [homeSubId, setHomeSubId] = useState<number>(0);
  const [friendRewardId, setFriendRewardId] = useState("");
  const [friendRewardBusy, setFriendRewardBusy] = useState(false);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    type: "percent" | "rub" | "gb" | "days";
    discount_percent: number;
    discount_rub: number;
    bonus_gb: number;
    bonus_days: number;
    final_price_rub: number;
    original_price_rub: number;
    apply_plan_ids?: number[];
  } | null>(null);
  const [promoFeedback, setPromoFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [dropperSession, setDropperSession] = useState<{ sessionId: string; seed: number; practice?: boolean } | null>(
    null,
  );
  const [dropperInstructionOpen, setDropperInstructionOpen] = useState(false);
  const [dropperPracticeModalOpen, setDropperPracticeModalOpen] = useState(false);
  const [dropperPracticeSkipNextHint, setDropperPracticeSkipNextHint] = useState(false);
  const [dropperNoTickets, setDropperNoTickets] = useState(false);
  const [dropperStartBusy, setDropperStartBusy] = useState(false);
  const [theme, setTheme] = useState<MySubTheme>(() => readMySubTheme());
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportText, setSupportText] = useState("");
  const [supportPhotos, setSupportPhotos] = useState<File[]>([]);
  const [supportBusy, setSupportBusy] = useState(false);

  function applyMySubTheme(next: MySubTheme) {
    setTheme(next);
    try {
      localStorage.setItem(MYSUB_THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const root = document.documentElement;
    const tg = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            setHeaderColor?: (c: string) => void;
            setBackgroundColor?: (c: string) => void;
          };
        };
      }
    ).Telegram?.WebApp;
    if (theme === "light") {
      root.classList.add("mysub-app-light");
      try {
        tg?.setHeaderColor?.("#f8fafc");
        tg?.setBackgroundColor?.("#f1f5f9");
      } catch {
        /* ignore */
      }
    } else {
      root.classList.remove("mysub-app-light");
      try {
        tg?.setHeaderColor?.("#0c0f14");
        tg?.setBackgroundColor?.("#050913");
      } catch {
        /* ignore */
      }
    }
    return () => {
      root.classList.remove("mysub-app-light");
    };
  }, [theme]);

  function getInitData(): string {
    const tgWebApp = getTelegramWebApp();
    const direct = String(tgWebApp?.initData ?? "").trim();
    if (direct) return direct;
    const fromHash = new URLSearchParams(String(window.location.hash ?? "").replace(/^#/, "")).get("tgWebAppData");
    if (fromHash) return decodeURIComponent(fromHash);
    const fromQuery = new URLSearchParams(window.location.search).get("tgWebAppData");
    if (fromQuery) return decodeURIComponent(fromQuery);
    return resolveLocalDevInitData();
  }

  useEffect(() => startTelegramWebAppMaximize(), []);

  useEffect(() => {
    void (async () => {
      setErr("");
      await loadTelegramWebAppScript();
      const tgWebApp = getTelegramWebApp();
      const initData = getInitData();
      if (!initData) {
        setErr("Требуется авторизация через тг.");
        return;
      }
      maximizeTelegramWebApp(tgWebApp);
      try {
        const profile = await loadMySubWebAppProfile(initData);
        const firstSubId = profile.subscriptions[0]?.id;
        prefetchDailyGiftImages(profile, firstSubId);
        setData({
          ...profile,
          support_appeals: profile.support_appeals ?? { enabled: false },
        });
        if (profile.subscriptions.length > 0) {
          setPickedSubId(profile.subscriptions[0]!.id);
          setHomeSubId(profile.subscriptions[0]!.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("tg_webapp_auth_required")) setErr("Требуется авторизация через тг.");
        else setErr(msg);
      }
    })();
  }, []);
  useEffect(() => {
    if (payTargetId > 0) setPickedSubId(payTargetId);
  }, [payTargetId]);
  useEffect(() => {
    setMsg("");
  }, [tab]);

  useEffect(() => {
    if (tab !== "profile") return;
    const id = getInitData();
    if (!id) return;
    void loadMySubWebAppProfile(id)
      .then((profile) => {
        setData((prev) =>
          prev
            ? {
                ...prev,
                support_appeals: profile.support_appeals ?? { enabled: false },
              }
            : {
                ...profile,
                support_appeals: profile.support_appeals ?? { enabled: false },
              },
        );
      })
      .catch(() => {});
  }, [tab]);

  useEffect(() => {
    const visible = data?.game_tab_visible ?? data?.dropper.enabled ?? false;
    if (data && !visible && tab === "game") setTab("home");
  }, [data, tab]);

  const dropperTargetUserId = useMemo(() => {
    if (!data?.subscriptions.length) return 0;
    if (pickedSubId > 0 && data.subscriptions.some((s) => s.id === pickedSubId)) return pickedSubId;
    return data.subscriptions[0]!.id;
  }, [data, pickedSubId]);

  const homeSub = useMemo(() => {
    if (!data) return null;
    const targetId = homeSubId > 0 ? homeSubId : pickedSubId;
    return data.subscriptions.find((s) => s.id === targetId) ?? null;
  }, [data, homeSubId, pickedSubId]);
  const initData = useMemo(() => {
    return getInitData();
  }, []);
  const hasActiveSubscription = useMemo(() => {
    return (data?.subscriptions ?? []).some((s) => s.allowed);
  }, [data]);
  const payTargetSub = useMemo(() => {
    if (!data || payTargetId <= 0) return null;
    return data.subscriptions.find((s) => s.id === payTargetId) ?? null;
  }, [data, payTargetId]);
  const suggestedNewSubName = useMemo(() => {
    if (!data) return "";
    return defaultNewSubscriptionName(data.name);
  }, [data]);
  const selectedPlan = useMemo(() => {
    if (!data) return null;
    return data.plans.find((p) => p.id === payPlanId) ?? null;
  }, [data, payPlanId]);
  const selectedTopUpPlan = useMemo(() => {
    if (!data?.topup_plans?.length) return null;
    return data.topup_plans.find((p) => p.id === payPlanId) ?? null;
  }, [data, payPlanId]);
  const testPlanAvailable = data?.test_plan?.available === true;
  const salesDisabledForNew = data?.sales_disabled_for_new === true;

  function openTestPay() {
    setPayProduct("subscription");
    setPayIsTest(true);
    setPayPlanId(1);
    setPromoApplied(null);
    setPromoFeedback(null);
    setPromoCodeInput("");
    setTab("subscription");
  }

  const selectedComboOffer = useMemo(() => {
    if (!data?.combo_offers?.length || !payComboOfferId) return null;
    return data.combo_offers.find((o) => o.id === payComboOfferId) ?? null;
  }, [data, payComboOfferId]);

  function selectComboOffer(id: string) {
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
    const offer = data?.combo_offers?.find((o) => o.id === id);
    const eligibleIds = offer?.eligible_subscription_ids ?? [];
    if (offer?.preferred_subscription_id) {
      setPayTargetId(offer.preferred_subscription_id);
    } else if (eligibleIds.length > 0) {
      if (payTargetId > 0 && eligibleIds.includes(payTargetId)) {
        // leave current
      } else {
        setPayTargetId(eligibleIds[0]!);
      }
    }
  }

  function switchPayProduct(next: "subscription" | "topup" | "white_lists" | "device_slot" | "combo") {
    if (next !== "combo") setPayComboOfferId("");
    setPayIsTest(false);
    setPromoApplied(null);
    setPromoFeedback(null);
    setPromoCodeInput("");
    setPayPlanId(1);
    if ((next === "topup" || next === "white_lists" || next === "device_slot") && data?.subscriptions.length) {
      if (next === "white_lists") {
        const eligible = data.subscriptions.filter((s) => s.whitelist?.can_buy);
        const pick =
          payTargetId > 0 && eligible.some((s) => s.id === payTargetId)
            ? payTargetId
            : eligible[0]?.id ?? data.subscriptions[0]!.id;
        setPayTargetId(pick);
      } else if (next === "topup") {
        const limited = data.subscriptions.find((s) => s.total_gb > 0 && !s.stats.unlimited_traffic);
        setPayTargetId(limited?.id ?? data.subscriptions[0]!.id);
      } else if (next === "device_slot") {
        setPayTargetId(homeSubId > 0 ? homeSubId : data.subscriptions[0]!.id);
      } else setPayTargetId((prev) => (prev <= 0 ? data.subscriptions[0]!.id : prev));
    }
    setPayProduct(next);
  }

  function openDeviceSlotPay(subId: number) {
    const sub = data?.subscriptions.find((s) => s.id === subId);
    if (!sub?.devices?.enabled) return;
    setPayTargetId(subId);
    setPayIsTest(false);
    setPromoApplied(null);
    setPromoFeedback(null);
    setPromoCodeInput("");
    setPayPlanId(1);
    setPayProduct("device_slot");
    setTab("subscription");
  }

  useEffect(() => {
    // Если пользователь меняет введенный промокод после применения — снимаем скидку,
    // чтобы цена не расходилась с тем, что отправится в платеж.
    const normalizedInput = promoCodeInput.replace(/\s+/g, "").trim().toLocaleUpperCase("ru-RU");
    if (!promoApplied) return;
    if (!normalizedInput) {
      setPromoApplied(null);
      setPromoFeedback(null);
      return;
    }
    if (normalizedInput !== promoApplied.code) {
      setPromoApplied(null);
      setPromoFeedback(null);
    }
  }, [promoCodeInput, promoApplied]);

  useEffect(() => {
    if (!promoApplied?.apply_plan_ids?.length) return;
    if (payProduct !== "subscription" || payIsTest) {
      setPromoApplied(null);
      setPromoFeedback({ type: "err", text: "Промокод действует только для выбранных тарифов подписки." });
      return;
    }
    if (!promoApplied.apply_plan_ids.includes(payPlanId)) {
      setPromoApplied(null);
      setPromoFeedback({ type: "err", text: "Промокод нельзя применить к выбранному тарифу." });
    }
  }, [payPlanId, payProduct, payIsTest, promoApplied]);

  async function copySubscription(url: string) {
    setMsg("");
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Ссылка скопирована.");
    } catch {
      setMsg("Не удалось скопировать автоматически. Скопируйте вручную.");
    }
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Не удалось прочитать фото"));
      r.onload = () => resolve(String(r.result ?? ""));
      r.readAsDataURL(file);
    });
  }

  async function compressImage(file: File): Promise<{ base64: string; mime: string; name: string }> {
    if (!file.type.startsWith("image/")) {
      return { base64: await fileToDataUrl(file), mime: file.type || "application/octet-stream", name: file.name || "file.bin" };
    }
    const imageBitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(imageBitmap.width, imageBitmap.height));
    const w = Math.max(1, Math.round(imageBitmap.width * scale));
    const h = Math.max(1, Math.round(imageBitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось обработать фото.");
    ctx.drawImage(imageBitmap, 0, 0, w, h);
    imageBitmap.close();
    const base64 = canvas.toDataURL("image/jpeg", 0.72);
    return { base64, mime: "image/jpeg", name: "proof.jpg" };
  }

  async function submitPaymentProof() {
    if (!data || !payPhoto) {
      setMsg("Выберите тариф или пакет ГБ и фото чека.");
      return;
    }
    if (salesDisabledForNew && data.subscriptions.length === 0) {
      setMsg("Оформление новых подписок временно недоступно.");
      return;
    }
    if (payProduct === "combo") {
      if (!selectedComboOffer) {
        setMsg("Выберите комбо-предложение.");
        return;
      }
      if (!selectedComboOffer.eligible) {
        setMsg(selectedComboOffer.block_reason || "Комбо-предложение недоступно.");
        return;
      }
    } else if (payProduct === "device_slot") {
      if (!payTargetId) {
        setMsg("Выберите подписку для докупки места.");
        return;
      }
      if (!payPhoto) {
        setMsg("Прикрепите фото чека об оплате.");
        return;
      }
    } else if (payProduct === "white_lists") {
      if (!payTargetSub?.whitelist?.can_buy) {
        setMsg(
          payTargetSub?.whitelist?.status === "active"
            ? "Белые списки уже подключены к этой подписке."
            : payTargetSub?.whitelist?.block_reason || data.whitelist?.block_reason || "Покупка белых списков недоступна.",
        );
        return;
      }
      if (!data.subscriptions.length || payTargetId <= 0 || !payTargetSub) {
        setMsg("Выберите активную подписку для подключения белых списков.");
        return;
      }
    } else if (payProduct === "topup") {
      if (!data.subscriptions.length) {
        setMsg("Докупка ГБ доступна только при привязанной подписке.");
        return;
      }
      if (payTargetId <= 0 || !payTargetSub) {
        setMsg("Выберите подписку, к которой докупаете ГБ.");
        return;
      }
      if (payTargetSub.total_gb <= 0 || payTargetSub.stats.unlimited_traffic) {
        setMsg("Докупка ГБ недоступна для безлимитной подписки.");
        return;
      }
      if (!selectedTopUpPlan) {
        setMsg("Выберите пакет докупки.");
        return;
      }
    } else if (payIsTest) {
      if (!testPlanAvailable || !data.test_plan) {
        setMsg("Тестовая подписка недоступна.");
        return;
      }
    } else if (!selectedPlan) {
      setMsg("Выберите тариф.");
      return;
    } else if (payTargetId > 0 && !payTargetSub) {
      setMsg("Выберите подписку для продления.");
      return;
    }
    const chosenNewName =
      payTargetId === 0 && !payIsTest ? (newSubName.trim() || defaultNewSubscriptionName(data.name)) : "";
    setBusyPay(true);
    setMsg("");
    try {
      const compressed = await compressImage(payPhoto);
      await sendMySubPaymentProof({
        init_data: initData,
        pay_kind: payIsTest ? "test" : payProduct,
        user_id:
          payProduct === "device_slot"
            ? payTargetId
            : payTargetId > 0
              ? payTargetId
              : payProduct === "white_lists"
                ? data.subscriptions[0]?.id
                : undefined,
        plan_id:
          payIsTest || payProduct === "white_lists" || payProduct === "device_slot"
            ? 1
            : payProduct === "combo"
              ? selectedComboOffer?.plan_id ?? 1
              : payPlanId,
        photo_base64: compressed.base64,
        photo_mime: compressed.mime,
        photo_name: compressed.name,
        new_subscription_name:
          (payProduct === "subscription" || payProduct === "combo") && !payIsTest && payTargetId === 0
            ? chosenNewName.slice(0, 25)
            : undefined,
        promo_code: payIsTest || payProduct === "combo" ? undefined : promoApplied?.code,
        combo_offer_id: payProduct === "combo" ? payComboOfferId : undefined,
      });
      setMsg(
        payIsTest
          ? "Чек получен. Администратор проверит оплату и активирует тестовую подписку."
          : payProduct === "combo"
            ? "Чек получен. После подтверждения будут подключены подписка и все продукты из комбо."
          : payProduct === "device_slot"
            ? "Чек получен. После подтверждения оплаты место для устройства будет добавлено."
          : payProduct === "white_lists"
            ? "Чек получен. После подтверждения оплаты белые списки будут добавлены в подписку."
          : payProduct === "topup"
          ? "Чек получен. Администратор проверит оплату и начислит ГБ. Обычно это занимает немного времени."
          : "Чек получен. Администратор проверит оплату и примет решение. Обычно это занимает немного времени. После подтверждения подписка придет в чат",
      );
      setPayPhoto(null);
      if (payTargetId === 0) setNewSubName("");
      if (payIsTest) setPayIsTest(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("tg_webapp_auth_required")) setErr("Требуется авторизация через тг.");
      else setMsg(m);
    } finally {
      setBusyPay(false);
    }
  }

  async function submitDeviceSlotPayment(file: File, subId: number) {
    if (!data || !initData) return;
    setBusyDevicePay(true);
    setMsg("");
    try {
      const compressed = await compressImage(file);
      await sendMySubPaymentProof({
        init_data: initData,
        pay_kind: "device_slot",
        user_id: subId,
        plan_id: 1,
        photo_base64: compressed.base64,
        photo_mime: compressed.mime,
        photo_name: compressed.name,
      });
      setMsg("Чек получен. После подтверждения оплаты место для устройства будет добавлено.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyDevicePay(false);
    }
  }

  async function applyPromoCode() {
    if (payIsTest) {
      setPromoFeedback({ type: "err", text: "Промокод нельзя применить к тестовой подписке." });
      return;
    }
    const priceBase =
      payProduct === "topup" ? selectedTopUpPlan?.price_rub : selectedPlan?.price_rub;
    if (priceBase == null) {
      setPromoFeedback({ type: "err", text: payProduct === "topup" ? "Сначала выберите пакет ГБ." : "Сначала выберите тариф." });
      return;
    }
    const code = promoCodeInput.replace(/\s+/g, "").trim().toLocaleUpperCase("ru-RU");
    if (!code) {
      setPromoFeedback({ type: "err", text: "Введите промокод." });
      return;
    }
    try {
      const calc = await previewMySubPromoCode({
        init_data: initData,
        code,
        original_price_rub: priceBase,
        plan_id: payProduct === "topup" ? selectedTopUpPlan?.id : selectedPlan?.id,
        purchase_kind: payProduct === "topup" ? "topup" : "subscription",
      });
      setPromoApplied({
        code: calc.promo.code,
        type: calc.promo.type,
        discount_percent: calc.discount_percent,
        discount_rub: calc.discount_rub,
        bonus_gb: calc.bonus_gb,
        bonus_days: calc.bonus_days,
        final_price_rub: calc.final_price_rub,
        original_price_rub: calc.original_price_rub,
        apply_plan_ids: calc.promo.apply_plan_ids,
      });
      setPromoFeedback(null);
    } catch (e) {
      setPromoApplied(null);
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("promo_already_used")) setPromoFeedback({ type: "err", text: "Этот промокод уже был использован вами." });
      else if (m.includes("promo_not_found")) setPromoFeedback({ type: "err", text: "Промокод не найден." });
      else if (m.includes("promo_inactive")) setPromoFeedback({ type: "err", text: "Этот промокод сейчас неактивен." });
      else if (m.includes("promo_expired")) setPromoFeedback({ type: "err", text: "Срок действия этого промокода истек." });
      else if (m.includes("promo_plan_not_allowed")) {
        setPromoFeedback({ type: "err", text: "Промокод нельзя применить к выбранному тарифу." });
      } else if (m.includes("promo_new_users_only")) {
        setPromoFeedback({ type: "err", text: "Промокод только для новых пользователей без подписки." });
      } else setPromoFeedback({ type: "err", text: "Не удалось применить промокод." });
    }
  }

  const autoDiscountPercent = !payIsTest && !promoApplied ? data?.roulette_purchase_discount?.discount_percent ?? 0 : 0;
  const activeDiscountPercent = promoApplied
    ? promoApplied.type === "percent"
      ? promoApplied.discount_percent
      : promoApplied.discount_rub > 0 && promoApplied.original_price_rub > 0
        ? Math.round((promoApplied.discount_rub / promoApplied.original_price_rub) * 100)
        : 0
    : autoDiscountPercent;

  const discountedPriceForPlan = (priceRub: number) => {
    if (promoApplied) {
      if (promoApplied.type === "rub") {
        return Math.max(0, priceRub - promoApplied.discount_rub);
      }
      if (promoApplied.type === "percent") {
        return Math.max(0, Math.floor(priceRub - (priceRub * promoApplied.discount_percent) / 100));
      }
      return priceRub;
    }
    if (!activeDiscountPercent) return priceRub;
    return Math.max(0, Math.floor(priceRub - (priceRub * activeDiscountPercent) / 100));
  };

  function openPickForCopy() {
    if (!data) return;
    if (data.subscriptions.length === 0) {
      setTab("subscription");
      return;
    }
    if (pickedSubId <= 0 && data.subscriptions[0]) setPickedSubId(data.subscriptions[0].id);
    if (data.subscriptions.length <= 1) {
      setPickedSubId(data.subscriptions[0]?.id ?? 0);
      return;
    }
    setShowPickModal(true);
  }

  function shareReferralInTelegram() {
    if (!data?.referral?.invite_link) {
      setMsg("Реферальная ссылка недоступна.");
      return;
    }
    const discountPct = Math.max(0, Math.floor(Number(data.referral.invited_discount_percent) || 20));
    const brand = data.referral.brand_name || "Клиент";
    const text = applyReferralInviteVars(
      data.referral.invite_copy_text || "Я пользуюсь {brand}, вот тебе скидка {discount} на первую покупку!",
      {
        ref_link: data.referral.invite_link,
        discount: `${discountPct}%`,
        brand,
      },
    );
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.referral.invite_link)}&text=${encodeURIComponent(text)}`;
    const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  function openSupportProfile() {
    if (!data?.support_appeals?.enabled) return;
    setSupportText("");
    setSupportPhotos([]);
    setMsg("");
    setSupportOpen(true);
  }

  async function submitSupportAppeal() {
    const text = supportText.trim();
    if (!text && supportPhotos.length === 0) {
      setMsg("Опишите проблему или приложите фото.");
      return;
    }
    setSupportBusy(true);
    setMsg("");
    try {
      const photos: Array<{ base64: string; mime?: string; name?: string }> = [];
      for (const f of supportPhotos.slice(0, 5)) {
        const c = await compressImage(f);
        photos.push({ base64: c.base64, mime: c.mime, name: c.name });
      }
      await sendMySubSupportAppeal({ init_data: initData, text, photos });
      setSupportOpen(false);
      setSupportText("");
      setSupportPhotos([]);
      setMsg("Сообщение отправлено. Результат ответа придёт в чат Telegram.");
      const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { showAlert?: (m: string) => void } } }).Telegram
        ?.WebApp;
      tgWebApp?.showAlert?.("Сообщение отправлено. Ответ придёт в чат.");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("support_disabled")) setMsg("Поддержка временно недоступна.");
      else setMsg(m.slice(0, 200));
    } finally {
      setSupportBusy(false);
    }
  }

  async function claimFriendReward(kind: "gb" | "days") {
    if (!friendRewardId) return;
    if (kind === "gb" && (data?.subscriptions ?? []).some((s) => s.total_gb <= 0)) {
      const text = "У вас безлимит. Можно выбрать только награду в днях.";
      setMsg(text);
      const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { showAlert?: (msg: string) => void } } }).Telegram?.WebApp;
      tgWebApp?.showAlert?.(text);
      return;
    }
    setFriendRewardBusy(true);
    try {
      await claimMySubReferralReward({ init_data: initData, reward_id: friendRewardId, kind });
      setMsg(kind === "gb" ? "Награда +ГБ успешно применена." : "Награда +дни успешно применена.");
      setFriendRewardId("");
      const profile = await loadMySubWebAppProfile(initData);
      setData(profile);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("inviter_unlimited_choose_days")) {
        const text = "У вас безлимит. Можно выбрать только награду в днях.";
        setMsg(text);
        const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { showAlert?: (msg: string) => void } } }).Telegram?.WebApp;
        tgWebApp?.showAlert?.(text);
      } else {
        setMsg("Не удалось применить награду. Попробуйте еще раз.");
      }
    } finally {
      setFriendRewardBusy(false);
    }
  }

  async function finishDropperAndRefresh() {
    setDropperSession(null);
    try {
      const profile = await loadMySubWebAppProfile(initData);
      setData(profile);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("tg_webapp_auth_required")) setErr("Требуется авторизация через тг.");
      else setMsg(m);
    }
  }

  async function startDropperPlay() {
    if (!data?.dropper.enabled) return;
    const uid = dropperTargetUserId;
    if (!uid) {
      setMsg("Нужна хотя бы одна подписка, чтобы играть и получать награду.");
      return;
    }
    if ((data.subscriptions.find((s) => s.id === uid)?.tickets ?? 0) <= 0) {
      setDropperNoTickets(true);
      return;
    }
    setDropperNoTickets(false);
    setDropperStartBusy(true);
    setMsg("");
    try {
      const r = await startDropperSession({ init_data: initData, user_id: uid });
      (window as unknown as { Telegram?: { WebApp?: { expand?: () => void } } }).Telegram?.WebApp?.expand?.();
      setDropperSession({ sessionId: r.session_id, seed: r.seed, practice: false });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("no_tickets")) setDropperNoTickets(true);
      else if (m.includes("game_disabled")) setMsg("Игра временно отключена.");
      else if (m.includes("forbidden")) setMsg("Нет доступа к этой подписке.");
      else setMsg(m.slice(0, 200));
    } finally {
      setDropperStartBusy(false);
    }
  }

  const DROPPER_SKIP_PRACTICE_INTRO_KEY = "mysub_dropper_skip_practice_intro";

  function openDropperPracticeIntro() {
    if (!data?.dropper.enabled) return;
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(DROPPER_SKIP_PRACTICE_INTRO_KEY) === "1") {
        void startDropperPracticePlay();
        return;
      }
    } catch {
      // ignore
    }
    setDropperPracticeSkipNextHint(false);
    setDropperPracticeModalOpen(true);
  }

  function confirmDropperPracticePlay() {
    if (dropperPracticeSkipNextHint) {
      try {
        localStorage.setItem(DROPPER_SKIP_PRACTICE_INTRO_KEY, "1");
      } catch {
        // ignore
      }
    }
    setDropperPracticeModalOpen(false);
    void startDropperPracticePlay();
  }

  async function startDropperPracticePlay() {
    if (!data?.dropper.enabled) return;
    setDropperNoTickets(false);
    setDropperStartBusy(true);
    setMsg("");
    try {
      const uid = dropperTargetUserId > 0 ? dropperTargetUserId : 0;
      const r = await startDropperSession({ init_data: initData, user_id: uid, practice: true });
      (window as unknown as { Telegram?: { WebApp?: { expand?: () => void } } }).Telegram?.WebApp?.expand?.();
      setDropperSession({ sessionId: r.session_id, seed: r.seed, practice: true });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("game_disabled")) setMsg("Игра временно отключена.");
      else if (m.includes("forbidden")) setMsg("Аккаунт не привязан к клиенту. Обратитесь к администратору.");
      else setMsg(m.slice(0, 200));
    } finally {
      setDropperStartBusy(false);
    }
  }

  const gameVisible = Boolean(data?.game_tab_visible ?? data?.dropper.enabled ?? data?.roulette?.enabled);
  const activeGame = data?.active_game ?? (data?.roulette?.enabled ? "roulette" : data?.dropper.enabled ? "dropper" : "none");
  const gameTickets = data?.roulette?.enabled
    ? (data.roulette.tickets ?? data.dropper.tickets)
    : data?.dropper.tickets ?? 0;

  const dropperPlaying = tab === "game" && activeGame === "dropper" && Boolean(dropperSession);
  const isGameTab = tab === "game" && gameVisible;

  const profileSub = useMemo(() => {
    if (!data?.subscriptions.length) return undefined;
    const id = pickedSubId > 0 ? pickedSubId : data.subscriptions[0]!.id;
    return data.subscriptions.find((s) => s.id === id) ?? data.subscriptions[0];
  }, [data?.subscriptions, pickedSubId]);

  async function refreshProfile() {
    try {
      const profile = await loadMySubWebAppProfile(initData);
      prefetchDailyGiftImages(profile, homeSubId > 0 ? homeSubId : profile.subscriptions[0]?.id);
      setData({
        ...profile,
        support_appeals: profile.support_appeals ?? { enabled: false },
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!data || homeSubId <= 0) return;
    prefetchDailyGiftImages(data, homeSubId);
  }, [data, homeSubId]);

  const bottomNavItems = useMemo(() => {
    if (!data) return [];
    const rows: Array<{ id: MySubNavTabId; label: string; gameTickets?: number; gameEnabled?: boolean }> = [
      { id: "home", label: "Главная" },
      { id: "subscription", label: "Оплата" },
    ];
    if (gameVisible) {
      rows.push({
        id: "game",
        label: "Игра",
        gameTickets,
        gameEnabled: true,
      });
    }
    rows.push({ id: "friends", label: "Друзья" }, { id: "profile", label: "Профиль" });
    return rows.map((row) => ({
      ...row,
      icon: <NavIcon tab={row.id} />,
    }));
  }, [data]);

  if (!err && !data) {
    return (
      <div className={`mysub-wrap ${theme === "light" ? "mysub-wrap--light" : ""}`}>
        <MySubLoadingScreen theme={theme} />
      </div>
    );
  }

  if (data) {
    const profile = data;
    const ctrl: MySubWebAppController = {
      data: profile,
      err,
      msg,
      setMsg,
      tab,
      setTab,
      theme,
      applyMySubTheme,
      initData,
      setData,
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
      busyPay,
      payTargetId,
      setPayTargetId,
      payTargetSub,
      newSubName,
      setNewSubName,
      suggestedNewSubName,
      selectedPlan,
      selectedTopUpPlan,
      testPlanAvailable,
      salesDisabledForNew,
      submitPaymentProof,
      openTestPay,
      promoCodeInput,
      setPromoCodeInput,
      promoApplied,
      promoFeedback,
      applyPromoCode,
      activeDiscountPercent,
      autoDiscountPercent,
      discountedPriceForPlan,
      copySubscription,
      openPickForCopy,
      busyDevicePay,
      deviceSlotFileRef,
      submitDeviceSlotPayment,
      openDeviceSlotPay,
      refreshProfile,
      shareReferralInTelegram,
      friendRewardId,
      setFriendRewardId,
      friendRewardBusy,
      claimFriendReward,
      supportOpen,
      setSupportOpen,
      supportText,
      setSupportText,
      supportPhotos,
      setSupportPhotos,
      supportBusy,
      openSupportProfile,
      submitSupportAppeal,
      profileSubModalId,
      setProfileSubModalId,
      gameVisible,
      activeGame,
      gameTickets,
      dropperPlaying,
      isGameTab,
      dropperTargetUserId,
      dropperSession,
      dropperInstructionOpen,
      setDropperInstructionOpen,
      dropperPracticeModalOpen,
      setDropperPracticeModalOpen,
      dropperPracticeSkipNextHint,
      setDropperPracticeSkipNextHint,
      dropperNoTickets,
      dropperStartBusy,
      startDropperPlay,
      openDropperPracticeIntro,
      confirmDropperPracticePlay,
      finishDropperAndRefresh,
      bottomNavItems,
    };
    return <MySubWebAppNew ctrl={ctrl} />;
  }

  return (
    <div className={`mysub-wrap ${theme === "light" ? "mysub-wrap--light" : ""}`}>
      {err ? <div className="flash err">{err}</div> : null}
    </div>
  );
}
