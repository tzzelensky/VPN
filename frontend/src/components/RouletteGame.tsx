import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spinner from "./Spinner";
import { subscriptionLabel } from "../subscriptionLabel";
import {
  buyMySubRouletteTickets,
  exchangeMySubRoulettePiggy,
  notifyMySubRouletteSpin,
  spinMySubRoulette,
  type MySubRoulettePrizeDto,
  type RouletteGbPiggyDto,
  type RouletteTicketShopPublicDto,
} from "../api";
import { formatClientError } from "../lib/clientError";
import { playRouletteSpinSound, playRouletteWinChime } from "../lib/rouletteSpinSound";
import {
  canAffordRouletteDaysPurchase,
  maxRouletteTicketsWithDays,
} from "../lib/rouletteTicketPurchase";
import { useHoldRepeatHandlers } from "../lib/useHoldRepeat";
import {
  labelTransformCss,
  rotationForPrizeIndex,
  segmentAngle as wheelSegmentAngle,
  wheelGradientCss,
} from "../lib/rouletteWheel";
import {
  getPrizeColor,
  getPrizeFullTitle,
  getPrizeIcon,
  getPrizeLabelTextClass,
  getPrizeShortTitle,
  getRouletteLoseMessage,
  historyStatusLabel,
  isRouletteLosePrize,
  resolveHistoryPrize,
  type PrizeDisplayInput,
} from "../roulettePrizeDisplay";

const SPIN_MS = 4200;
const SPIN_API_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

type TicketPurchaseHistoryItem = {
  kind: "ticket_purchase";
  id: string;
  date: string;
  tickets: number;
  payment_type: "subscription_days" | "traffic_gb";
  cost: number;
};

type RouletteSubscriptionDto = {
  id: number;
  name: string;
  tickets: number;
  total_gb: number;
  expiry_time: number;
  gb_piggy?: RouletteGbPiggyDto | null;
  stats?: {
    remaining_days: number | null;
    remaining_gb?: number | null;
    unlimited_traffic: boolean;
    unlimited_time: boolean;
  };
};

type Props = {
  initData: string;
  subscriptions: RouletteSubscriptionDto[];
  ticketsPerPurchase: number;
  prizes: MySubRoulettePrizeDto[];
  ticketShop?: RouletteTicketShopPublicDto;
  history: Array<{ id: number; date: string; prize: string; status: string }>;
  ticketPurchaseHistory?: TicketPurchaseHistoryItem[];
  onSubscriptionUpdate?: (
    subId: number,
    patch: { tickets?: number; gb_piggy?: RouletteGbPiggyDto | null },
  ) => void;
  onBuyClick: () => void;
  onRefreshProfile: () => void;
};

type BuyPaymentType = "subscription_days" | "traffic_gb";

type BuyModalStep = "quantity" | "confirm" | null;

type BuySuccessState = {
  tickets: number;
  cost: number;
  paymentType: BuyPaymentType;
};

type WinModalState = {
  prize: PrizeDisplayInput;
  lose: boolean;
  winText?: string;
  winSub?: string;
};

type RouletteGameTab = "wheel" | "buy";

function toDisplayPrize(p: MySubRoulettePrizeDto): PrizeDisplayInput {
  return {
    type: p.type,
    value: p.value,
    title: p.title,
    icon: p.icon,
    color: p.color,
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function ticketsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "билет";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "билета";
  return "билетов";
}

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день подписки";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня подписки";
  return "дней подписки";
}

function ModalCloseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="ghost modal-close" onClick={onClick} disabled={disabled} aria-label="Закрыть">
      ×
    </button>
  );
}

