/** Заглушка «магазин подушек» — отдельный URL `/comfort`, не `/sub/…`, иначе клиенты с WebView получали HTML вместо подписки. */
export const SUBSCRIPTION_DECOY_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ДомКомфорт — подушки и текстиль для сна</title>
  <style>
    :root { color-scheme: light; --bg: #faf7f2; --text: #2c2418; --accent: #c4a574; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    header { padding: 1.5rem 1.25rem; text-align: center; border-bottom: 1px solid #e5ddd0; background: #fff; }
    h1 { font-size: 1.65rem; font-weight: 400; letter-spacing: 0.02em; margin: 0; }
    .tag { font-size: 0.85rem; color: #7a6e5e; margin-top: 0.35rem; }
    main { max-width: 34rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    p { margin: 0 0 1rem; }
    .card { background: #fff; border-radius: 12px; padding: 1.25rem 1.35rem; box-shadow: 0 8px 28px rgba(44,36,24,.06); border: 1px solid #ebe4d9; }
    footer { text-align: center; font-size: 0.8rem; color: #9a8f82; padding: 1.5rem; }
  </style>
</head>
<body>
  <header>
    <h1>ДомКомфорт</h1>
    <div class="tag">Подушки, одеяла, наволочки — мягкий сон без лишнего шума</div>
  </header>
  <main>
    <div class="card">
      <p>Мы подбираем наполнители и ткани так, чтобы вам было удобно читать, отдыхать и засыпать в тишине своей спальни.</p>
      <p>Скоро здесь появится каталог: ортопедические и декоративные подушки, комплекты постельного белья, пледы.</p>
      <p>Оставайтесь на связи — готовим для вас уютную коллекцию.</p>
    </div>
  </main>
  <footer>© ДомКомфорт · доставка по России</footer>
</body>
</html>`;
