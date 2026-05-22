import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import DropperGame from "../components/DropperGame";
import DropperLobbyHero from "../components/DropperLobbyHero";
import {
  claimMySubReferralReward,
  loadMySubWebAppProfile,
  previewMySubPromoCode,
  sendMySubPaymentProof,
  startDropperSession,
  type MySubProfileDto,
} from "../api";

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
  const [showPickModal, setShowPickModal] = useState(false);
  const [payProduct, setPayProduct] = useState<"subscription" | "topup">("subscription");
  const [payPlanId, setPayPlanId] = useState<number>(1);
  const [payPhoto, setPayPhoto] = useState<File | null>(null);
  const [busyPay, setBusyPay] = useState(false);
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
        setData(profile);
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
    if (data && !data.dropper.enabled && tab === "game") setTab("home");
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

  function switchPayProduct(next: "subscription" | "topup") {
    setPromoApplied(null);
    setPromoFeedback(null);
    setPromoCodeInput("");
    setPayPlanId(1);
    if (next === "topup" && data?.subscriptions.length) {
      setPayTargetId((prev) => (prev <= 0 ? data.subscriptions[0]!.id : prev));
    }
    setPayProduct(next);
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
    if (payProduct === "topup") {
      if (!data.subscriptions.length) {
        setMsg("Докупка ГБ доступна только при привязанной подписке.");
        return;
      }
      if (payTargetId <= 0 || !payTargetSub) {
        setMsg("Выберите подписку, к которой докупаете ГБ.");
        return;
      }
      if (!selectedTopUpPlan) {
        setMsg("Выберите пакет докупки.");
        return;
      }
    } else if (payTargetId > 0 && !payTargetSub) {
      setMsg("Выберите подписку для продления.");
      return;
    }
    const chosenNewName =
      payTargetId === 0 ? (newSubName.trim() || defaultNewSubscriptionName(data.subscriptions)) : "";
    setBusyPay(true);
    setMsg("");
    try {
      const compressed = await compressImage(payPhoto);
      await sendMySubPaymentProof({
        init_data: initData,
        pay_kind: payProduct,
        user_id: payTargetId > 0 ? payTargetId : undefined,
        plan_id: payPlanId,
        photo_base64: compressed.base64,
        photo_mime: compressed.mime,
        photo_name: compressed.name,
        new_subscription_name: payProduct === "subscription" && payTargetId === 0 ? chosenNewName.slice(0, 25) : undefined,
        promo_code: promoApplied?.code,
      });
      setMsg(
        payProduct === "topup"
          ? "Чек получен. Администратор проверит оплату и начислит ГБ. Обычно это занимает немного времени."
          : "Чек получен. Администратор проверит оплату и примет решение. Обычно это занимает немного времени. После подтверждения подписка придет в чат",
      );
      setPayPhoto(null);
      if (payTargetId === 0) setNewSubName("");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("tg_webapp_auth_required")) setErr("Требуется авторизация через тг.");
      else setMsg(m);
    } finally {
      setBusyPay(false);
    }
  }

  async function applyPromoCode() {
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
      else setPromoFeedback({ type: "err", text: "Не удалось применить промокод." });
    }
  }

  const discountedPriceForPlan = (priceRub: number) => {
    if (!promoApplied) return priceRub;
    return Math.max(0, Math.floor(priceRub - (priceRub * promoApplied.discount_percent) / 100));
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
    const url = "https://t.me/hsnvps";
    const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }).Telegram?.WebApp;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
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
    if (data.dropper.tickets <= 0) {
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

  const dropperPlaying = tab === "game" && Boolean(dropperSession);
  const isGameTab = tab === "game" && Boolean(data?.dropper.enabled);

  return (
    <div
      className={`mysub-wrap ${theme === "light" ? "mysub-wrap--light" : ""} ${dropperPlaying ? "mysub-wrap--dropper-play" : ""} ${isGameTab ? "mysub-wrap--game-tab" : ""}`.trim()}
    >
      {!err && !data ? (
        <div className="mysub-loading-screen" aria-live="polite">
          <div className="mysub-loader-ring" />
          <p className="sub">Загрузка...</p>
        </div>
      ) : null}
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
                    <>
                      <p className="mysub-no-sub-text">
                        У вас еще нет подписки! Купите её в разделе «Оплата».
                      </p>
                      <div className="row-actions" style={{ marginTop: "0.65rem" }}>
                        <button type="button" className="primary" onClick={() => setTab("subscription")}>
                          Купить подписку
                        </button>
                      </div>
                    </>
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
                                #{s.id} {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <p className="sub" style={{ marginBottom: "0.4rem" }}>
                        {homeSub ? `Конфиг: #${homeSub.id} ${homeSub.name}` : "Выберите подписку"}
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
                    </>
                  )}
                </div>
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
                            #{s.id} {s.name}
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
                        Средства зачислим в подписку #{payTargetSub?.id} {payTargetSub?.name}
                      </p>
                    )}
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
                            #{s.id} {s.name}
                            {s.allowed ? " · активна" : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="mysub-sub-box mysub-pay-panel">
                  <p className="mysub-pay-lead">
                    {payProduct === "topup"
                      ? data.subscriptions.length === 0
                        ? "Докупка ГБ станет доступна после привязки подписки к этому Telegram."
                        : `Докупка ГБ для подписки #${payTargetSub?.id} ${payTargetSub?.name}. Лимит трафика увеличится после подтверждения оплаты.`
                      : data.subscriptions.length === 0
                        ? "У вас пока нет подписок. Выберите тариф, оплатите и отправьте чек — после проверки администратором появится доступ."
                        : payTargetId === 0
                          ? "Оплата пойдёт на новую подписку — после подтверждения чека вы получите отдельный конфиг."
                          : `Оплата для продления: #${payTargetSub?.id} ${payTargetSub?.name}.`}
                  </p>
                  <div className="mysub-pay-flow">
                    <div className="mysub-pay-step">
                      <span className="mysub-pay-step-badge">1</span>
                      <div className="mysub-pay-step-body">
                        <p className="mysub-pay-step-title">{payProduct === "topup" ? "Пакет ГБ" : "Тариф"}</p>
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
                                    {promoApplied ? (
                                      <>
                                        <s>{p.price_rub} ₽</s> {discountedPriceForPlan(p.price_rub)} ₽
                                      </>
                                    ) : (
                                      `${p.price_rub} ₽`
                                    )}
                                  </span>
                                </button>
                              ))
                            : data.plans.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={payPlanId === p.id}
                                  className={`mysub-plan-card ${payPlanId === p.id ? "is-selected" : ""}`.trim()}
                                  onClick={() => setPayPlanId(p.id)}
                                >
                                  <span className="mysub-plan-card-title">{p.title.trim() || `Тариф ${p.id}`}</span>
                                  <span className="mysub-plan-card-meta">{formatMySubPlanMeta(p)}</span>
                                  <span className="mysub-plan-card-price">
                                    {promoApplied ? (
                                      <>
                                        <s>{p.price_rub} ₽</s> {discountedPriceForPlan(p.price_rub)} ₽
                                      </>
                                    ) : (
                                      `${p.price_rub} ₽`
                                    )}
                                  </span>
                                </button>
                              ))}
                        </div>
                      </div>
                    </div>
                    <div className="mysub-pay-step">
                      <span className="mysub-pay-step-badge">2</span>
                      <div className="mysub-pay-step-body">
                        <p className="mysub-pay-step-title">Оплата</p>
                        <p className="sub">
                          {payProduct === "topup" ? (
                            <>
                              В комментарии к переводу укажите <b>номер пакета докупки</b>: <b>{payPlanId}</b> (обычно{" "}
                              <code>1</code>, <code>2</code> или <code>3</code>).
                            </>
                          ) : (
                            <>
                              В комментарии к переводу укажите номер тарифа: <b>{payPlanId}</b>.
                            </>
                          )}
                        </p>
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
                          ) : promoFeedback ? (
                            <p className="mysub-promo-feedback err">{promoFeedback.text}</p>
                          ) : null}
                        </div>
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
            ) : tab === "game" && data.dropper.enabled ? (
              <div className={`mysub-dropper-page ${dropperSession ? "mysub-dropper-page--playing" : ""}`.trim()}>
                <section className="mysub-section mysub-dropper-section">
                  {!dropperSession ? (
                    <h1 className="mysub-dropper-hero-title" aria-label="Дроппер">
                      Дроппер
                    </h1>
                  ) : null}
                  {!dropperSession ? (
                    <p className="mysub-dropper-tickets">
                      Билетов: <b>{data.dropper.tickets}</b>
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
                              #{s.id} {s.name}
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
                <div className="mysub-sub-box">
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
                            setProfileSubModalId(s.id);
                          }}
                        >
                          #{s.id} {s.name}
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
                <div className="row-actions" style={{ marginTop: "0.75rem" }}>
                  <button type="button" className="ghost" onClick={openSupportProfile}>
                    Поддержка
                  </button>
                </div>
              </section>
            )}

            {msg && !dropperPlaying ? <div className="flash ok">{msg}</div> : null}
            {!dropperPlaying ? (
            <div
              className={`mysub-bottom-actions ${data.dropper.enabled ? "mysub-bottom-actions--5" : ""}`.trim()}
            >
              {(
                [
                  ["home", "Главная"],
                  ["subscription", "Оплата"],
                  ...(data.dropper.enabled ? ([["game", "Игра"]] as Array<[Tab, string]>) : []),
                  ["friends", "Друзья"],
                  ["profile", "Профиль"],
                ] as Array<[Tab, string]>
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`mysub-nav-btn ${tab === t ? "active" : ""} ${
                    t === "game" && data.dropper.tickets > 0 ? "mysub-nav-btn--game" : ""
                  } ${t === "game" && data.dropper.tickets <= 0 ? "mysub-nav-btn--game-muted" : ""}`.trim()}
                  onClick={() => setTab(t)}
                >
                  <NavIcon tab={t} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
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
              <div className="mysub-stat-list">
                {data.subscriptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={pickedSubId === s.id ? "primary" : "ghost"}
                    onClick={() => setPickedSubId(s.id)}
                  >
                    #{s.id} {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="ghost" onClick={() => setShowPickModal(false)}>
                Отмена
              </button>
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
                    <div><b>#{s.id} {s.name}</b></div>
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
