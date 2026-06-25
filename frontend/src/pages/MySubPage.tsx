import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DropperGame from "../components/DropperGame";
import RouletteGame from "../components/RouletteGame";
import DropperLobbyHero from "../components/DropperLobbyHero";
import MySubProfileStats from "../components/MySubProfileStats";
import MySubBottomNav, { type MySubNavTabId } from "../components/MySubBottomNav";
import MySubLoadingScreen from "../mysub-new/components/MySubLoadingScreen";
import { prefetchDailyGiftImages } from "../mysub-new/dailyGiftPrefetch";
import MySubWebAppNew from "../mysub-new/MySubWebAppNew";
import type { MySubWebAppController } from "../mysub-new/types";
import {
  claimMySubReferralReward,
  loadMySubWebAppProfile,
  mySubAddDevice,
  mySubRemoveDevice,
  mySubRenameDevice,
  previewMySubPromoCode,
  sendMySubPaymentProof,
  sendMySubSupportAppeal,
  startDropperSession,
  type MySubProfileDto,
} from "../api";
import { subscriptionLabel } from "../subscriptionLabel";

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

/** Если название не ввели: имя последней подписки (max id) + порядковый номер (следующий по счёту). */
function defaultNewSubscriptionName(subs: MySubProfileDto["subscriptions"]): string {
  const ord = subs.length + 1;
  const ordStr = String(ord);
  if (!subs.length) return `Новая подписка ${ordStr}`.slice(0, 25);
  let latest = subs[0]!;
  for (const s of subs) if (s.id > latest.id) latest = s;
  const base = String(latest.name ?? "").trim() || "Подписка";
  const suffix = ` ${ordStr}`;
  const maxBase = Math.max(1, 25 - suffix.length);
  const trimmedBase = (base.length > maxBase ? base.slice(0, maxBase) : base).trimEnd();
  return `${trimmedBase}${suffix}`.slice(0, 25);
}

function formatMySubPlanMeta(p: { total_gb: number; days: number }): string {
  const gb = p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит";
  return `${gb} · ${p.days} дн.`;
}

