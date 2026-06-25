import { createPortal } from "react-dom";
import DropperGame from "../../components/DropperGame";
import RouletteGame from "../../components/RouletteGame";
import DropperLobbyHero from "../../components/DropperLobbyHero";
import { loadMySubWebAppProfile } from "../../api";
import Card from "../components/Card";
import SecondaryButton from "../components/SecondaryButton";
import type { MySubWebAppController } from "../types";

type Props = { ctrl: MySubWebAppController };

export default function GameTabNew({ ctrl }: Props) {
  const {
    data,
    initData,
    setData,
    setTab,
    gameVisible,
    activeGame,
    dropperSession,
    dropperPlaying,
    dropperTargetUserId,
    setPickedSubId,
    dropperStartBusy,
    dropperNoTickets,
    startDropperPlay,
    openDropperPracticeIntro,
    setDropperInstructionOpen,
    finishDropperAndRefresh,
  } = ctrl;

  if (!gameVisible) {
    return (
      <Card>
        <p className="mn-empty">Игра сейчас недоступна.</p>
      </Card>
    );
  }

  if (activeGame === "roulette" && data.roulette) {
    return (
      <div className="mn-game-wrap">
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
      </div>
    );
  }

  if (activeGame === "dropper" && data.dropper.enabled) {
    return (
      <>
        <div className={`mn-game-wrap mn-dropper ${dropperSession ? "mn-dropper--playing" : ""}`.trim()}>
          {!dropperSession ? (
            <Card className="mn-dropper-hero">
              <h2 className="mn-title">Дроппер</h2>
              <p className="mn-muted">
                Билетов:{" "}
                <b>
                  {data.subscriptions.find((s) => s.id === dropperTargetUserId)?.tickets ?? data.dropper.tickets}
                </b>
              </p>
              <div className="mn-dropper-cliff">
                <DropperLobbyHero />
              </div>
              {data.subscriptions.length > 1 ? (
                <select
                  className="mn-select"
                  value={String(dropperTargetUserId)}
                  onChange={(e) => setPickedSubId(Number(e.target.value) || 0)}
                >
                  {data.subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <SecondaryButton
                fullWidth
                className="mn-dropper-play"
                disabled={dropperStartBusy || !dropperTargetUserId}
                onClick={() => void startDropperPlay()}
              >
                {dropperStartBusy ? "Запуск…" : "Играть"}
              </SecondaryButton>
              <SecondaryButton fullWidth onClick={openDropperPracticeIntro} disabled={dropperStartBusy}>
                Тренировка
              </SecondaryButton>
              {dropperNoTickets ? (
                <p className="mn-feedback err">Нет билетов. Совершите покупку в разделе «Оплата».</p>
              ) : null}
              <SecondaryButton fullWidth onClick={() => setDropperInstructionOpen(true)}>
                Инструкция
              </SecondaryButton>
              <div className="mn-dropper-stats">
                <p>Попыток: {data.dropper.plays}</p>
                <p>Побед: {data.dropper.wins}</p>
              </div>
            </Card>
          ) : null}
        </div>
        {dropperSession && dropperPlaying
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
      </>
    );
  }

  return (
    <Card>
      <p className="mn-empty">Игра сейчас недоступна.</p>
    </Card>
  );
}