export default function RouletteGame({
  initData,
  subscriptions,
  ticketsPerPurchase,
  prizes,
  ticketShop,
  history,
  ticketPurchaseHistory = [],
  onSubscriptionUpdate,
  onBuyClick,
  onRefreshProfile,
}: Props) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const stopSoundRef = useRef<(() => void) | null>(null);
  const rotationRef = useRef(0);
  const spinInFlightRef = useRef(false);
  const pendingSpinRef = useRef(false);
  const autoSpinRef = useRef(false);
  const pendingSpinRafRef = useRef(0);
  const spinFinishTimerRef = useRef(0);
  const [wheelPx, setWheelPx] = useState(260);
  const [spinning, setSpinning] = useState(false);
  const [spinRequesting, setSpinRequesting] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winModal, setWinModal] = useState<WinModalState | null>(null);
  const [ticketsHelpOpen, setTicketsHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState(() => subscriptions[0]?.id ?? 0);
  const [localTickets, setLocalTickets] = useState(() => subscriptions[0]?.tickets ?? 0);
  const [buyPaymentType, setBuyPaymentType] = useState<BuyPaymentType | null>(null);
  const [buyModalStep, setBuyModalStep] = useState<BuyModalStep>(null);
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [buySubmitting, setBuySubmitting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buySuccess, setBuySuccess] = useState<BuySuccessState | null>(null);
  const [gameTab, setGameTab] = useState<RouletteGameTab>("wheel");
  const [autoSpin, setAutoSpin] = useState(false);
  const [localPiggy, setLocalPiggy] = useState<RouletteGbPiggyDto | null>(
    () => subscriptions[0]?.gb_piggy ?? null,
  );
  const [piggyExchanging, setPiggyExchanging] = useState(false);
  const [autoSpinToast, setAutoSpinToast] = useState<string | null>(null);

  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  useEffect(() => {
    autoSpinRef.current = autoSpin;
  }, [autoSpin]);

  const selectedSub = useMemo(
    () => subscriptions.find((s) => s.id === selectedSubId) ?? subscriptions[0],
    [subscriptions, selectedSubId],
  );

  useEffect(() => {
    if (!subscriptions.length) return;
    const sub = subscriptions.find((s) => s.id === selectedSubId) ?? subscriptions[0];
    if (!sub) return;
    if (sub.id !== selectedSubId) setSelectedSubId(sub.id);
    setLocalTickets(sub.tickets);
    setLocalPiggy(sub.gb_piggy ?? null);
  }, [subscriptions, selectedSubId]);

  const patchSelectedSub = useCallback(
    (patch: { tickets?: number; gb_piggy?: RouletteGbPiggyDto | null }) => {
      if (!selectedSub) return;
      if (patch.tickets != null) setLocalTickets(patch.tickets);
      if (patch.gb_piggy !== undefined) setLocalPiggy(patch.gb_piggy);
      onSubscriptionUpdate?.(selectedSub.id, patch);
    },
    [onSubscriptionUpdate, selectedSub],
  );

  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const measure = () => setWheelPx(el.getBoundingClientRect().width || 260);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stopSpinSound = useCallback(() => {
    const stop = stopSoundRef.current;
    stopSoundRef.current = null;
    stop?.();
  }, []);

  useEffect(() => {
    return () => {
      stopSpinSound();
      if (pendingSpinRafRef.current) {
        window.cancelAnimationFrame(pendingSpinRafRef.current);
        pendingSpinRafRef.current = 0;
      }
      if (spinFinishTimerRef.current) {
        window.clearTimeout(spinFinishTimerRef.current);
        spinFinishTimerRef.current = 0;
      }
      spinInFlightRef.current = false;
    };
  }, [stopSpinSound]);

  const stopPendingWheelSpin = useCallback(() => {
    if (pendingSpinRafRef.current) {
      window.cancelAnimationFrame(pendingSpinRafRef.current);
      pendingSpinRafRef.current = 0;
    }
  }, []);

  const startPendingWheelSpin = useCallback(() => {
    stopPendingWheelSpin();
    let lastTs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - lastTs);
      lastTs = now;
      const next = rotationRef.current + dt * 0.14;
      rotationRef.current = next;
      setRotation(next);
      pendingSpinRafRef.current = window.requestAnimationFrame(tick);
    };
    pendingSpinRafRef.current = window.requestAnimationFrame(tick);
  }, [stopPendingWheelSpin]);

  const animateWheelToFinal = useCallback((finalRotation: number, onSpinVisualStart?: () => void) => {
    return new Promise<void>((resolve) => {
      let settled = false;
      let visualStarted = false;
      const startVisual = () => {
        if (visualStarted) return;
        visualStarted = true;
        onSpinVisualStart?.();
      };
      const done = () => {
        if (settled) return;
        settled = true;
        if (spinFinishTimerRef.current) {
          window.clearTimeout(spinFinishTimerRef.current);
          spinFinishTimerRef.current = 0;
        }
        resolve();
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = wheelRef.current;
          const startRot = rotationRef.current;
          let visualStartTimer = 0;
          if (el) {
            const onStart = (e: TransitionEvent) => {
              if (e.propertyName !== "transform") return;
              el.removeEventListener("transitionstart", onStart);
              if (visualStartTimer) window.clearTimeout(visualStartTimer);
              startVisual();
            };
            el.addEventListener("transitionstart", onStart);
            const onEnd = (e: TransitionEvent) => {
              if (e.propertyName !== "transform") return;
              el.removeEventListener("transitionend", onEnd);
              done();
            };
            el.addEventListener("transitionend", onEnd);
            el.style.transition = "none";
            el.style.transform = `rotate(${startRot}deg)`;
            void el.offsetHeight;
            el.style.removeProperty("transition");
            el.style.removeProperty("transform");
            visualStartTimer = window.setTimeout(startVisual, 120);
          } else {
            visualStartTimer = window.setTimeout(startVisual, 0);
          }
          setRotation(finalRotation);
          spinFinishTimerRef.current = window.setTimeout(done, SPIN_MS + 160);
        });
      });
    });
  }, []);

  const ticketCount = Math.max(0, localTickets);
  const spinBusy = spinning || spinRequesting;
  const labelRadiusPx = Math.round(wheelPx * 0.36);
  const shop = ticketShop;
  const shopVisible = !!shop?.visible;
  const minTickets = shop?.min_tickets ?? 1;
  const maxTickets = shop?.max_tickets ?? 10;

  const buyCost = useMemo(() => {
    if (!shop || !buyPaymentType) return 0;
    const price =
      buyPaymentType === "subscription_days" ? shop.price_days_per_ticket : shop.price_gb_per_ticket;
    return buyQuantity * price;
  }, [shop, buyPaymentType, buyQuantity]);

  const maxBuyTicketsDays = useMemo(() => {
    if (!shop?.allow_days || !selectedSub) return 0;
    return maxRouletteTicketsWithDays(
      selectedSub.expiry_time,
      shop.price_days_per_ticket,
      maxTickets,
    );
  }, [shop, selectedSub, maxTickets]);

  const maxBuyTicketsGb = useMemo(() => {
    if (!shop?.allow_gb || !selectedSub?.stats || selectedSub.stats.unlimited_traffic) return 0;
    if (selectedSub.stats.remaining_gb == null || shop.price_gb_per_ticket <= 0) return 0;
    return Math.min(maxTickets, Math.floor(selectedSub.stats.remaining_gb / shop.price_gb_per_ticket));
  }, [shop, selectedSub, maxTickets]);

  const buyTicketCap = useMemo(() => {
    if (buyPaymentType === "subscription_days") return maxBuyTicketsDays;
    if (buyPaymentType === "traffic_gb") return maxBuyTicketsGb;
    return maxTickets;
  }, [buyPaymentType, maxBuyTicketsDays, maxBuyTicketsGb, maxTickets]);

  const decBuyQty = useCallback(() => {
    setBuyQuantity((q) => Math.max(minTickets, q - 1));
  }, [minTickets]);

  const incBuyQty = useCallback(() => {
    setBuyQuantity((q) => Math.min(buyTicketCap, q + 1));
  }, [buyTicketCap]);

  const holdDecBuyQty = useHoldRepeatHandlers({
    onTick: decBuyQty,
    disabled: buyQuantity <= minTickets,
  });

  const holdIncBuyQty = useHoldRepeatHandlers({
    onTick: incBuyQty,
    disabled: buyQuantity >= buyTicketCap,
  });

  const canPayWithDays = useMemo(() => {
    if (!shop?.allow_days || !selectedSub?.stats || selectedSub.stats.unlimited_time) return false;
    const cost = buyQuantity * shop.price_days_per_ticket;
    return canAffordRouletteDaysPurchase(selectedSub.expiry_time, cost);
  }, [shop, selectedSub, buyQuantity]);

  const canPayWithGb = useMemo(() => {
    if (!shop?.allow_gb || !selectedSub?.stats || selectedSub.stats.unlimited_traffic) return false;
    if (selectedSub.stats.remaining_gb == null) return false;
    const cost = buyQuantity * shop.price_gb_per_ticket;
    return selectedSub.stats.remaining_gb >= cost;
  }, [shop, selectedSub, buyQuantity]);

  const mergedHistory = useMemo(() => {
    const spins = history.map((h) => ({
      key: `spin-${h.id}`,
      kind: "spin" as const,
      date: h.date,
      spin: h,
    }));
    const purchases = ticketPurchaseHistory.map((p) => ({
      key: `buy-${p.id}`,
      kind: "ticket_purchase" as const,
      date: p.date,
      purchase: p,
    }));
    return [...spins, ...purchases].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [history, ticketPurchaseHistory]);

  const openBuyModal = useCallback(
    (paymentType: BuyPaymentType) => {
      setBuyPaymentType(paymentType);
      setBuyQuantity(minTickets);
      setBuyModalStep("quantity");
      setBuyError(null);
    },
    [minTickets],
  );

  useEffect(() => {
    if (!buyModalStep || !buyPaymentType) return;
    setBuyQuantity((q) => {
      if (buyTicketCap < minTickets) return Math.max(0, buyTicketCap);
      return Math.min(Math.max(q, minTickets), buyTicketCap);
    });
  }, [buyModalStep, buyPaymentType, buyTicketCap, minTickets]);

  const closeBuyModal = useCallback(() => {
    if (buySubmitting) return;
    setBuyModalStep(null);
    setBuyPaymentType(null);
    setBuyError(null);
  }, [buySubmitting]);

  const confirmBuy = useCallback(async () => {
    if (!buyPaymentType || buySubmitting || !selectedSub) return;
    setBuySubmitting(true);
    setBuyError(null);
    try {
      const result = await buyMySubRouletteTickets(initData, buyPaymentType, buyQuantity, selectedSub.id);
      if (!result.ok) {
        setBuyError(result.error?.trim() || "Не удалось купить билеты.");
        return;
      }
      patchSelectedSub({ tickets: result.tickets_count });
      setBuyModalStep(null);
      setBuyPaymentType(null);
      setBuySuccess({
        tickets: result.tickets_added,
        cost: result.cost,
        paymentType: result.payment_type,
      });
      onRefreshProfile();
    } catch (e) {
      setBuyError(formatClientError(e));
    } finally {
      setBuySubmitting(false);
    }
  }, [buyPaymentType, buySubmitting, buyQuantity, initData, onRefreshProfile, patchSelectedSub, selectedSub]);

  const activePrizes = useMemo(() => [...prizes], [prizes]);
  const catalog = useMemo(() => activePrizes.map(toDisplayPrize), [activePrizes]);
  const segAngle = wheelSegmentAngle(activePrizes.length);
  const compactLabel = segAngle < 32;

  const wheelGradient = useMemo(() => {
    const colors = activePrizes.map((p, i) => getPrizeColor(toDisplayPrize(p), i));
    return wheelGradientCss(colors);
  }, [activePrizes]);

  const applyPiggyFromResult = useCallback(
    (piggy?: RouletteGbPiggyDto) => {
      if (!piggy) return;
      patchSelectedSub({ gb_piggy: piggy });
    },
    [patchSelectedSub],
  );

  const exchangePiggy = useCallback(async () => {
    if (!selectedSub || !localPiggy?.can_exchange || piggyExchanging) return;
    setPiggyExchanging(true);
    setError(null);
    try {
      const result = await exchangeMySubRoulettePiggy(initData, selectedSub.id);
      patchSelectedSub({ tickets: result.tickets_remaining, gb_piggy: result.gb_piggy });
      onRefreshProfile();
    } catch (e) {
      setError(formatClientError(e));
    } finally {
      setPiggyExchanging(false);
    }
  }, [initData, localPiggy, onRefreshProfile, patchSelectedSub, piggyExchanging, selectedSub]);

  const resetSpinState = useCallback(
    (opts?: { stopAuto?: boolean }) => {
      stopPendingWheelSpin();
      if (spinFinishTimerRef.current) {
        window.clearTimeout(spinFinishTimerRef.current);
        spinFinishTimerRef.current = 0;
      }
      stopSpinSound();
      spinInFlightRef.current = false;
      setSpinRequesting(false);
      setSpinning(false);
      if (opts?.stopAuto) {
        setAutoSpin(false);
        autoSpinRef.current = false;
        setAutoSpinToast(null);
      }
    },
    [stopPendingWheelSpin, stopSpinSound],
  );

  const spin = useCallback(async (opts?: { fromAuto?: boolean }) => {
    const fromAuto = opts?.fromAuto === true;
    if (!selectedSub) {
      setError("Нет подписки для игры.");
      return;
    }
    if (spinInFlightRef.current) {
      if (fromAuto) {
        window.setTimeout(() => void spin({ fromAuto: true }), 320);
      }
      return;
    }
    if (ticketCount <= 0 || activePrizes.length === 0) {
      if (fromAuto) resetSpinState({ stopAuto: true });
      return;
    }

    spinInFlightRef.current = true;
    setSpinRequesting(true);
    setError(null);
    if (fromAuto) {
      setAutoSpinToast(`Автопрокрутка… билетов: ${ticketCount}`);
    }
    startPendingWheelSpin();

    try {
      const result = await withTimeout(
        spinMySubRoulette(initData, selectedSub.id),
        SPIN_API_TIMEOUT_MS,
        "Сервер не ответил вовремя. Попробуйте ещё раз.",
      );
      stopPendingWheelSpin();

      let idx = Math.max(0, Math.min(activePrizes.length - 1, result.prize_index ?? 0));
      if (result.prize?.id) {
        const found = activePrizes.findIndex((p) => p.id === result.prize!.id);
        if (found >= 0) idx = found;
      }
      const prizeDto = result.prize ?? activePrizes[idx];
      const prize = prizeDto ? toDisplayPrize(prizeDto) : catalog[idx]!;
      const lose = isRouletteLosePrize(prize);
      const extraTurns = 5 + Math.floor(Math.random() * 3);
      const finalRotation = rotationForPrizeIndex(rotationRef.current, idx, activePrizes.length, extraTurns);

      setSpinRequesting(false);
      setSpinning(true);
      stopSpinSound();
      await animateWheelToFinal(finalRotation, () => {
        stopSoundRef.current = playRouletteSpinSound(SPIN_MS);
      });

      const appliedTitle = result.spin?.prize_title?.trim();
      const appliedMessage = result.spin?.prize_display_message?.trim();
      const remaining = result.tickets_remaining ?? Math.max(0, ticketCount - 1);
      const spinId = result.spin?.id;

      stopSpinSound();
      spinInFlightRef.current = false;
      setSpinning(false);
      setLocalTickets(remaining);
      patchSelectedSub({ tickets: remaining });
      if (result.gb_piggy) applyPiggyFromResult(result.gb_piggy);
      if (spinId) {
        void notifyMySubRouletteSpin(initData, spinId).catch(() => undefined);
      }
      const keepAuto = autoSpinRef.current;
      if (!lose) playRouletteWinChime();
      if (!keepAuto) {
        setWinModal({
          prize,
          lose,
          winText: lose
            ? getRouletteLoseMessage()
            : appliedMessage
              ? appliedTitle || "+7 дней в подарок"
              : prizeDto?.win_text ?? getPrizeFullTitle(prize),
          winSub: lose
            ? "Билет списан. Попробуйте ещё раз!"
            : appliedMessage ?? "Приз уже начислен в вашу подписку",
        });
      } else if (appliedMessage && prize.type === "traffic_gb") {
        setAutoSpinToast(`+${prize.value} ГБ в копилку · билетов: ${remaining}`);
      } else {
        setAutoSpinToast(`Билетов осталось: ${remaining}`);
      }
      onRefreshProfile();
      if (keepAuto && remaining > 0) {
        window.setTimeout(() => void spin({ fromAuto: true }), 450);
      } else if (keepAuto && remaining <= 0) {
        resetSpinState({ stopAuto: true });
      }
    } catch (e) {
      resetSpinState({ stopAuto: fromAuto });
      setError(formatClientError(e));
    }
  }, [
    ticketCount,
    activePrizes,
    initData,
    onRefreshProfile,
    catalog,
    applyPiggyFromResult,
    patchSelectedSub,
    selectedSub,
    startPendingWheelSpin,
    stopPendingWheelSpin,
    animateWheelToFinal,
    resetSpinState,
  ]);

  const requestSpin = useCallback(() => {
    if (autoSpinRef.current) {
      setAutoSpin(false);
      autoSpinRef.current = false;
      setAutoSpinToast(null);
    }
    if (gameTab !== "wheel") {
      pendingSpinRef.current = true;
      setGameTab("wheel");
      return;
    }
    void spin();
  }, [gameTab, spin]);

  const handleAutoSpinToggle = useCallback(
    (next: boolean) => {
      setAutoSpin(next);
      autoSpinRef.current = next;
      if (!next) setAutoSpinToast(null);
      if (next && !spinInFlightRef.current && ticketCount > 0) {
        void spin({ fromAuto: true });
      }
    },
    [ticketCount, spin],
  );

  const piggyPct = localPiggy
    ? Math.min(100, (localPiggy.accumulated_gb / localPiggy.exchange_threshold) * 100)
    : 0;

  useEffect(() => {
    if (!pendingSpinRef.current || gameTab !== "wheel") return;
    pendingSpinRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void spin();
      });
    });
  }, [gameTab, spin]);

  const buyTicketsPage =
    shopVisible && shop && selectedSub ? (
      <section className="mysub-section roulette-game__buy-page">
        <div className="roulette-game__tickets-card roulette-game__tickets-card--compact">
          {subscriptions.length > 1 ? (
            <div className="form-field roulette-game__sub-picker">
              <label className="roulette-game__sub-picker-label">Подписка для покупки</label>
              <select
                value={String(selectedSubId)}
                onChange={(e) => setSelectedSubId(Number(e.target.value) || 0)}
              >
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {subscriptionLabel(s)} — {s.tickets} {ticketsWord(s.tickets)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="roulette-game__tickets-line">
            <span className="roulette-game__tickets-icon" aria-hidden>
              🎟️
            </span>
            Билетов: <b>{ticketCount}</b>
          </p>
        </div>
        <h1 className="mysub-title">Купить билеты</h1>
        <p className="field-hint roulette-game__buy-hint">
          Списание за дни или ГБ — с выбранной подписки. Билеты начисляются на неё же.
        </p>
        {selectedSub.stats ? (
          <div className="roulette-game__buy-balances roulette-game__buy-balances--page">
            {selectedSub.stats.remaining_days != null && !selectedSub.stats.unlimited_time ? (
              <p>
                Дней подписки доступно: <b>{selectedSub.stats.remaining_days}</b>
              </p>
            ) : selectedSub.stats.unlimited_time ? (
              <p className="field-hint">Подписка без срока — оплата за дни недоступна.</p>
            ) : null}
            {selectedSub.stats.remaining_gb != null && !selectedSub.stats.unlimited_traffic ? (
              <p>
                ГБ доступно: <b>{selectedSub.stats.remaining_gb}</b>
              </p>
            ) : selectedSub.stats.unlimited_traffic ? (
              <p className="field-hint">Безлимитный тариф — оплата за ГБ недоступна.</p>
            ) : null}
          </div>
        ) : null}
        <div className="roulette-game__buy-cards roulette-game__buy-cards--page">
          {shop.allow_days ? (
            <div className="roulette-game__buy-card">
              <p className="roulette-game__buy-card-icon" aria-hidden>
                🎟️
              </p>
              <p className="roulette-game__buy-card-line">1 {ticketsWord(1)}</p>
              <p className="field-hint">
                Стоимость: {shop.price_days_per_ticket} {daysWord(shop.price_days_per_ticket)}
              </p>
              {selectedSub.stats?.unlimited_time ? (
                <p className="field-hint roulette-game__buy-card-warn">Покупка за дни недоступна</p>
              ) : maxBuyTicketsDays < minTickets ? (
                <p className="field-hint roulette-game__buy-card-warn">Недостаточно дней подписки</p>
              ) : null}
              <button
                type="button"
                className="primary roulette-game__buy-card-btn"
                disabled={
                  selectedSub.stats?.unlimited_time ||
                  !selectedSub.stats ||
                  maxBuyTicketsDays < minTickets
                }
                onClick={() => openBuyModal("subscription_days")}
              >
                Купить за дни
              </button>
            </div>
          ) : null}
          {shop.allow_gb ? (
            <div className="roulette-game__buy-card">
              <p className="roulette-game__buy-card-icon" aria-hidden>
                🎟️
              </p>
              <p className="roulette-game__buy-card-line">1 {ticketsWord(1)}</p>
              <p className="field-hint">Стоимость: {shop.price_gb_per_ticket} ГБ</p>
              {selectedSub.stats?.unlimited_traffic ? (
                <p className="field-hint roulette-game__buy-card-warn">На безлимитном тарифе покупка за ГБ недоступна.</p>
              ) : selectedSub.stats && (selectedSub.stats.remaining_gb ?? 0) < shop.price_gb_per_ticket ? (
                <p className="field-hint roulette-game__buy-card-warn">Недостаточно ГБ трафика</p>
              ) : null}
              <button
                type="button"
                className="primary roulette-game__buy-card-btn"
                disabled={
                  selectedSub.stats?.unlimited_traffic ||
                  !selectedSub.stats ||
                  (selectedSub.stats.remaining_gb ?? 0) < shop.price_gb_per_ticket
                }
                onClick={() => openBuyModal("traffic_gb")}
              >
                Купить за ГБ
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="roulette-game__help-pill" onClick={() => setTicketsHelpOpen(true)}>
          Как получить билеты за покупку?
        </button>
      </section>
    ) : null;

  return (
    <div className="roulette-game">
      {shopVisible ? (
        <div className="roulette-game__tabs" role="tablist" aria-label="Раздел игры">
          <button
            type="button"
            role="tab"
            aria-selected={gameTab === "wheel"}
            className={`roulette-game__tab ${gameTab === "wheel" ? "roulette-game__tab--active" : ""}`}
            onClick={() => setGameTab("wheel")}
          >
            Рулетка
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={gameTab === "buy"}
            className={`roulette-game__tab ${gameTab === "buy" ? "roulette-game__tab--active" : ""}`}
            onClick={() => setGameTab("buy")}
          >
            Купить билеты
          </button>
        </div>
      ) : null}

      {buyTicketsPage ? (
        <div className="roulette-game__panel" hidden={gameTab !== "buy"}>
          {buyTicketsPage}
        </div>
      ) : null}

      <div className="roulette-game__panel" hidden={gameTab === "buy"}>
      <section className="mysub-section roulette-game__hero">
        <h1 className="mysub-title">Рулетка подарков 🎁</h1>
        <p className="field-hint roulette-game__subtitle">
          Крутите рулетку и выигрывайте дни подписки, ГБ и апгрейд тарифа.
        </p>
        <div className="roulette-game__tickets-card">
          {subscriptions.length > 1 ? (
            <div className="form-field roulette-game__sub-picker">
              <label className="roulette-game__sub-picker-label">Подписка для игры</label>
              <select
                value={String(selectedSubId)}
                disabled={spinBusy}
                onChange={(e) => {
                  const id = Number(e.target.value) || 0;
                  setSelectedSubId(id);
                  if (autoSpinRef.current) {
                    setAutoSpin(false);
                    autoSpinRef.current = false;
                    setAutoSpinToast(null);
                  }
                }}
              >
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {subscriptionLabel(s)} — {s.tickets} {ticketsWord(s.tickets)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="roulette-game__tickets-row">
            <p className="roulette-game__tickets-line">
              <span className="roulette-game__tickets-icon" aria-hidden>
                🎟️
              </span>
              Билетов: <b>{ticketCount}</b>
            </p>
            <button type="button" className="roulette-game__help-pill" onClick={() => setTicketsHelpOpen(true)}>
              Как получить билеты?
            </button>
          </div>
          <p className="field-hint roulette-game__tickets-note">1 билет = 1 прокрут</p>
        </div>
      </section>

      <div className="roulette-game__stage">
        <div className="roulette-game__stage-glow" aria-hidden />
        <div className="roulette-game__pointer-wrap" aria-hidden>
          <div className="roulette-game__pointer" />
        </div>
        <div className="roulette-game__wheel-frame">
          <div
            ref={wheelRef}
            className={`roulette-game__wheel ${spinRequesting ? "roulette-game__wheel--pending" : ""} ${spinning ? "roulette-game__wheel--spinning" : ""}`}
            style={{
              background: wheelGradient,
              transform: `rotate(${rotation}deg)`,
            }}
          >
            <div className="roulette-game__wheel-shine" aria-hidden />
            {activePrizes.map((_, i) => (
              <div
                key={`spoke-${i}`}
                className="roulette-game__spoke"
                style={{ transform: `rotate(${i * segAngle}deg)` }}
                aria-hidden
              />
            ))}
            {activePrizes.map((p, i) => {
            const display = toDisplayPrize(p);
            const sectorColor = getPrizeColor(display, i);
            const textClass = getPrizeLabelTextClass(sectorColor);
            const icon = getPrizeIcon(display);
            const shortTitle = getPrizeShortTitle(display);
            return (
              <div
                key={p.id}
                className={`roulette-game__label ${textClass}`}
                style={{ transform: labelTransformCss(i, activePrizes.length, labelRadiusPx) }}
              >
                <span className="roulette-game__label-icon">{icon}</span>
                <span
                  className={`roulette-game__label-text ${compactLabel ? "roulette-game__label-text--compact" : ""}`}
                >
                  {shortTitle}
                </span>
              </div>
            );
          })}
          </div>
          <div className="roulette-game__rim-lights" aria-hidden>
            {Array.from({ length: 16 }, (_, i) => (
              <span
                key={i}
                className="roulette-game__rim-light"
                style={{ "--rim-angle": `${i * 22.5}deg` } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
        <div className="roulette-game__wheel-cap" aria-hidden />
      </div>

      {error ? <div className="flash err">{error}</div> : null}
      {autoSpinToast ? <div className="flash ok roulette-game__autospin-toast">{autoSpinToast}</div> : null}

      {(ticketCount > 4 || autoSpin) && ticketCount > 0 ? (
        <div className="roulette-game__autospin-row">
          <div className="roulette-game__autospin-text">
            <p className="roulette-game__autospin-label">Автопрокрутка</p>
            <p className="field-hint">Крутить автоматически, пока не кончатся билеты</p>
          </div>
          <button
            type="button"
            className={`toggle ${autoSpin ? "on" : ""}`}
            disabled={spinBusy && !autoSpin}
            onClick={() => handleAutoSpinToggle(!autoSpin)}
            aria-pressed={autoSpin}
            aria-label="Автопрокрутка"
          />
        </div>
      ) : null}

      <div className="roulette-game__actions">
        <button
          type="button"
          className="primary roulette-game__spin-btn"
          disabled={spinBusy || ticketCount <= 0}
          onClick={() => {
            if (autoSpin) {
              handleAutoSpinToggle(false);
              return;
            }
            requestSpin();
          }}
        >
          {spinBusy ? (
            <>
              <Spinner /> {autoSpin ? "Автокрутка…" : spinRequesting ? "Запрос…" : "Крутим…"}
            </>
          ) : ticketCount <= 0 ? (
            "Нет билетов"
          ) : autoSpin ? (
            "Остановить автопрокрутку"
          ) : (
            "Крутить рулетку"
          )}
        </button>
        {ticketCount <= 0 ? (
          <>
            <p className="field-hint roulette-game__no-tickets-hint">Билеты начисляются за покупки.</p>
            {shopVisible ? (
              <button type="button" className="ghost" onClick={() => setGameTab("buy")}>
                Купить билеты за ресурсы
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={onBuyClick}>
              Купить подписку и получить билеты
            </button>
          </>
        ) : null}
        <button type="button" className="ghost" onClick={() => setHistoryOpen(true)}>
          Мои выигрыши
        </button>
      </div>

      {localPiggy ? (
        <div className="roulette-piggy-wrap">
          <section className={`roulette-piggy ${localPiggy.can_exchange ? "roulette-piggy--ready" : ""}`}>
            <div className="roulette-piggy__visual" aria-hidden>
              <div className="roulette-piggy__glow" />
              <div className="roulette-piggy__jar">
                <div className="roulette-piggy__jar-fill" style={{ height: `${piggyPct}%` }} />
                <span className="roulette-piggy__jar-emoji">🐷</span>
              </div>
              <div className="roulette-piggy__float-coins">
                <span>📶</span>
                <span>💎</span>
                <span>📶</span>
              </div>
            </div>
            <div className="roulette-piggy__content">
              <h2 className="roulette-piggy__title">Копилка ГБ</h2>
              <p className="roulette-piggy__hint">
                На безлимитном тарифе выигранные ГБ копятся здесь
                {subscriptions.length > 1 && selectedSub ? ` (${subscriptionLabel(selectedSub)})` : ""}
              </p>
              <p className="roulette-piggy__counter">
                <strong>{localPiggy.accumulated_gb}</strong>
                <span> / {localPiggy.exchange_threshold} ГБ</span>
              </p>
              <div
                className="roulette-piggy__progress"
                role="progressbar"
                aria-valuenow={localPiggy.accumulated_gb}
                aria-valuemin={0}
                aria-valuemax={localPiggy.exchange_threshold}
              >
                <div className="roulette-piggy__progress-fill" style={{ width: `${piggyPct}%` }} />
              </div>
              <button
                type="button"
                className="primary roulette-piggy__exchange-btn"
                disabled={!localPiggy.can_exchange || piggyExchanging || spinBusy}
                onClick={() => void exchangePiggy()}
              >
                {piggyExchanging
                  ? "Обмен…"
                  : localPiggy.can_exchange
                    ? `Обменять ${localPiggy.exchange_threshold} ГБ → 1 билет`
                    : `Ещё ${localPiggy.exchange_threshold - localPiggy.accumulated_gb} ГБ до билета`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      </div>

      {ticketsHelpOpen ? (
        <div className="modal-backdrop" onClick={() => setTicketsHelpOpen(false)}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Как получить билеты?</h2>
              <ModalCloseButton onClick={() => setTicketsHelpOpen(false)} />
            </div>
            <div className="modal-body">
              <p style={{ lineHeight: 1.7, margin: 0 }}>
                Билеты начисляются за подтверждённые покупки.
                <br />
                За одну покупку вы получаете <b>{ticketsPerPurchase}</b>{" "}
                {ticketsPerPurchase === 1 ? "билет" : "билета"}.
                <br />
                1 билет = 1 прокрут рулетки.
              </p>
            </div>
            <div className="modal-footer roulette-game__modal-footer">
              <button type="button" className="ghost" onClick={() => setTicketsHelpOpen(false)}>
                Понятно
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setTicketsHelpOpen(false);
                  onBuyClick();
                }}
              >
                Купить подписку
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <div className="modal mysub-modal roulette-game__history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Мои выигрыши</h2>
              <ModalCloseButton onClick={() => setHistoryOpen(false)} />
            </div>
            <div className="modal-body roulette-game__history-modal-body">
              {mergedHistory.length === 0 ? (
                <p className="field-hint">Вы ещё не крутили рулетку.</p>
              ) : (
                <ul className="roulette-game__history">
                  {mergedHistory.map((item) => {
                    if (item.kind === "ticket_purchase") {
                      const p = item.purchase;
                      const label =
                        p.payment_type === "subscription_days"
                          ? `Куплено ${p.tickets} ${ticketsWord(p.tickets)} за ${p.cost} ${daysWord(p.cost)}`
                          : `Куплено ${p.tickets} ${ticketsWord(p.tickets)} за ${p.cost} ГБ`;
                      return (
                        <li key={item.key}>
                          <span className="roulette-game__history-icon" aria-hidden>
                            🎟️
                          </span>
                          <span className="roulette-game__history-text">{label}</span>
                          <span className="roulette-game__history-date">{formatDate(item.date)}</span>
                        </li>
                      );
                    }
                    const resolved = resolveHistoryPrize(item.spin.prize, catalog);
                    return (
                      <li key={item.key}>
                        <span className="roulette-game__history-icon" aria-hidden>
                          {getPrizeIcon(resolved)}
                        </span>
                        <span className="roulette-game__history-text">
                          {getPrizeShortTitle(resolved)} — {historyStatusLabel(item.spin.status)}
                        </span>
                        <span className="roulette-game__history-date">{formatDate(item.date)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="modal-footer roulette-game__modal-footer roulette-game__modal-footer--stack">
              <button type="button" className="primary" onClick={() => setHistoryOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {buyModalStep && buyPaymentType && shop ? (
        <div className="modal-backdrop" onClick={closeBuyModal}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{buyModalStep === "confirm" ? "Подтверждение покупки" : "Покупка билетов"}</h2>
            </div>
            <div className="modal-body">
              {buyModalStep === "quantity" ? (
                <>
                  <div className="roulette-game__buy-qty">
                    <button
                      type="button"
                      className="ghost"
                      disabled={buyQuantity <= minTickets}
                      {...holdDecBuyQty}
                    >
                      −
                    </button>
                    <span className="roulette-game__buy-qty-value">{buyQuantity}</span>
                    <button
                      type="button"
                      className="ghost"
                      disabled={buyQuantity >= buyTicketCap}
                      {...holdIncBuyQty}
                    >
                      +
                    </button>
                  </div>
                  <p className="roulette-game__buy-cost">
                    Стоимость:{" "}
                    {buyPaymentType === "subscription_days"
                      ? `${buyCost} ${daysWord(buyCost)}`
                      : `${buyCost} ГБ трафика`}
                  </p>
                  {selectedSub?.stats ? (
                    <div className="roulette-game__buy-balances">
                      {subscriptions.length > 1 ? (
                        <p className="field-hint">Подписка: <b>{subscriptionLabel(selectedSub)}</b></p>
                      ) : null}
                      {selectedSub.stats.remaining_days != null && !selectedSub.stats.unlimited_time ? (
                        <p>
                          Дней подписки доступно: <b>{selectedSub.stats.remaining_days}</b>
                          {buyPaymentType === "subscription_days" && maxBuyTicketsDays > 0 ? (
                            <span className="field-hint">
                              {" "}
                              · макс. {maxBuyTicketsDays} {ticketsWord(maxBuyTicketsDays)}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {selectedSub.stats.remaining_gb != null && !selectedSub.stats.unlimited_traffic ? (
                        <p>ГБ доступно: <b>{selectedSub.stats.remaining_gb}</b></p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p style={{ lineHeight: 1.7, margin: 0 }}>
                  Вы хотите купить {buyQuantity} {ticketsWord(buyQuantity)} за{" "}
                  {buyPaymentType === "subscription_days"
                    ? `${buyCost} ${daysWord(buyCost)}`
                    : `${buyCost} ГБ трафика`}
                  ?
                </p>
              )}
              {buyError ? <div className="flash err">{buyError}</div> : null}
            </div>
            <div className="modal-footer roulette-game__modal-footer">
              <button type="button" className="ghost" disabled={buySubmitting} onClick={closeBuyModal}>
                Отмена
              </button>
              {buyModalStep === "quantity" ? (
                <button
                  type="button"
                  className="primary"
                  disabled={
                    buySubmitting ||
                    (buyPaymentType === "subscription_days" ? !canPayWithDays : !canPayWithGb)
                  }
                  onClick={() => setBuyModalStep("confirm")}
                >
                  Купить
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={
                    buySubmitting ||
                    (buyPaymentType === "subscription_days" ? !canPayWithDays : !canPayWithGb)
                  }
                  onClick={() => void confirmBuy()}
                >
                  {buySubmitting ? (
                    <>
                      <Spinner /> Покупаем…
                    </>
                  ) : (
                    "Подтвердить"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {buySuccess ? (
        <div className="modal-backdrop" onClick={() => setBuySuccess(null)}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Готово!</h2>
            </div>
            <div className="modal-body">
              <p style={{ lineHeight: 1.7, margin: 0 }}>
                Вы купили {buySuccess.tickets} {ticketsWord(buySuccess.tickets)} 🎟️
              </p>
              <p className="field-hint" style={{ marginTop: "0.5rem" }}>
                Списано:{" "}
                {buySuccess.paymentType === "subscription_days"
                  ? `${buySuccess.cost} ${daysWord(buySuccess.cost)}`
                  : `${buySuccess.cost} ГБ трафика`}
              </p>
            </div>
            <div className="modal-footer roulette-game__success-footer">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setBuySuccess(null);
                  requestSpin();
                }}
              >
                Крутить рулетку
              </button>
              <button type="button" className="ghost" onClick={() => setBuySuccess(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {winModal ? (
        <div className="modal-backdrop roulette-game__win-backdrop" onClick={() => setWinModal(null)}>
          <div
            className={`roulette-game__win-sheet ${winModal.lose ? "roulette-game__win-sheet--lose" : ""}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="roulette-game__win-sheet-glow" aria-hidden />
            <div className="roulette-game__win-sheet-body">
              <p className="roulette-game__win-eyebrow">{winModal.lose ? "Не повезло" : "Ваш приз"}</p>
              <div className="roulette-game__win-icon-ring" aria-hidden>
                <span className="roulette-game__win-icon">{getPrizeIcon(winModal.prize)}</span>
              </div>
              <h2 className="roulette-game__win-heading">{winModal.lose ? "Увы…" : "Поздравляем!"}</h2>
              {winModal.lose ? (
                <>
                  <p className="roulette-game__win-prize">{winModal.winText ?? getRouletteLoseMessage()}</p>
                  <p className="roulette-game__win-sub">{winModal.winSub ?? "Билет списан. Попробуйте ещё раз!"}</p>
                </>
              ) : (
                <>
                  <p className="roulette-game__win-prize">{winModal.winText ?? getPrizeFullTitle(winModal.prize)}</p>
                  <p className="roulette-game__win-sub">{winModal.winSub ?? "Приз уже начислен в вашу подписку"}</p>
                </>
              )}
            </div>
            <div className="roulette-game__win-sheet-actions">
              {!winModal.lose && ticketCount > 0 ? (
                <button
                  type="button"
                  className="primary roulette-game__win-btn roulette-game__win-btn--main"
                  onClick={() => {
                    setWinModal(null);
                    requestSpin();
                  }}
                >
                  Крутить ещё
                </button>
              ) : null}
              <div className="roulette-game__win-btn-row">
                <button
                  type="button"
                  className="ghost roulette-game__win-btn roulette-game__win-btn--half"
                  onClick={() => {
                    setWinModal(null);
                    setHistoryOpen(true);
                  }}
                >
                  Мои выигрыши
                </button>
                <button
                  type="button"
                  className="ghost roulette-game__win-btn roulette-game__win-btn--half"
                  onClick={() => setWinModal(null)}
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
