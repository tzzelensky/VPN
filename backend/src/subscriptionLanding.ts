/** Витрина «ДомКомфорт» — корень, `/comfort` и браузерные заходы на `/sub`/`/goods`. */

function shopStyles(): string {
  return `
    :root { color-scheme: light; --bg: #faf7f2; --text: #2c2418; --muted: #7a6e5e; --accent: #c4a574; --card: #fff; --line: #e5ddd0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    header { padding: 1.5rem 1.25rem; text-align: center; border-bottom: 1px solid var(--line); background: var(--card); }
    h1 { font-size: 1.65rem; font-weight: 400; letter-spacing: 0.02em; margin: 0; }
    .tag { font-size: 0.85rem; color: var(--muted); margin-top: 0.35rem; }
    main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    p { margin: 0 0 1rem; }
    .card { background: var(--card); border-radius: 12px; padding: 1.25rem 1.35rem; box-shadow: 0 8px 28px rgba(44,36,24,.06); border: 1px solid #ebe4d9; }
    .grid { display: grid; gap: 0.85rem; margin-top: 1.25rem; }
    @media (min-width: 560px) { .grid { grid-template-columns: 1fr 1fr; } }
    .item { background: var(--card); border: 1px solid #ebe4d9; border-radius: 10px; padding: 1rem 1.1rem; }
    .item h3 { margin: 0 0 0.35rem; font-size: 1.05rem; font-weight: 400; }
    .item .price { color: var(--accent); font-size: 0.95rem; }
    .muted { color: var(--muted); font-size: 0.92rem; }
    .note { margin-top: 1.25rem; font-size: 0.9rem; color: var(--muted); }
    footer { text-align: center; font-size: 0.8rem; color: #9a8f82; padding: 1.5rem; }
    .review-btn {
      display: none;
      margin: 1.25rem auto 0;
      padding: 0.7rem 1.25rem;
      font: inherit;
      font-size: 0.95rem;
      color: var(--text);
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 999px;
      cursor: pointer;
    }
    @media (max-width: 767px) {
      .review-btn { display: inline-block; }
    }
    .review-btn:active { opacity: 0.85; }
  `;
}

function reviewScript(): string {
  return `
<script>
(function () {
  var btn = document.getElementById("shop-review-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var text = window.prompt("Оставьте отзыв");
    if (text === null) return;
    fetch("/api/public/shop-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: String(text) }),
      credentials: "same-origin"
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.ok) {
          window.location.href = "/login";
          return;
        }
        window.alert((res.j && res.j.error) || "Отзывы еще не работают");
      })
      .catch(function () {
        window.alert("Отзывы еще не работают");
      });
  });
})();
</script>`;
}

function shopShell(title: string, body: string, opts?: { reviewButton?: boolean }): string {
  const reviewBtn = opts?.reviewButton
    ? `<div style="text-align:center"><button type="button" class="review-btn" id="shop-review-btn">Оставить отзыв</button></div>`
    : "";
  const script = opts?.reviewButton ? reviewScript() : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${shopStyles()}</style>
</head>
<body>
  <header>
    <h1>ДомКомфорт</h1>
    <div class="tag">Подушки, одеяла, наволочки — мягкий сон без лишнего шума</div>
  </header>
  <main>${body}${reviewBtn}</main>
  <footer>© ДомКомфорт · доставка по России</footer>
  ${script}
</body>
</html>`;
}

/** Главная витрина каталога-заглушки. */
export function buildSubscriptionDecoyHtml(): string {
  return shopShell(
    "ДомКомфорт — подушки и текстиль для сна",
    `
    <div class="card">
      <p>Мы подбираем наполнители и ткани так, чтобы вам было удобно читать, отдыхать и засыпать в тишине своей спальни.</p>
      <p>В каталоге — ортопедические и декоративные подушки, комплекты постельного белья, пледы.</p>
    </div>
    <div class="grid" aria-label="Каталог">
      <div class="item">
        <h3>Подушка «Облако»</h3>
        <p class="muted">Мягкий холлофайбер, чехол из сатина</p>
        <div class="price">от 1 890 ₽</div>
      </div>
      <div class="item">
        <h3>Одеяло «Тишина»</h3>
        <p class="muted">Лёгкое всесезонное, микрофибра</p>
        <div class="price">от 3 450 ₽</div>
      </div>
      <div class="item">
        <h3>Наволочки 50×70</h3>
        <p class="muted">Комплект из двух, хлопок</p>
        <div class="price">от 990 ₽</div>
      </div>
      <div class="item">
        <h3>Плед «Вечер»</h3>
        <p class="muted">Фланель, тёплый оттенок льна</p>
        <div class="price">от 2 290 ₽</div>
      </div>
    </div>
    <p class="note">Оставайтесь на связи — готовим новые позиции коллекции.</p>
  `,
    { reviewButton: true },
  );
}

/** @deprecated use buildSubscriptionDecoyHtml() — kept for static imports during transition */
export const SUBSCRIPTION_DECOY_HTML = buildSubscriptionDecoyHtml();

/** «Товар не найден» для браузерных/probe запросов к подписке. */
export const SUBSCRIPTION_PRODUCT_NOT_FOUND_HTML = shopShell(
  "Товар не найден — ДомКомфорт",
  `
    <div class="card">
      <p>К сожалению, такой товар не найден или временно недоступен.</p>
      <p class="muted">Проверьте адрес страницы или вернитесь в каталог на главной.</p>
    </div>
  `,
);
