import { useEffect, useRef, useState, type SVGProps } from "react";
import {
  markMySubDailyGiftSeen,
  toggleMySubDailyGiftReminder,
  type MySubDailyGiftDto,
} from "../../api";
import { formatMySubError } from "../formatMySubError";
import Card from "./Card";
import PrimaryButton from "./PrimaryButton";
import SecondaryButton from "./SecondaryButton";
import type { MySubWebAppController } from "../types";
import {
  claimDailyGiftWithAnimation,
  prefetchDailyGiftBanner,
} from "../dailyGiftPrefetch";
import DailyGiftUnboxAnimation from "./DailyGiftUnboxAnimation";

type Props = {
  ctrl: MySubWebAppController;
  gift: MySubDailyGiftDto;
  subscriptionName?: string;
  multiSub?: boolean;
};

function parseApiError(raw: unknown): { code: string; dailyGift?: MySubDailyGiftDto } {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("{")) return { code: text };
  try {
    const parsed = JSON.parse(text) as { error?: string; daily_gift?: MySubDailyGiftDto };
    return { code: String(parsed.error ?? ""), dailyGift: parsed.daily_gift };
  } catch {
    return { code: text };
  }
}

function isPromoCodeValue(value: string): boolean {
  return /^[A-Z0-9_-]{3,40}$/i.test(value.trim());
}

