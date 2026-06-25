import Badge from "./Badge";

type Props = {
  title: string;
  meta: string;
  price: string;
  oldPrice?: string;
  discountPercent?: number;
  selected?: boolean;
  popular?: boolean;
  onSelect: () => void;
};

export default function TariffCard({ title, meta, price, oldPrice, discountPercent, selected, popular, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`mn-tariff ${selected ? "is-selected" : ""}`.trim()}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {popular ? <Badge tone="accent">Популярный</Badge> : null}
      <span className="mn-tariff__title">{title}</span>
      <span className="mn-tariff__meta">{meta}</span>
      <span className="mn-tariff__price">
        {oldPrice ? <s className="mn-tariff__price-old">{oldPrice}</s> : null}
        <span>{price}</span>
        {discountPercent ? <span className="mn-tariff__discount">−{discountPercent}%</span> : null}
      </span>
      {selected ? <span className="mn-tariff__check" aria-hidden>✓</span> : null}
    </button>
  );
}
