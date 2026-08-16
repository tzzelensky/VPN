import { useNavigate } from "react-router-dom";

/** Публичная витрина для неавторизованного захода на `/`. */
export default function DecoyShopPage() {
  const nav = useNavigate();

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
        <h1>ДомКомфорт</h1>
        <p className="decoy-shop__tag">Подушки, одеяла, наволочки — мягкий сон без лишнего шума</p>
      </header>
      <main className="decoy-shop__main">
        <section className="decoy-shop__card">
          <p>
            Мы подбираем наполнители и ткани так, чтобы вам было удобно читать, отдыхать и засыпать в
            тишине своей спальни.
          </p>
          <p>В каталоге — ортопедические и декоративные подушки, комплекты постельного белья, пледы.</p>
        </section>
        <div className="decoy-shop__grid" aria-label="Каталог">
          <article className="decoy-shop__item">
            <h3>Подушка «Облако»</h3>
            <p>Мягкий холлофайбер, чехол из сатина</p>
            <div className="decoy-shop__price">от 1 890 ₽</div>
          </article>
          <article className="decoy-shop__item">
            <h3>Одеяло «Тишина»</h3>
            <p>Лёгкое всесезонное, микрофибра</p>
            <div className="decoy-shop__price">от 3 450 ₽</div>
          </article>
          <article className="decoy-shop__item">
            <h3>Наволочки 50×70</h3>
            <p>Комплект из двух, хлопок</p>
            <div className="decoy-shop__price">от 990 ₽</div>
          </article>
          <article className="decoy-shop__item">
            <h3>Плед «Вечер»</h3>
            <p>Фланель, тёплый оттенок льна</p>
            <div className="decoy-shop__price">от 2 290 ₽</div>
          </article>
        </div>
        <p className="decoy-shop__note">Оставайтесь на связи — готовим новые позиции коллекции.</p>
        <div className="decoy-shop__review-wrap">
          <button type="button" className="decoy-shop__review-btn" onClick={() => void onReviewClick()}>
            Оставить отзыв
          </button>
        </div>
      </main>
      <footer className="decoy-shop__footer">© ДомКомфорт · доставка по России</footer>
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
        .decoy-shop__header h1 {
          font-size: 1.65rem;
          font-weight: 400;
          letter-spacing: 0.02em;
          margin: 0;
        }
        .decoy-shop__tag {
          font-size: 0.85rem;
          color: #7a6e5e;
          margin: 0.35rem 0 0;
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
          box-shadow: 0 8px 28px rgba(44, 36, 24, 0.06);
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
          margin-top: 0.5rem;
          color: #c4a574;
          font-size: 0.95rem;
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
