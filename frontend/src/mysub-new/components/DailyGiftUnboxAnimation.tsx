type Props = {
  golden: boolean;
};

export default function DailyGiftUnboxAnimation({ golden }: Props) {
  if (golden) {
    return (
      <div className="mn-daily-gift__unbox mn-daily-gift__unbox--golden" aria-hidden>
        <div className="mn-daily-gift__gold-coin">
          <span className="mn-daily-gift__gold-coin-icon">✦</span>
        </div>
        <div className="mn-daily-gift__gold-melt" />
        <div className="mn-daily-gift__gold-drip mn-daily-gift__gold-drip--1" />
        <div className="mn-daily-gift__gold-drip mn-daily-gift__gold-drip--2" />
        <div className="mn-daily-gift__gold-drip mn-daily-gift__gold-drip--3" />
        <div className="mn-daily-gift__gold-pool" />
        <div className="mn-daily-gift__gold-spark mn-daily-gift__gold-spark--1" />
        <div className="mn-daily-gift__gold-spark mn-daily-gift__gold-spark--2" />
        <div className="mn-daily-gift__gold-spark mn-daily-gift__gold-spark--3" />
      </div>
    );
  }

  return (
    <div className="mn-daily-gift__unbox" aria-hidden>
      <div className="mn-daily-gift__split mn-daily-gift__split--left">
        <div className="mn-daily-gift__split-face">🎁</div>
      </div>
      <div className="mn-daily-gift__split mn-daily-gift__split--right">
        <div className="mn-daily-gift__split-face">🎁</div>
      </div>
      <div className="mn-daily-gift__split-core">✨</div>
      <div className="mn-daily-gift__split-burst" />
      <div className="mn-daily-gift__split-ring" />
    </div>
  );
}