function formatTopUpMeta(p: { add_gb: number }): string {
  return `+${p.add_gb} ГБ`;
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
  const [payProduct, setPayProduct] = useState<"subscription" | "topup" | "white_lists" | "device_slot">("subscription");
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
  const [promoApplied, setPromoApplied] = useState<{ code: string; discount_percent: number } | null>(null);
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
    const tgWebApp = (window as unknown as {
      Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
    }).Telegram?.WebApp;
    const direct = String(tgWebApp?.initData ?? "").trim();
    if (direct) return direct;
    const fromHash = new URLSearchParams(String(window.location.hash ?? "").replace(/^#/, "")).get("tgWebAppData");
    if (fromHash) return decodeURIComponent(fromHash);
    const fromQuery = new URLSearchParams(window.location.search).get("tgWebAppData");
    if (fromQuery) return decodeURIComponent(fromQuery);
    return "";
  }

  useEffect(() => {
    if (!document.getElementById("tg-webapp-script")) {
      const s = document.createElement("script");
      s.id = "tg-webapp-script";
      s.src = "https://telegram.org/js/telegram-web-app.js";
      s.async = true;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setErr("");
      const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
      const initData = getInitData();
      if (!initData) {
        setErr("Требуется авторизация через тг.");
        return;
      }
      tgWebApp?.ready?.();
      tgWebApp?.expand?.();
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
  /** Свечение за аватаром: нет подписок — голубое; есть активная — зелёное; иначе (истекла/лимит/выкл.) — красное. */
  const headGlowClass = useMemo(() => {
    if (!data) return "";
    if (data.subscriptions.length === 0) return "mysub-head--glow-blue";
    if (hasActiveSubscription) return "active-sub";
    return "mysub-head--glow-red";
  }, [data, hasActiveSubscription]);
  const payTargetSub = useMemo(() => {
    if (!data || payTargetId <= 0) return null;
    return data.subscriptions.find((s) => s.id === payTargetId) ?? null;
  }, [data, payTargetId]);
  const suggestedNewSubName = useMemo(() => {
    if (!data) return "";
    return defaultNewSubscriptionName(data.subscriptions);
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

  function switchPayProduct(next: "subscription" | "topup" | "white_lists" | "device_slot") {
    setPayIsTest(false);
    setPromoApplied(null);
    setPromoFeedback(null);
    setPromoCodeInput("");
    setPayPlanId(1);
    if ((next === "topup" || next === "white_lists" || next === "device_slot") && data?.subscriptions.length) {
      const wlId = next === "white_lists" ? data.whitelist?.purchase_user_id : null;
      if (wlId && wlId > 0) setPayTargetId(wlId);
      else if (next === "topup") {
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
    if (payProduct === "device_slot") {
      if (!payTargetId) {
        setMsg("Выберите подписку для докупки места.");
        return;
      }
      if (!payPhoto) {
        setMsg("Прикрепите фото чека об оплате.");
        return;
      }
    } else if (payProduct === "white_lists") {
      if (!data.whitelist?.can_buy) {
        setMsg(
          data.whitelist?.status === "connected"
            ? "Белые списки уже подключены."
            : data.whitelist?.block_reason || "Покупка белых списков недоступна.",
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
      payTargetId === 0 && !payIsTest ? (newSubName.trim() || defaultNewSubscriptionName(data.subscriptions)) : "";
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
        plan_id: payIsTest || payProduct === "white_lists" || payProduct === "device_slot" ? 1 : payPlanId,
        photo_base64: compressed.base64,
        photo_mime: compressed.mime,
        photo_name: compressed.name,
        new_subscription_name:
          payProduct === "subscription" && !payIsTest && payTargetId === 0 ? chosenNewName.slice(0, 25) : undefined,
        promo_code: payIsTest ? undefined : promoApplied?.code,
      });
      setMsg(
        payIsTest
          ? "Чек получен. Администратор проверит оплату и активирует тестовую подписку."
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
      });
      setPromoApplied({
        code: calc.promo.code,
        discount_percent: calc.discount_percent,
      });
      setPromoFeedback(null);
    } catch (e) {
      setPromoApplied(null);
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("promo_already_used")) setPromoFeedback({ type: "err", text: "Этот промокод уже был использован вами." });
      else if (m.includes("promo_not_found")) setPromoFeedback({ type: "err", text: "Промокод не найден." });
      else if (m.includes("promo_inactive")) setPromoFeedback({ type: "err", text: "Этот промокод сейчас неактивен." });
      else if (m.includes("promo_expired")) setPromoFeedback({ type: "err", text: "Срок действия этого промокода истек." });
      else if (m.includes("promo_new_users_only")) {
        setPromoFeedback({ type: "err", text: "Промокод только для новых пользователей без подписки." });
      } else setPromoFeedback({ type: "err", text: "Не удалось применить промокод." });
    }
  }

  const autoDiscountPercent = !payIsTest && !promoApplied ? data?.roulette_purchase_discount?.discount_percent ?? 0 : 0;
  const activeDiscountPercent = promoApplied?.discount_percent ?? autoDiscountPercent;

  const discountedPriceForPlan = (priceRub: number) => {
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
    const text = data.referral.invite_copy_text || "Присоединяйся по моей ссылке!";
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

  if (data && data.web_app_new_design === true) {
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
    <div
      className={`mysub-wrap ${theme === "light" ? "mysub-wrap--light" : ""} ${dropperPlaying ? "mysub-wrap--dropper-play" : ""} ${isGameTab ? "mysub-wrap--game-tab" : ""}`.trim()}
    >
      <div className={`mysub-card ${dropperPlaying ? "mysub-card--dropper-play" : ""}`.trim()}>
        {err ? <div className="flash err">{err}</div> : null}
        {data ? (
          <>
            {tab !== "game" ? (
              <div className={`mysub-head ${headGlowClass}`.trim()}>
                {data.avatar_url ? (
                  <img src={data.avatar_url} alt="avatar" className="mysub-avatar" />
                ) : (
                  <div className="mysub-avatar-fallback">{(data.name || "U").trim().slice(0, 1).toUpperCase()}</div>
                )}
                <h1 className="mysub-name">{data.name}</h1>
              </div>
            ) : null}

            {tab === "home" ? (
              <section className="mysub-section mysub-section-anim">
                <div className="mysub-hero-badges">
                  <span className="mysub-hero-badge">Ultra Secure</span>
                  <span className="mysub-hero-badge muted">Reality VPN</span>
                </div>
                <h3 className="mysub-title">Подключитесь за минуту</h3>
                <p className="sub">Быстрый и надежный VPN для стабильного подключения.</p>
                <div className="mysub-sub-box">
                  {data.subscriptions.length === 0 ? (
                    salesDisabledForNew ? (
                      <p className="mysub-no-sub-text">
                        Оформление новых подписок сейчас недоступно. Обратитесь к администратору.
                      </p>
                    ) : (
                      <>
                        <p className="mysub-no-sub-text">
                          У вас еще нет подписки! Купите её в разделе «Оплата».
                        </p>
                        <div className="row-actions" style={{ marginTop: "0.65rem", flexDirection: "column", alignItems: "stretch" }}>
                          <button type="button" className="primary" onClick={() => setTab("subscription")}>
                            Купить подписку
                          </button>
                          {testPlanAvailable ? (
                            <button type="button" className="ghost" onClick={openTestPay}>
                              Получить тестовую подписку
                            </button>
                          ) : null}
                        </div>
                      </>
                    )
                  ) : (
                    <>
                      {data.subscriptions.length > 1 ? (
                        <div className="form-field">
                          <label>Выберите подписку</label>
                          <select
                            value={homeSub?.id ? String(homeSub.id) : ""}
                            onChange={(e) => {
                              const id = Number(e.target.value) || 0;
                              setHomeSubId(id);
                              setPickedSubId(id);
                            }}
                          >
                            {data.subscriptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {subscriptionLabel(s)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <p className="sub" style={{ marginBottom: "0.4rem" }}>
                        {homeSub ? `Конфиг: ${subscriptionLabel(homeSub)}` : "Выберите подписку"}
                      </p>
                      <div className="mysub-url">{homeSub?.subscription_url || "Нажмите кнопку «Скопировать конфиг»"}</div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={!homeSub}
                          onClick={() => {
                            if (!homeSub || (data.subscriptions.length > 1 && !showPickModal)) {
                              openPickForCopy();
                              return;
                            }
                            void copySubscription(homeSub.subscription_url);
                          }}
                        >
                          ⚡ Скопировать конфиг
                        </button>
                        {data.subscriptions.length === 1 ? (
                          <button type="button" className="ghost" onClick={() => setTab("subscription")}>
                            ✨ Купить еще подписку
                          </button>
                        ) : null}
                        <button type="button" className="ghost" onClick={() => setShowInstruction(true)}>
                          📘 Инструкция
                        </button>
                      </div>
                      {homeSub && homeSub.devices && homeSub.devices.enabled ? (
                        <div className="mysub-sub-box mysub-devices-box">
                          {(() => {
                            const dev = homeSub.devices!;
                            const limitN = Math.max(dev.limit, data.device_limit?.default_slots ?? dev.limit);
                            const freeN = Math.max(0, limitN - dev.used);
                            return (
                              <>
                          <div className="mysub-devices-head">
                            <h3 className="mysub-title">Подключенные устройства</h3>
                            <p className="sub mysub-devices-summary">
                              {dev.used} из {limitN} занято
                              {freeN > 0 ? ` · можно добавить ещё ${freeN}` : " · лимит исчерпан"}
                            </p>
                          </div>
                          <div className="mysub-device-metrics">
                            <div className="mysub-device-metric">
                              <span className="mysub-device-metric__val">{dev.used}</span>
                              <span className="mysub-device-metric__lbl">Используется</span>
                            </div>
                            <div className="mysub-device-metric">
                              <span className="mysub-device-metric__val">{limitN}</span>
                              <span className="mysub-device-metric__lbl">Лимит</span>
                            </div>
                            <div className="mysub-device-metric mysub-device-metric--accent">
                              <span className="mysub-device-metric__val">{freeN}</span>
                              <span className="mysub-device-metric__lbl">Свободно</span>
                            </div>
                          </div>
                          {homeSub.devices.devices.length === 0 ? (
                            <p className="sub mysub-devices-empty">
                              Устройства пока не подключены. Скопируйте ссылку VPN — первое устройство привяжется автоматически.
                            </p>
                          ) : (
                            <ul className="mysub-device-list">
                              {homeSub.devices.devices.map((d) => (
                                <li key={d.id} className="mysub-device-item">
                                  <div className="mysub-device-item__head">
                                    <span className="mysub-device-item__icon">{d.device_icon}</span>
                                    <div className="mysub-device-item__title">
                                      <b>{d.device_name}</b>
                                      <span className="mysub-device-item__type">
                                        {d.device_type ? d.device_type : "Устройство"}
                                      </span>
                                      <span className="mysub-device-item__meta">
                                        {new Date(d.last_seen_at).toLocaleString("ru-RU")}
                                        {d.last_ip ? ` · ${d.last_ip}` : ""}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="mysub-device-item__actions">
                                    <button type="button" className="ghost" onClick={() => void copySubscription(d.subscription_url)}>
                                      Ссылка
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => {
                                        const name = window.prompt("Название устройства", d.device_name);
                                        if (!name || !homeSub) return;
                                        void mySubRenameDevice({ init_data: initData, user_id: homeSub.id, device_id: d.id, name })
                                          .then(() => loadMySubWebAppProfile(initData))
                                          .then(setData)
                                          .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
                                      }}
                                    >
                                      Имя
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost mysub-device-item__danger"
                                      onClick={() => {
                                        if (!homeSub || !window.confirm(`Удалить ${d.device_name}?`)) return;
                                        void mySubRemoveDevice({ init_data: initData, user_id: homeSub.id, device_id: d.id })
                                          .then(() => loadMySubWebAppProfile(initData))
                                          .then(setData)
                                          .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
                                      }}
                                    >
                                      Удалить
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="mysub-device-footer">
                            {freeN > 0 ? (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busyDevicePay}
                                onClick={() => {
                                  void mySubAddDevice({ init_data: initData, user_id: homeSub!.id })
                                    .then((r) => {
                                      void copySubscription(r.device.subscription_url);
                                      return loadMySubWebAppProfile(initData);
                                    })
                                    .then(setData)
                                    .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
                                }}
                              >
                                + Добавить устройство
                              </button>
                            ) : null}
                            {homeSub.devices.can_buy_slot && homeSub.devices.purchase_enabled ? (
                              <>
                                <input
                                  ref={deviceSlotFileRef}
                                  type="file"
                                  accept="image/*"
                                  style={{ display: "none" }}
                                  disabled={busyDevicePay}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f && homeSub) void submitDeviceSlotPayment(f, homeSub.id);
                                    e.target.value = "";
                                  }}
                                />
                                <button
                                  type="button"
                                  className="primary"
                                  disabled={busyDevicePay}
                                  onClick={() => deviceSlotFileRef.current?.click()}
                                >
                                  {busyDevicePay
                                    ? "Отправка…"
                                    : `Купить место · ${homeSub.devices.purchase_price_rub} ₽`}
                                </button>
                              </>
                            ) : null}
                          </div>
                              </>
                            );
                          })()}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                {data.whitelist?.visible ? (
                  <div className="mysub-sub-box" style={{ marginTop: "0.65rem" }}>
                    <h3 className="mysub-title" style={{ marginBottom: "0.45rem" }}>
                      Белые списки
                    </h3>
                    <p className="sub" style={{ margin: "0 0 0.55rem" }}>
                      {data.whitelist.description}
                    </p>
                    <p className="sub">
                      Статус:{" "}
                      <b>
                        {data.whitelist.status === "connected"
                          ? data.whitelist.active_until
                            ? `Подключено · до ${new Date(data.whitelist.active_until).toLocaleDateString("ru-RU")}`
                            : "Подключено"
                          : data.whitelist.status === "suspended"
                            ? data.whitelist.remaining_days
                              ? `Приостановлено · осталось ${data.whitelist.remaining_days} дн.`
                              : "Приостановлено · нужна основная подписка"
                            : data.whitelist.status === "expired"
                              ? "Истекли"
                              : "Не подключено"}
                      </b>
                    </p>
                    {data.whitelist.status !== "connected" && data.whitelist.can_buy ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.55rem" }}>
                        <span className="sub">
                          Цена: <b>{data.whitelist.price_rub} ₽</b>
                        </span>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => {
                            switchPayProduct("white_lists");
                            setTab("subscription");
                          }}
                        >
                          Купить белые списки
                        </button>
                      </div>
                    ) : data.whitelist.status !== "connected" && data.whitelist.block_reason ? (
                      <p className="sub" style={{ marginTop: "0.55rem", color: "var(--danger, #f87171)" }}>
                        {data.whitelist.block_reason}
                      </p>
                    ) : null}
                    {data.whitelist.status === "connected" ? (
                      <button
                        type="button"
                        className="ghost"
                        style={{ marginTop: "0.55rem", width: "100%" }}
                        onClick={() => setShowWhitelistInstruction(true)}
                      >
                        Инструкция по обновлению подписки
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="mysub-highlight-box">
                  <b>Почему выбирают нас?</b>
                  <span>YouTube в 4K без ограничений и тормозов.</span>
                  <span>Доступ ко всем популярным нейросетям без блокировок.</span>
                  <span>Стабильный пинг для игр без лагов и разрывов.</span>
                  <span>Telegram, звонки и медиа работают мгновенно.</span>
                </div>
              </section>
            ) : tab === "subscription" ? (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Оплата</h3>
                <div className="mysub-sub-box" style={{ marginBottom: "0.65rem" }}>
                  <div className="form-field">
                    <label>Что оплачиваете</label>
                    <div className="mysub-stat-list">
                      <button
                        type="button"
                        className={payProduct === "subscription" ? "primary" : "ghost"}
                        onClick={() => switchPayProduct("subscription")}
                        style={{ width: "100%" }}
                      >
                        Тариф подписки
                      </button>
                      <button
                        type="button"
                        className={payProduct === "topup" ? "primary" : "ghost"}
                        disabled={!data.subscriptions.length}
                        onClick={() => switchPayProduct("topup")}
                        style={{ width: "100%" }}
                      >
                        Докупка ГБ
                      </button>
                      {data.whitelist?.visible ? (
                        <button
                          type="button"
                          className={payProduct === "white_lists" ? "primary" : "ghost"}
                          disabled={
                            !data.subscriptions.length ||
                            data.whitelist.status === "connected" ||
                            !data.whitelist.can_buy
                          }
                          onClick={() => switchPayProduct("white_lists")}
                          style={{ width: "100%" }}
                        >
                          Белые списки
                        </button>
                      ) : null}
                    </div>
                    {payProduct === "topup" && !data.subscriptions.length ? (
                      <p className="field-hint" style={{ marginTop: "0.4rem" }}>
                        Нужна привязанная подписка. Обратитесь к администратору или оформите тариф.
                      </p>
                    ) : null}
                  </div>
                </div>
                {payProduct === "subscription" && data.subscriptions.length > 0 ? (
                  <div className="mysub-sub-box" style={{ marginBottom: "0.65rem" }}>
                    <div className="form-field" style={{ marginBottom: "0.6rem" }}>
                      <label>Новая подписка</label>
                      <button
                        type="button"
                        className={payTargetId === 0 ? "primary" : "ghost"}
                        onClick={() => setPayTargetId(0)}
                        style={{ width: "100%" }}
                      >
                        Оформить ещё одну
                      </button>
                    </div>
                    <div className="form-field">
                      <label>Продлить или пополнить</label>
                      <div className="mysub-stat-list">
                        {data.subscriptions.map((s) => (
                          <button
                            key={`pay-target-${s.id}`}
                            type="button"
                            className={payTargetId === s.id ? "primary" : "ghost"}
                            onClick={() => setPayTargetId(s.id)}
                          >
                            {subscriptionLabel(s)}
                            {s.allowed ? " · активна" : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                    {payTargetId === 0 ? (
                      <div className="form-field" style={{ marginTop: "0.6rem" }}>
                        <label>Название новой подписки</label>
                        <input
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value.slice(0, 25))}
                          placeholder={suggestedNewSubName || "Например: Для мамы"}
                        />
                        {suggestedNewSubName ? (
                          <p className="field-hint" style={{ marginTop: "0.3rem" }}>
                            Если оставить пустым, будет: «{suggestedNewSubName}».
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="sub" style={{ margin: "0.5rem 0 0" }}>
                        Средства зачислим в подписку {payTargetSub ? subscriptionLabel(payTargetSub) : ""}
                      </p>
                    )}
                  </div>
                ) : payProduct === "white_lists" && data.subscriptions.length > 0 ? (
                  <div className="mysub-sub-box" style={{ marginBottom: "0.65rem" }}>
                    <div className="form-field">
                      <label>Подписка для белых списков</label>
                      <div className="mysub-stat-list">
                        {data.subscriptions.map((s) => (
                          <button
                            key={`pay-wl-${s.id}`}
                            type="button"
                            className={payTargetId === s.id ? "primary" : "ghost"}
                            onClick={() => setPayTargetId(s.id)}
                          >
                            {subscriptionLabel(s)}
                            {s.allowed ? " · активна" : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="field-hint" style={{ marginTop: "0.45rem" }}>
                      {data.whitelist?.description ||
                        "Дополнительные VLESS-ключи для доступа к ресурсам из белого списка."}
                    </p>
                  </div>
                ) : payProduct === "topup" && data.subscriptions.length > 0 ? (
                  <div className="mysub-sub-box" style={{ marginBottom: "0.65rem" }}>
                    <div className="form-field">
                      <label>Подписка для докупки ГБ</label>
                      <div className="mysub-stat-list">
                        {data.subscriptions.map((s) => (
                          <button
                            key={`pay-topup-${s.id}`}
                            type="button"
                            className={payTargetId === s.id ? "primary" : "ghost"}
                            onClick={() => setPayTargetId(s.id)}
                          >
                            {subscriptionLabel(s)}
                            {s.allowed ? " · активна" : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="mysub-sub-box mysub-pay-panel">
                  <p className="mysub-pay-lead">
                    {salesDisabledForNew && data.subscriptions.length === 0
                      ? "Оформление новых подписок и тестовой подписки сейчас недоступно."
                      : payProduct === "white_lists"
                        ? data.whitelist?.status === "connected"
                          ? "Белые списки уже подключены к вашей подписке."
                          : `Покупка белых списков для ${payTargetSub ? subscriptionLabel(payTargetSub) : "подписки"}. После оплаты VLESS-ключи будут добавлены в подписку.`
                      : payProduct === "topup"
                      ? data.subscriptions.length === 0
                        ? "Докупка ГБ станет доступна после привязки подписки к этому Telegram."
                        : `Докупка ГБ для подписки ${payTargetSub ? subscriptionLabel(payTargetSub) : ""}. Лимит трафика увеличится после подтверждения оплаты.`
                      : data.subscriptions.length === 0
                        ? "У вас пока нет подписок. Выберите тариф, оплатите и отправьте чек — после проверки администратором появится доступ."
                        : payTargetId === 0
                          ? "Оплата пойдёт на новую подписку — после подтверждения чека вы получите отдельный конфиг."
                          : `Оплата для продления: ${payTargetSub ? subscriptionLabel(payTargetSub) : ""}.`}
                  </p>
                  <div className="mysub-pay-flow">
                    <div className="mysub-pay-step">
                      <span className="mysub-pay-step-badge">1</span>
                      <div className="mysub-pay-step-body">
                        <p className="mysub-pay-step-title">
                          {payProduct === "topup" ? "Пакет ГБ" : payProduct === "white_lists" ? "Белые списки" : "Тариф"}
                        </p>
                        {payProduct === "white_lists" ? (
                          <div className="mysub-plan-card is-selected" style={{ maxWidth: "100%" }}>
                            <span className="mysub-plan-card-title">Белые списки</span>
                            <span className="mysub-plan-card-meta">Дополнение к текущей подписке</span>
                            <span className="mysub-plan-card-price">{data.whitelist?.price_rub ?? 0} ₽</span>
                          </div>
                        ) : (
                        <div
                          className="mysub-plan-grid"
                          role="radiogroup"
                          aria-label={payProduct === "topup" ? "Пакет докупки" : "Тариф"}
                        >
                          {payProduct === "topup"
                            ? (data.topup_plans ?? []).map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={payPlanId === p.id}
                                  className={`mysub-plan-card ${payPlanId === p.id ? "is-selected" : ""}`.trim()}
                                  onClick={() => setPayPlanId(p.id)}
                                >
                                  <span className="mysub-plan-card-title">{p.title.trim() || `Пакет ${p.id}`}</span>
                                  <span className="mysub-plan-card-meta">{formatTopUpMeta(p)}</span>
                                  <span className="mysub-plan-card-price">
                                    {activeDiscountPercent ? (
                                      <>
                                        <s>{p.price_rub} ₽</s> {discountedPriceForPlan(p.price_rub)} ₽
                                      </>
                                    ) : (
                                      `${p.price_rub} ₽`
                                    )}
                                  </span>
                                </button>
                              ))
                            : (
                              <>
                                {testPlanAvailable && data.subscriptions.length === 0 && data.test_plan ? (
                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={payIsTest}
                                    className={`mysub-plan-card ${payIsTest ? "is-selected" : ""}`.trim()}
                                    onClick={() => {
                                      setPayIsTest(true);
                                      setPromoApplied(null);
                                      setPromoFeedback(null);
                                      setPromoCodeInput("");
                                    }}
                                  >
                                    <span className="mysub-plan-card-title">
                                      {data.test_plan.title.trim() || "Тестовая подписка"}
                                    </span>
                                    <span className="mysub-plan-card-meta">
                                      {formatMySubPlanMeta(data.test_plan)}
                                    </span>
                                    <span className="mysub-plan-card-price">{data.test_plan.price_rub} ₽</span>
                                  </button>
                                ) : null}
                                {data.plans.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={!payIsTest && payPlanId === p.id}
                                  className={`mysub-plan-card ${!payIsTest && payPlanId === p.id ? "is-selected" : ""}`.trim()}
                                  onClick={() => {
                                    setPayIsTest(false);
                                    setPayPlanId(p.id);
                                  }}
                                >
                                  <span className="mysub-plan-card-title">{p.title.trim() || `Тариф ${p.id}`}</span>
                                  <span className="mysub-plan-card-meta">{formatMySubPlanMeta(p)}</span>
                                  <span className="mysub-plan-card-price">
                                    {activeDiscountPercent ? (
                                      <>
                                        <s>{p.price_rub} ₽</s> {discountedPriceForPlan(p.price_rub)} ₽
                                      </>
                                    ) : (
                                      `${p.price_rub} ₽`
                                    )}
                                  </span>
                                </button>
                              ))}
                              </>
                            )}
                        </div>
                        )}
                      </div>
                    </div>
                    <div className="mysub-pay-step">
                      <span className="mysub-pay-step-badge">2</span>
                      <div className="mysub-pay-step-body">
                        <p className="mysub-pay-step-title">Оплата</p>
                        <p className="sub">
                          {payProduct === "white_lists" ? (
                            <>В комментарии к переводу укажите: <b>white_lists</b>.</>
                          ) : payProduct === "topup" ? (
                            <>
                              В комментарии к переводу укажите <b>номер пакета докупки</b>: <b>{payPlanId}</b> (обычно{" "}
                              <code>1</code>, <code>2</code> или <code>3</code>).
                            </>
                          ) : payIsTest ? (
                            <>В комментарии к переводу укажите слово <b>тест</b>. Промокоды к тестовой подписке не применяются.</>
                          ) : (
                            <>
                              В комментарии к переводу укажите номер тарифа: <b>{payPlanId}</b>.
                            </>
                          )}
                        </p>
                        {!payIsTest && payProduct !== "white_lists" ? (
                        <div className="mysub-promo-box">
                          <input
                            className="mysub-promo-input"
                            value={promoCodeInput}
                            onChange={(e) => setPromoCodeInput(e.target.value.replace(/\s+/g, "").toLocaleUpperCase("ru-RU"))}
                            placeholder="Введите промокод"
                          />
                          <button type="button" className="ghost mysub-promo-apply-btn" onClick={() => void applyPromoCode()}>
                            Применить промокод
                          </button>
                          {promoApplied && (payProduct === "topup" ? selectedTopUpPlan : selectedPlan) ? (
                            <p className="mysub-promo-feedback ok">
                              Скидка применилась! К оплате {discountedPriceForPlan((payProduct === "topup" ? selectedTopUpPlan! : selectedPlan!).price_rub)}{" "}
                              руб
                            </p>
                          ) : autoDiscountPercent > 0 && (payProduct === "topup" ? selectedTopUpPlan : selectedPlan) ? (
                            <p className="mysub-promo-feedback ok">
                              Применена автоскидка {autoDiscountPercent}%. К оплате{" "}
                              {discountedPriceForPlan((payProduct === "topup" ? selectedTopUpPlan! : selectedPlan!).price_rub)} руб
                            </p>
                          ) : promoFeedback ? (
                            <p className="mysub-promo-feedback err">{promoFeedback.text}</p>
                          ) : null}
                        </div>
                        ) : null}
                        <a className="mysub-pay-link-btn" href={data.payment_url} target="_blank" rel="noreferrer">
                          Перейти к оплате
                        </a>
                      </div>
                    </div>
                    <div className="mysub-pay-step">
                      <span className="mysub-pay-step-badge">3</span>
                      <div className="mysub-pay-step-body">
                        <p className="mysub-pay-step-title">Чек</p>
                        <p className="sub">Прикрепите фото или скриншот чека — так мы быстрее найдём платёж.</p>
                        <label className="mysub-file-btn">
                          <input
                            className="mysub-file-input"
                            type="file"
                            accept="image/*"
                            onChange={(e) => setPayPhoto(e.target.files?.[0] ?? null)}
                          />
                          {payPhoto ? "Заменить файл" : "Выбрать фото чека"}
                        </label>
                        <p className="field-hint">{payPhoto ? `Выбрано: ${payPhoto.name}` : "Файл не выбран."}</p>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    style={{ width: "100%", marginTop: "0.35rem" }}
                    disabled={busyPay}
                    onClick={() => void submitPaymentProof()}
                  >
                    {busyPay ? "Отправка..." : "Отправить чек на проверку"}
                  </button>
                </div>
              </section>
            ) : tab === "friends" ? (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Друзья</h3>
                {data.referral?.enabled ? (
                  <>
                    <div className="mysub-sub-box">
                      <p style={{ margin: 0, fontWeight: 700 }}>Приглашайте друзей</p>
                      <p className="sub" style={{ marginTop: "0.35rem" }}>
                        Отправьте ссылку другу. Когда он откроет приложение, вам начислится награда.
                      </p>
                      <div className="mysub-url">{data.referral.invite_link || "Реферальная ссылка недоступна"}</div>
                      <div className="row-actions">
                        <button type="button" className="primary" disabled={!data.referral.invite_link} onClick={shareReferralInTelegram}>
                          Отправить в Telegram
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={!data.referral.invite_link}
                          onClick={() => {
                            if (data.referral.invite_link) void copySubscription(data.referral.invite_link);
                          }}
                        >
                          Скопировать ссылку
                        </button>
                      </div>
                    </div>
                    <div className="mysub-sub-box" style={{ marginTop: "0.65rem" }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>Приглашенные друзья</p>
                      <div className="mysub-stat-list" style={{ marginTop: "0.55rem" }}>
                        {data.referral.invited_friends.length === 0 ? (
                          <div>Пока никого не приглашено.</div>
                        ) : (
                          data.referral.invited_friends.map((f, idx) => (
                            <div key={`${f.tg_user_id}-${idx}`} className="mysub-friend-row">
                              <span>
                                {f.name} • {new Date(f.created_at).toLocaleDateString("ru-RU")} •{" "}
                                {f.status === "claimed" ? "награда выдана" : "ожидает награду"}
                              </span>
                              {f.status === "pending" ? (
                                <button type="button" className="mysub-gift-btn" onClick={() => setFriendRewardId(f.reward_id)}>
                                  🎁
                                </button>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="sub">Реферальная программа временно отключена.</p>
                )}
              </section>
            ) : tab === "game" && gameVisible && activeGame === "roulette" && data.roulette ? (
              <RouletteGame
                initData={initData}
                subscriptions={data.subscriptions.map((s) => ({
                  id: s.id,
                  name: s.name,
                  tickets: s.tickets ?? 0,
                  total_gb: s.total_gb,
                  expiry_time: s.expiry_time,
                  gb_piggy: s.gb_piggy ?? null,
                  stats: {
                    remaining_days: s.stats.remaining_days,
                    remaining_gb: s.stats.remaining_gb ?? null,
                    unlimited_traffic: s.stats.unlimited_traffic,
                    unlimited_time: s.stats.unlimited_time,
                  },
                }))}
                ticketsPerPurchase={data.roulette.tickets_per_purchase ?? data.tickets_per_purchase ?? 1}
                prizes={data.roulette.prizes ?? []}
                ticketShop={data.roulette.ticket_shop}
                history={data.roulette.history ?? []}
                ticketPurchaseHistory={data.roulette.ticket_purchase_history ?? []}
                onSubscriptionUpdate={(subId, patch) =>
                  setData((prev) => {
                    if (!prev) return prev;
                    const subs = prev.subscriptions.map((s) =>
                      s.id !== subId
                        ? s
                        : {
                            ...s,
                            ...(patch.tickets != null ? { tickets: patch.tickets } : {}),
                            ...(patch.gb_piggy !== undefined ? { gb_piggy: patch.gb_piggy } : {}),
                          },
                    );
                    const totalTickets = subs.reduce((sum, s) => sum + (s.tickets ?? 0), 0);
                    return {
                      ...prev,
                      subscriptions: subs,
                      dropper: { ...prev.dropper, tickets: totalTickets },
                      roulette: prev.roulette ? { ...prev.roulette, tickets: totalTickets } : prev.roulette,
                    };
                  })
                }
                onBuyClick={() => setTab("subscription")}
                onRefreshProfile={() => {
                  if (!initData) return;
                  void loadMySubWebAppProfile(initData).then(setData).catch(() => {});
                }}
              />
            ) : tab === "game" && gameVisible && activeGame === "dropper" && data.dropper.enabled ? (
              <div className={`mysub-dropper-page ${dropperSession ? "mysub-dropper-page--playing" : ""}`.trim()}>
                <section className="mysub-section mysub-dropper-section">
                  {!dropperSession ? (
                    <h1 className="mysub-dropper-hero-title" aria-label="Дроппер">
                      Дроппер
                    </h1>
                  ) : null}
                  {!dropperSession ? (
                    <p className="mysub-dropper-tickets">
                      Билетов:{" "}
                      <b>
                        {data.subscriptions.find((s) => s.id === dropperTargetUserId)?.tickets ??
                          data.dropper.tickets}
                      </b>
                    </p>
                  ) : null}

                  <div className={`mysub-dropper-lobby ${dropperSession ? "mysub-dropper-lobby--hidden" : ""}`}>
                    <div className="mysub-dropper-cliff" aria-hidden>
                      <DropperLobbyHero />
                    </div>

                    {data.subscriptions.length > 1 ? (
                      <div className="form-field mysub-dropper-field">
                        <label className="mysub-dropper-label">Подписка для награды</label>
                        <select
                          value={String(dropperTargetUserId)}
                          onChange={(e) => setPickedSubId(Number(e.target.value) || 0)}
                        >
                          {data.subscriptions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {subscriptionLabel(s)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className="mysub-dropper-btn-pixel mysub-dropper-btn-pixel--primary"
                      disabled={dropperStartBusy || !dropperTargetUserId}
                      onClick={() => void startDropperPlay()}
                    >
                      {dropperStartBusy ? "Запуск…" : "Играть"}
                    </button>

                    <button
                      type="button"
                      className="mysub-dropper-btn-pixel mysub-dropper-btn-pixel--ghost"
                      style={{ marginTop: "0.5rem" }}
                      disabled={dropperStartBusy}
                      onClick={() => openDropperPracticeIntro()}
                    >
                      Тренировка
                    </button>

                    {dropperNoTickets ? (
                      <p className="mysub-dropper-pixel-hint">
                        Нет билетов. Чтобы получить билеты, совершите любую покупку в разделе «Оплата».
                      </p>
                    ) : null}

                    <button
                      type="button"
                      className="mysub-dropper-btn-pixel mysub-dropper-btn-pixel--ghost"
                      onClick={() => setDropperInstructionOpen(true)}
                    >
                      Инструкция
                    </button>
                  </div>

                  <div
                    className={`mysub-dropper-stats-wrap ${dropperSession ? "mysub-dropper-stats-wrap--hidden" : ""}`.trim()}
                  >
                    <div className="mysub-dropper-stats-fog" aria-hidden />
                    <div className="mysub-dropper-stats">
                      <p className="mysub-dropper-stats-title">Ваша статистика</p>
                      <p>Попыток: {data.dropper.plays}</p>
                      <p>Побед: {data.dropper.wins}</p>
                      <p>
                        Выиграно: {data.dropper.won_gb > 0 ? `${data.dropper.won_gb} ГБ` : ""}
                        {data.dropper.won_gb > 0 && data.dropper.won_days > 0 ? " · " : ""}
                        {data.dropper.won_days > 0 ? `${data.dropper.won_days} дн.` : ""}
                        {data.dropper.won_gb === 0 && data.dropper.won_days === 0 ? "—" : ""}
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Профиль</h3>
                <MySubProfileStats subscription={profileSub} whitelist={data.whitelist} />
                <div className="mysub-sub-box" style={{ marginTop: "0.75rem" }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{data.name}</p>
                  <p className="sub" style={{ marginTop: "0.35rem" }}>Список подписок:</p>
                  <div className="mysub-stat-list">
                    {data.subscriptions.length === 0 ? (
                      <div>Подписок пока нет.</div>
                    ) : (
                      data.subscriptions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={pickedSubId === s.id ? "primary" : "ghost"}
                          onClick={() => {
                            setPickedSubId(s.id);
                            setProfileSubModalId(s.id);
                          }}
                        >
                          {subscriptionLabel(s)}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="mysub-sub-box" style={{ marginTop: "0.65rem" }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>Оформление</p>
                  <p className="sub" style={{ marginTop: "0.35rem", marginBottom: "0.5rem" }}>
                    Тема интерфейса мини-приложения
                  </p>
                  <div className="mysub-theme-toggle" role="group" aria-label="Выбор темы">
                    <button
                      type="button"
                      className={theme === "dark" ? "primary" : "ghost"}
                      onClick={() => applyMySubTheme("dark")}
                    >
                      Тёмная
                    </button>
                    <button
                      type="button"
                      className={theme === "light" ? "primary" : "ghost"}
                      onClick={() => applyMySubTheme("light")}
                    >
                      Светлая
                    </button>
                  </div>
                </div>
                {data.support_appeals?.enabled ? (
                  <div className="row-actions" style={{ marginTop: "0.75rem" }}>
                    <button type="button" className="ghost" onClick={openSupportProfile}>
                      Сообщить о проблеме
                    </button>
                  </div>
                ) : null}
              </section>
            )}

            {msg && !dropperPlaying ? <div className="flash ok">{msg}</div> : null}
            {!dropperPlaying ? (
              <MySubBottomNav
                items={bottomNavItems}
                active={tab}
                onChange={setTab}
                fiveColumns={gameVisible}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {data && dropperSession && dropperPlaying
        ? createPortal(
            <div className="mysub-dropper-run-portal">
              <DropperGame
                initData={initData}
                sessionId={dropperSession.sessionId}
                seed={dropperSession.seed}
                targetUserId={dropperTargetUserId > 0 ? dropperTargetUserId : data.subscriptions[0]?.id ?? 0}
                profile={data}
                fullscreen
                practiceMode={dropperSession.practice === true}
                onDone={() => void finishDropperAndRefresh()}
              />
            </div>,
            document.body,
          )
        : null}
      {supportOpen
        ? createPortal(
            <div
              className={`mysub-support-portal ${theme === "light" ? "mysub-support-portal--light" : ""}`.trim()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="mysub-support-title"
            >
              <div className="modal-backdrop" onClick={() => !supportBusy && setSupportOpen(false)}>
                <div className="modal mysub-modal mysub-support-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-head">
                    <h2 id="mysub-support-title">Сообщить о проблеме</h2>
                    <button
                      type="button"
                      className="ghost modal-close"
                      disabled={supportBusy}
                      onClick={() => setSupportOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="modal-body">
                    <p className="sub" style={{ marginTop: 0 }}>
                      Если у вас возник вопрос или проблема, опишите её. При необходимости приложите фото — мы
                      постараемся помочь.
                    </p>
                    <div className="form-field" style={{ marginTop: "0.75rem" }}>
                      <label>Описание</label>
                      <textarea
                        rows={5}
                        value={supportText}
                        onChange={(e) => setSupportText(e.target.value)}
                        placeholder="Что произошло?"
                        maxLength={8000}
                        disabled={supportBusy}
                      />
                    </div>
                    <div className="form-field" style={{ marginTop: "0.65rem" }}>
                      <label>Фото (необязательно)</label>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={supportBusy || supportPhotos.length >= 5}
                        onChange={(e) => {
                          const list = Array.from(e.target.files ?? []);
                          setSupportPhotos((prev) => [...prev, ...list].slice(0, 5));
                          e.target.value = "";
                        }}
                      />
                      <p className="field-hint">
                        {supportPhotos.length ? `Выбрано файлов: ${supportPhotos.length}` : "До 5 изображений."}
                      </p>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="ghost" disabled={supportBusy} onClick={() => setSupportOpen(false)}>
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={supportBusy}
                      onClick={() => void submitSupportAppeal()}
                    >
                      {supportBusy ? "Отправка…" : "Отправить"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {showInstruction ? (
        <div className="modal-backdrop" onClick={() => setShowInstruction(false)}>
          <div className="modal mysub-modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Инструкция</h2>
              <button type="button" className="ghost modal-close" onClick={() => setShowInstruction(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="mysub-sub-box">
                <p><b>1. Установите приложение</b></p>
                <p className="sub">Скачайте одно из приложений: <b>Happ</b>, <b>V2rayTun</b> или <b>V2rayBox</b>.</p>
              </div>
              <div className="mysub-sub-box" style={{ marginTop: "0.7rem" }}>
                <p><b>2. Подключение</b></p>
                <ol style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)" }}>
                  <li>Скопируйте конфиг в кабинете.</li>
                  <li>Откройте приложение.</li>
                  <li>Импортируйте конфиг из буфера.</li>
                  <li>Нажмите подключить.</li>
                </ol>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setShowInstruction(false)}>
                Понятно
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showWhitelistInstruction && data?.whitelist?.instruction ? (
        <div className="modal-backdrop" onClick={() => setShowWhitelistInstruction(false)}>
          <div className="modal mysub-modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{data.whitelist.instruction.title || "Как обновить подписку"}</h2>
              <button type="button" className="ghost modal-close" onClick={() => setShowWhitelistInstruction(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {data.whitelist.instruction.photo_url ? (
                <img
                  src={data.whitelist.instruction.photo_url}
                  alt=""
                  style={{ width: "100%", borderRadius: "8px", marginBottom: "0.75rem" }}
                />
              ) : null}
              <div className="mysub-sub-box">
                <p className="sub" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {data.whitelist.instruction.text}
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setShowWhitelistInstruction(false)}>
                Понятно
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dropperPracticeModalOpen ? (
        <div className="modal-backdrop" onClick={() => setDropperPracticeModalOpen(false)}>
          <div className="modal mysub-modal mysub-dropper-practice-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head mysub-dropper-practice-modal-head">
              <h2 className="mysub-dropper-modal-title">Тренировка</h2>
              <button type="button" className="ghost modal-close" onClick={() => setDropperPracticeModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="mysub-dropper-pixel-hint mysub-dropper-practice-modal-text">
                Это бесплатный режим, чтобы потренироваться: управление как в обычной игре, но билет не тратится,
                попытки не идут в статистику, наград в конце нет. Когда будете готовы — играйте с билетом и
                выбирайте подарок.
              </p>
              <label className="mysub-dropper-practice-check">
                <input
                  type="checkbox"
                  checked={dropperPracticeSkipNextHint}
                  onChange={(e) => setDropperPracticeSkipNextHint(e.target.checked)}
                />
                <span>Не показывать это окно</span>
              </label>
            </div>
            <div className="modal-footer mysub-dropper-practice-modal-footer">
              <button type="button" className="mysub-dropper-btn-pixel mysub-dropper-btn-pixel--ghost" onClick={() => setDropperPracticeModalOpen(false)}>
                Отмена
              </button>
              <button type="button" className="mysub-dropper-btn-pixel mysub-dropper-btn-pixel--primary" onClick={() => confirmDropperPracticePlay()}>
                Играть
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dropperInstructionOpen ? (
        <div className="modal-backdrop" onClick={() => setDropperInstructionOpen(false)}>
          <div className="modal mysub-modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="mysub-dropper-modal-title">Как играть</h2>
              <button type="button" className="ghost modal-close" onClick={() => setDropperInstructionOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="mysub-dropper-pixel-hint" style={{ lineHeight: 1.85, margin: 0 }}>
                Ведите пальцем по экрану влево и вправо — так вы управляете падением. Отдельных кнопок и стрелок нет.
                Пролетайте между препятствиями и приземлитесь на жёлтую финишную полосу внизу.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setDropperInstructionOpen(false)}>
                Понятно
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showPickModal && data && data.subscriptions.length > 0 ? (
        <div className="modal-backdrop" onClick={() => setShowPickModal(false)}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Выбор подписки</h2>
              <button type="button" className="ghost modal-close" onClick={() => setShowPickModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="mysub-pick-sub-list">
                {data.subscriptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`mysub-pick-sub-item ${pickedSubId === s.id ? "is-selected" : ""}`}
                    onClick={() => setPickedSubId(s.id)}
                  >
                    {subscriptionLabel(s)}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer mysub-pick-modal-footer">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const selected = data.subscriptions.find((s) => s.id === pickedSubId) ?? data.subscriptions[0];
                  setShowPickModal(false);
                  if (!selected) return;
                  setPickedSubId(selected.id);
                  void copySubscription(selected.subscription_url);
                }}
              >
                Выбрать
              </button>
              <button type="button" className="ghost" onClick={() => setShowPickModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {profileSubModalId > 0 && data ? (
        <div className="modal-backdrop" onClick={() => setProfileSubModalId(0)}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Подписка</h2>
              <button type="button" className="ghost modal-close" onClick={() => setProfileSubModalId(0)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {(() => {
                const s = data.subscriptions.find((x) => x.id === profileSubModalId);
                if (!s) return <p className="sub">Подписка не найдена.</p>;
                return (
                  <div className="mysub-stat-list">
                    <div><b>{subscriptionLabel(s)}</b></div>
                    <div>Использовано: {s.used_text}</div>
                    <div>Лимит: {s.total_text}</div>
                    <div>
                      Осталось:{" "}
                      {s.total_gb > 0
                        ? `${Math.max(0, s.total_gb - Math.floor((s.traffic_up + s.traffic_down) / (1024 * 1024 * 1024) * 100) / 100).toFixed(2)} ГБ`
                        : "∞"}
                    </div>
                    <div>Срок: {s.expiry_time > 0 ? new Date(s.expiry_time).toLocaleDateString("ru-RU") : "без срока"}</div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const s = data.subscriptions.find((x) => x.id === profileSubModalId);
                  if (!s) return;
                  void copySubscription(s.subscription_url);
                }}
              >
                Скопировать ссылку подписки
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {friendRewardId ? (
        <div className="modal-backdrop" onClick={() => setFriendRewardId("")}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Выбор награды</h2>
              <button type="button" className="ghost modal-close" onClick={() => setFriendRewardId("")}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="sub" style={{ marginBottom: "0.5rem" }}>
                Выберите, какую награду применить к вашей подписке.
              </p>
              <div className="row-actions">
                <button type="button" className="primary" disabled={friendRewardBusy} onClick={() => void claimFriendReward("gb")}>
                  Получить ГБ
                </button>
                <button type="button" className="ghost" disabled={friendRewardBusy} onClick={() => void claimFriendReward("days")}>
                  Получить дни
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