function IconCopy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden {...p}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PromoCodeLine({
  code,
  copied,
  onCopy,
}: {
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mn-daily-gift__promo-code">
      <strong className="mn-daily-gift__promo-code-text">{code}</strong>
      <button
        type="button"
        className={`mn-daily-gift__promo-copy${copied ? " mn-daily-gift__promo-copy--done" : ""}`}
        onClick={onCopy}
        aria-label={copied ? "Скопировано" : "Скопировать промокод"}
        title={copied ? "Скопировано" : "Скопировать"}
      >
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}

function giftValueLabel(type: string, value: string): string {
  if (type === "gb") return `+${value} ГБ`;
  if (type === "days") {
    const n = Number(value);
    const word = n === 1 ? "день" : n >= 2 && n <= 4 ? "дня" : "дней";
    return `+${value} ${word}`;
  }
  if (type === "discount") return `Скидка ${value}%`;
  return value;
}

function giftDisplayTitle(type: string, value: string, adminTitle?: string, creditMode?: string | null): string {
  if (creditMode === "piggy" && type === "gb") return `+${value} ГБ в копилку игры`;
  if (type === "gb") return `+${value} ГБ трафика`;
  if (type === "days") {
    const n = Number(value);
    const word = n === 1 ? "день" : n >= 2 && n <= 4 ? "дня" : "дней";
    return `+${value} ${word} подписки`;
  }
  if (type === "discount") return `Скидка ${value}%`;
  if (type === "promo") return adminTitle?.trim() || "Промокод на покупку тарифа";
  return adminTitle?.trim() || giftValueLabel(type, value);
}

function giftDisplayDescription(type: string, custom?: string, creditMode?: string | null): string {
  if (creditMode === "piggy" && type === "gb") {
    return "У вас безлимитный тариф — ГБ отправлены в копилку в игре «Рулетка»";
  }
  const byType: Record<string, string> = {
    gb: "Дополнительный трафик уже начислен",
    days: "Подарок уже начислен на ваш аккаунт",
    promo: "Скопируйте промокод и используйте при оплате",
    discount: "Скидка доступна при следующей оплате",
  };
  return byType[type] ?? custom?.trim() ?? "";
}

function giftIcon(type: string, creditMode?: string | null): string {
  if (creditMode === "piggy" && type === "gb") return "🪙";
  if (type === "gb") return "📶";
  if (type === "days") return "📅";
  if (type === "promo") return "🏷️";
  if (type === "discount") return "💸";
  return "🎁";
}

function PrizeIcon({ type, compact, creditMode }: { type: string; compact?: boolean; creditMode?: string | null }) {
  const icon = giftIcon(type, creditMode);
  const cls = compact
    ? "mn-daily-gift__prize-icon mn-daily-gift__prize-icon--compact"
    : "mn-daily-gift__prize-icon";
  if (type === "days") {
    return (
      <div className={`${cls} mn-daily-gift__prize-icon--days`} aria-hidden>
        <span className="mn-daily-gift__prize-icon-main">{icon}</span>
      </div>
    );
  }
  return (
    <div className={cls} aria-hidden>
      {icon}
    </div>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function DailyGiftResetCountdown({ nextResetAt }: { nextResetAt: string | null }) {
  const [countdown, setCountdown] = useState("00:00:00");

  useEffect(() => {
    if (!nextResetAt) return;
    const target = Date.parse(nextResetAt);
    const tick = () => setCountdown(formatCountdown(target - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [nextResetAt]);

  if (!nextResetAt) return null;

  return (
    <div className="mn-daily-gift__reset">
      <span className="mn-daily-gift__reset-label">Новый подарок через</span>
      <span className="mn-daily-gift__reset-timer" aria-live="polite">
        {countdown}
      </span>
    </div>
  );
}

export default function DailyGiftBlock({ ctrl, gift, subscriptionName, multiSub }: Props) {
  const { initData, homeSub, refreshProfile, setMsg, setTab } = ctrl;
  const [phase, setPhase] = useState<"closed" | "opening" | "open">(
    gift.opened && !gift.can_open ? "open" : gift.opened ? "open" : "closed",
  );
  const [busy, setBusy] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localClaim, setLocalClaim] = useState<{
    subId: number;
    gift: NonNullable<MySubDailyGiftDto["opened_gift"]>;
  } | null>(null);
  const seenRef = useRef(false);
  const activeSubIdRef = useRef(homeSub?.id);

  const unlimitedTraffic = Boolean(
    homeSub && (homeSub.total_gb <= 0 || homeSub.stats.unlimited_traffic),
  );

  function effectiveCreditMode(
    openedGift: NonNullable<MySubDailyGiftDto["opened_gift"]>,
  ): "direct" | "piggy" {
    if (openedGift.credit_mode === "piggy") return "piggy";
    if (openedGift.type === "gb" && unlimitedTraffic && openedGift.status === "applied") return "piggy";
    return openedGift.credit_mode ?? "direct";
  }

  const localGiftForSub =
    localClaim && homeSub?.id === localClaim.subId ? localClaim.gift : null;
  const opened = localGiftForSub ?? gift.opened_gift;
  const openedCreditMode = opened ? effectiveCreditMode(opened) : "direct";
  const isGolden = gift.golden || opened?.golden === true || gift.prize_preview?.golden === true;
  const alreadyClaimedToday = opened?.status === "applied" && !gift.can_open;
  const instantReveal = alreadyClaimedToday && phase !== "opening";
  const showBanner = phase === "closed" || phase === "opening";
  const showReveal =
    phase === "opening" ||
    phase === "open" ||
    alreadyClaimedToday ||
    Boolean(localGiftForSub);
  const showRevealContent = Boolean(opened) && (phase === "open" || alreadyClaimedToday);
  useEffect(() => {
    activeSubIdRef.current = homeSub?.id;
  }, [homeSub?.id]);

  useEffect(() => {
    if (!gift.visible || seenRef.current) return;
    seenRef.current = true;
    void markMySubDailyGiftSeen(initData).catch(() => {});
  }, [gift.visible, initData]);

  useEffect(() => {
    setCopied(false);
    setBusy(false);
    setLocalClaim((prev) => (prev && prev.subId === homeSub?.id ? prev : null));
    const claimedToday = !gift.can_open && gift.opened_gift?.status === "applied";
    setPhase(claimedToday ? "open" : "closed");
  }, [homeSub?.id, gift.day_key, gift.can_open, gift.opened_gift?.status]);

  useEffect(() => {
    prefetchDailyGiftBanner(gift);
  }, [gift.banner_image_url]);

  if (!gift.enabled || !gift.visible) {
    if (gift.enabled && gift.empty_message) {
      return (
        <Card className="mn-daily-gift mn-daily-gift--empty">
          <p className="mn-muted mn-daily-gift__empty">{gift.empty_message}</p>
        </Card>
      );
    }
    return null;
  }

  const failed = opened?.status === "failed";
  const failMessage = opened?.error_message ? formatMySubError(opened.error_message) : null;
  const promoCode =
    opened?.type === "promo" && opened.status === "applied" && isPromoCodeValue(opened.value)
      ? opened.value.trim().toUpperCase()
      : null;

  function handleCopyPromo() {
    if (!promoCode) return;
    void copyPromo(promoCode);
  }

  function handleAlreadyClaimed() {
    setPhase("open");
    void refreshProfile();
  }

  async function openGift() {
    if (!gift.can_open || busy) return;
    if (!homeSub?.id) {
      setMsg(formatMySubError("subscription_required"));
      return;
    }
    setBusy(true);
    setPhase("opening");
    const claimSubId = homeSub.id;
    try {
      const res = await claimDailyGiftWithAnimation(initData, claimSubId, { golden: isGolden });
      if (activeSubIdRef.current !== claimSubId) return;
      if (res.gift) {
        setLocalClaim({ subId: claimSubId, gift: res.gift });
      }
      setPhase("open");
      void refreshProfile();
      if (!res.ok && res.gift?.status === "failed") {
        setMsg(formatMySubError(res.gift.error_message ?? "apply_failed"));
      }
    } catch (e) {
      if (activeSubIdRef.current !== claimSubId) return;
      const { code } = parseApiError(e instanceof Error ? e.message : String(e));
      setPhase(gift.opened ? "open" : "closed");
      if (code === "already_claimed") {
        handleAlreadyClaimed();
      } else if (code === "prize_limit_reached") {
        setMsg(formatMySubError(code));
        handleAlreadyClaimed();
      } else {
        setMsg(formatMySubError(code || e));
      }
    } finally {
      if (activeSubIdRef.current === claimSubId) setBusy(false);
    }
  }

  async function toggleReminder() {
    setReminderBusy(true);
    try {
      await toggleMySubDailyGiftReminder({ init_data: initData, enabled: !gift.reminder_enabled });
      await refreshProfile();
    } catch (e) {
      setMsg(formatMySubError(e instanceof Error ? e.message : String(e)));
    } finally {
      setReminderBusy(false);
    }
  }

  async function copyPromo(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("Не удалось скопировать промокод");
    }
  }

  return (
    <Card
      className={`mn-daily-gift${isGolden ? " mn-daily-gift--golden" : ""}${showReveal ? " mn-daily-gift--revealed" : ""}${alreadyClaimedToday ? " mn-daily-gift--claimed" : ""}${phase === "opening" ? " mn-daily-gift--opening" : ""}${instantReveal ? " mn-daily-gift--instant" : ""}`}
    >
      {multiSub && subscriptionName ? (
        <p className="mn-daily-gift__sub-label">Подарок для подписки: {subscriptionName}</p>
      ) : null}
      <div className="mn-daily-gift__wrap">
        {showBanner ? (
            <button
              type="button"
              className="mn-daily-gift__banner"
              onClick={() => void openGift()}
              disabled={!gift.can_open || busy}
              aria-label="Открыть ежедневный подарок"
            >
              <div className="mn-daily-gift__banner-inner">
                <div className="mn-daily-gift__banner-bg" aria-hidden />
                <div className="mn-daily-gift__banner-shine" aria-hidden />
                {isGolden ? <div className="mn-daily-gift__banner-sparkles" aria-hidden /> : null}
                {gift.banner_image_url ? (
                  <img src={gift.banner_image_url} alt="" className="mn-daily-gift__banner-img" />
                ) : (
                  <div className="mn-daily-gift__banner-art" aria-hidden>
                    {isGolden ? "✨" : "🎁"}
                  </div>
                )}
                <div className="mn-daily-gift__banner-text">
                  <span className="mn-daily-gift__banner-title">
                    {isGolden ? "Золотой подарок" : "Ежедневный подарок"}
                  </span>
                  <span className="mn-daily-gift__banner-hint">
                    {isGolden ? "Редкая награда — нажми, чтобы открыть" : "Нажми, чтобы открыть"}
                  </span>
                </div>
                <span className="mn-daily-gift__banner-cta">{isGolden ? "Открыть ✦" : "Открыть"}</span>
              </div>
            </button>
          ) : null}

          <div className="mn-daily-gift__reveal" aria-hidden={!showReveal}>
            {showRevealContent && opened ? (
              alreadyClaimedToday || localGiftForSub?.status === "applied" ? (
                <div className={`mn-daily-gift__claimed${isGolden ? " mn-daily-gift__claimed--golden" : ""}`}>
                  <PrizeIcon type={opened.type} compact creditMode={openedCreditMode} />
                  <div className="mn-daily-gift__claimed-body">
                    <span className={`mn-daily-gift__badge${isGolden ? " mn-daily-gift__badge--golden" : ""}`}>
                      {isGolden ? "✦ Золотой подарок" : "Получено сегодня"}
                    </span>
                    <h3 className="mn-daily-gift__prize-title">
                      {giftDisplayTitle(opened.type, opened.value, opened.title, openedCreditMode)}
                    </h3>
                    <p className="mn-daily-gift__prize-desc">
                      {giftDisplayDescription(opened.type, opened.description, openedCreditMode)}
                    </p>
                    {promoCode ? (
                      <PromoCodeLine code={promoCode} copied={copied} onCopy={handleCopyPromo} />
                    ) : null}
                    <DailyGiftResetCountdown nextResetAt={gift.next_reset_at} />
                  </div>
                </div>
              ) : (
                <>
                  {opened.status !== "failed" ? (
                    <span className={`mn-daily-gift__badge${isGolden ? " mn-daily-gift__badge--golden" : ""}`}>
                      {isGolden ? "✦ Золотой подарок" : "Получено сегодня"}
                    </span>
                  ) : null}
                  <PrizeIcon type={opened.type} creditMode={openedCreditMode} />
                  <h3 className="mn-daily-gift__prize-title">
                    {opened.status === "failed"
                      ? "Не удалось получить подарок"
                      : giftDisplayTitle(opened.type, opened.value, opened.title, openedCreditMode)}
                  </h3>
                  <p className="mn-daily-gift__prize-desc">
                    {opened.status === "failed"
                      ? failMessage ?? "Попробуйте позже или обратитесь в поддержку."
                      : giftDisplayDescription(opened.type, opened.description, openedCreditMode)}
                  </p>
                  {promoCode ? (
                    <PromoCodeLine code={promoCode} copied={copied} onCopy={handleCopyPromo} />
                  ) : null}
                  {failed && gift.can_open ? (
                    <PrimaryButton fullWidth disabled={busy} onClick={() => void openGift()}>
                      Попробовать снова
                    </PrimaryButton>
                  ) : null}
                  {opened.type === "discount" && opened.status === "applied" ? (
                    <PrimaryButton fullWidth onClick={() => setTab("subscription")}>
                      Перейти к оплате
                    </PrimaryButton>
                  ) : null}
                </>
              )
            ) : phase === "opening" ? (
              <DailyGiftUnboxAnimation golden={isGolden} />
            ) : null}
          </div>
        </div>

        <SecondaryButton
          fullWidth
          disabled={reminderBusy}
          onClick={() => void toggleReminder()}
          className="mn-daily-gift__reminder"
        >
          {gift.reminder_enabled ? "Напоминания включены" : "Напоминать о подарке"}
      </SecondaryButton>
    </Card>
  );
}
