import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_DECOY_SHOP, type PanelDecoyShop } from "../panelSettingsTypes";

/** Публичная витрина для неавторизованного захода на `/`. */
export default function DecoyShopPage() {
  const nav = useNavigate();
  const [shop, setShop] = useState<PanelDecoyShop>(DEFAULT_DECOY_SHOP);

  useEffect(() => {
    document.title = shop.title;
  }, [shop.title]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/public/decoy-shop", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: { shop?: PanelDecoyShop }) => {
        if (cancelled || !j?.shop) return;
        setShop({
          ...DEFAULT_DECOY_SHOP,
          ...j.shop,
          intro: Array.isArray(j.shop.intro) && j.shop.intro.length ? j.shop.intro : DEFAULT_DECOY_SHOP.intro,
          items: Array.isArray(j.shop.items) && j.shop.items.length ? j.shop.items : DEFAULT_DECOY_SHOP.items,
        });
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onReviewClick() {
    const text = window.prompt("Оставьте отзыв");
    if (text === null) return;
    try {
      const r = await fetch("/api/public/shop-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        credentials: "same-origin",
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (j.ok) {
        nav("/login");
        return;
      }
      window.alert(j.error || "Отзывы еще не работают");
    } catch {
      window.alert("Отзывы еще не работают");
    }
  }

  return (
    <div className="decoy-shop">
      <header className="decoy-shop__header">
        <img className="decoy-shop__avatar" src="/domcomfort-icon.png" width={88} height={88} alt={shop.brand} />
        <h1>{shop.brand}</h1>
        <p className="decoy-shop__tag">{shop.tagline}</p>
      </header>
      <main className="decoy-shop__main">
        <section className="decoy-shop__card">
          {shop.intro.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </section>
        <div className="decoy-shop__grid" aria-label="Каталог">
          {shop.items.map((it) => (
            <article className="decoy-shop__item" key={`${it.name}-${it.price}`}>
              <h3>{it.name}</h3>
              <p>{it.description}</p>
              <div className="decoy-shop__price">{it.price}</div>
            </article>
          ))}
        </div>
        {shop.note ? <p className="decoy-shop__note">{shop.note}</p> : null}
        <div className="decoy-shop__review-wrap">
          <button type="button" className="decoy-shop__review-btn" onClick={() => void onReviewClick()}>
            Оставить отзыв
          </button>
        </div>
      </main>
      <footer className="decoy-shop__footer">{shop.footer}</footer>
      <style>{`
        .decoy-shop {
          min-height: 100vh;
          margin: 0;
          font-family: Georgia, "Times New Roman", serif;
          background: #faf7f2;
          color: #2c2418;
          line-height: 1.6;
        }
        .decoy-shop__header {
          padding: 1.5rem 1.25rem;
          text-align: center;
          border-bottom: 1px solid #e5ddd0;
          background: #fff;
        }
        .decoy-shop__avatar {
          width: 88px;
          height: 88px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
          margin: 0 auto 0.85rem;
          box-shadow: 0 6px 18px rgba(44,36,24,.12);
          background: #fff;
        }
        .decoy-shop__header h1 {
          font-size: 1.65rem;
          font-weight: 400;
          letter-spacing: 0.02em;
          margin: 0;
        }
        .decoy-shop__tag {
          font-size: 0.85rem;
          color: #7a6e5e;
          margin-top: 0.35rem;
        }
        .decoy-shop__main {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.25rem 3rem;
        }
        .decoy-shop__card {
          background: #fff;
          border-radius: 12px;
          padding: 1.25rem 1.35rem;
          box-shadow: 0 8px 28px rgba(44,36,24,.06);
          border: 1px solid #ebe4d9;
        }
        .decoy-shop__card p { margin: 0 0 1rem; }
        .decoy-shop__card p:last-child { margin-bottom: 0; }
        .decoy-shop__grid {
          display: grid;
          gap: 0.85rem;
          margin-top: 1.25rem;
        }
        @media (min-width: 560px) {
          .decoy-shop__grid { grid-template-columns: 1fr 1fr; }
        }
        .decoy-shop__item {
          background: #fff;
          border: 1px solid #ebe4d9;
          border-radius: 10px;
          padding: 1rem 1.1rem;
        }
        .decoy-shop__item h3 {
          margin: 0 0 0.35rem;
          font-size: 1.05rem;
          font-weight: 400;
        }
        .decoy-shop__item p {
          margin: 0;
          color: #7a6e5e;
          font-size: 0.92rem;
        }
        .decoy-shop__price {
          color: #c4a574;
          font-size: 0.95rem;
          margin-top: 0.35rem;
        }
        .decoy-shop__note {
          margin-top: 1.25rem;
          font-size: 0.9rem;
          color: #7a6e5e;
        }
        .decoy-shop__review-wrap {
          display: none;
          text-align: center;
          margin-top: 1.25rem;
        }
        @media (max-width: 767px) {
          .decoy-shop__review-wrap { display: block; }
        }
        .decoy-shop__review-btn {
          padding: 0.7rem 1.25rem;
          font: inherit;
          font-size: 0.95rem;
          color: #2c2418;
          background: #fff;
          border: 1px solid #e5ddd0;
          border-radius: 999px;
          cursor: pointer;
        }
        .decoy-shop__footer {
          text-align: center;
          font-size: 0.8rem;
          color: #9a8f82;
          padding: 1.5rem;
        }
      `}</style>
    </div>
  );
}
