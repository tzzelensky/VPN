/** Витрина каталога — корень, `/comfort` и браузерные заходы на `/sub`/`/goods`. */

import { getPanelSettings } from "./panelSettings.js";
import { DEFAULT_DECOY_SHOP, type PanelDecoyShop } from "./panelSettingsTypes.js";

function shopStyles(): string {
  return `
    :root { color-scheme: light; --bg: #faf7f2; --text: #2c2418; --muted: #7a6e5e; --accent: #c4a574; --card: #fff; --line: #e5ddd0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    header { padding: 1.5rem 1.25rem; text-align: center; border-bottom: 1px solid var(--line); background: var(--card); }
    .brand-mark { width: 88px; height: 88px; border-radius: 50%; object-fit: cover; display: block; margin: 0 auto 0.85rem; box-shadow: 0 6px 18px rgba(44,36,24,.12); background: #fff; }
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

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shopShell(shop: PanelDecoyShop, body: string, opts?: { reviewButton?: boolean }): string {
  const reviewBtn = opts?.reviewButton
    ? `<div style="text-align:center"><button type="button" class="review-btn" id="shop-review-btn">Оставить отзыв</button></div>`
    : "";
  const script = opts?.reviewButton ? reviewScript() : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(shop.title)}</title>
  <link rel="icon" type="image/png" href="/domcomfort-tab.png?v=200" />
  <link rel="shortcut icon" type="image/png" href="/domcomfort-tab.png?v=200" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=200" />
  <style>${shopStyles()}</style>
</head>
<body>
  <header>
    <img class="brand-mark" src="/domcomfort-icon.png" width="88" height="88" alt="${escHtml(shop.brand)}" />
    <h1>${escHtml(shop.brand)}</h1>
    <div class="tag">${escHtml(shop.tagline)}</div>
  </header>
  <main>${body}${reviewBtn}</main>
  <footer>${escHtml(shop.footer)}</footer>
  ${script}
</body>
</html>`;
}

export function getDecoyShopConfig(): PanelDecoyShop {
  try {
    return getPanelSettings().panel.decoyShop ?? DEFAULT_DECOY_SHOP;
  } catch {
    return DEFAULT_DECOY_SHOP;
  }
}

/** Главная витрина каталога-заглушки. */
export function buildSubscriptionDecoyHtml(): string {
  const shop = getDecoyShopConfig();
  const introHtml = shop.intro.map((p) => `<p>${escHtml(p)}</p>`).join("\n");
  const itemsHtml = shop.items
    .map(
      (it) => `
      <div class="item">
        <h3>${escHtml(it.name)}</h3>
        <p class="muted">${escHtml(it.description)}</p>
        <div class="price">${escHtml(it.price)}</div>
      </div>`,
    )
    .join("");
  return shopShell(
    shop,
    `
    <div class="card">
      ${introHtml}
    </div>
    <div class="grid" aria-label="Каталог">
      ${itemsHtml}
    </div>
    ${shop.note ? `<p class="note">${escHtml(shop.note)}</p>` : ""}
  `,
    { reviewButton: true },
  );
}

/** @deprecated use buildSubscriptionDecoyHtml() */
export function getSubscriptionDecoyHtmlSnapshot(): string {
  return buildSubscriptionDecoyHtml();
}

/** @deprecated oracle removed — same as catalog */
export function getSubscriptionProductNotFoundHtml(): string {
  return buildSubscriptionDecoyHtml();
}
