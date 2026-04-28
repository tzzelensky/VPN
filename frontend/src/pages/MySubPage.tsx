import { useEffect, useMemo, useState } from "react";
import { claimMySubReferralReward, loadMySubWebAppProfile, sendMySubPaymentProof, type MySubProfileDto } from "../api";

type Tab = "home" | "subscription" | "friends" | "profile";

function NavIcon({ tab }: { tab: Tab }) {
  if (tab === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.8v-5.5h-4.4V21H5a1 1 0 0 1-1-1z" />
      </svg>
    );
  }
  if (tab === "subscription") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2.4" ry="2.4" />
        <path d="M3 10.5h18" />
      </svg>
    );
  }
  if (tab === "friends") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="8" cy="8" r="3.2" />
        <circle cx="16.5" cy="9" r="2.7" />
        <path d="M3.7 19.3c0-2.8 2.4-4.9 5.3-4.9s5.3 2.1 5.3 4.9" />
        <path d="M13.2 19.3c.2-2.1 1.9-3.7 4.1-3.7 2.3 0 4.2 1.7 4.2 3.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.2 2.8-5.6 7-5.6s7 2.4 7 5.6" />
    </svg>
  );
}

export default function MySubPage() {
  const [data, setData] = useState<MySubProfileDto | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [pickedSubId, setPickedSubId] = useState<number>(0);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [showInstruction, setShowInstruction] = useState(false);
  const [showPickModal, setShowPickModal] = useState(false);
  const [pickTarget, setPickTarget] = useState<"copy" | "pay">("copy");
  const [payPlanId, setPayPlanId] = useState<number>(1);
  const [payPhoto, setPayPhoto] = useState<File | null>(null);
  const [busyPay, setBusyPay] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [profileSubModalId, setProfileSubModalId] = useState<number>(0);
  const [homeSubId, setHomeSubId] = useState<number>(0);
  const [friendRewardId, setFriendRewardId] = useState("");
  const [friendRewardBusy, setFriendRewardBusy] = useState(false);

  function getInitData(): string {
    const tgWebApp = (window as unknown as {
      Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
    }).Telegram?.WebApp;
    const direct = String(tgWebApp?.initData ?? "").trim();
    if (direct) return direct;
    const fromHash = new URLSearchParams(String(window.location.hash ?? "").replace(/^#/, "")).get("tgWebAppData");
    if (fromHash) return decodeURIComponent(fromHash);
    const fromQuery = new URLSearchParams(window.location.search).get("tgWebAppData");
    if (fromQuery) return decodeURIComponent(fromQuery);
    return "";
  }

  useEffect(() => {
    void (async () => {
      setErr("");
      const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
      const initData = getInitData();
      if (!initData) {
        setErr("Требуется авторизация через тг.");
        return;
      }
      tgWebApp?.ready?.();
      tgWebApp?.expand?.();
      try {
        const profile = await loadMySubWebAppProfile(initData);
        setData(profile);
        if (profile.subscriptions.length > 0) {
          setPickedSubId(profile.subscriptions[0]!.id);
          setHomeSubId(profile.subscriptions[0]!.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("tg_webapp_auth_required")) setErr("Требуется авторизация через тг.");
        else setErr(msg);
      }
    })();
  }, []);
  useEffect(() => {
    setMsg("");
  }, [tab]);

  const pickedSub = useMemo(() => {
    if (!data) return null;
    return data.subscriptions.find((s) => s.id === pickedSubId) ?? null;
  }, [data, pickedSubId]);
  const homeSub = useMemo(() => {
    if (!data) return null;
    const targetId = homeSubId > 0 ? homeSubId : pickedSubId;
    return data.subscriptions.find((s) => s.id === targetId) ?? null;
  }, [data, homeSubId, pickedSubId]);
  const initData = useMemo(() => {
    return getInitData();
  }, []);

  async function copySubscription(url: string) {
    setMsg("");
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Ссылка скопирована.");
    } catch {
      setMsg("Не удалось скопировать автоматически. Скопируйте вручную.");
    }
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Не удалось прочитать фото"));
      r.onload = () => resolve(String(r.result ?? ""));
      r.readAsDataURL(file);
    });
  }

  async function compressImage(file: File): Promise<{ base64: string; mime: string; name: string }> {
    if (!file.type.startsWith("image/")) {
      return { base64: await fileToDataUrl(file), mime: file.type || "application/octet-stream", name: file.name || "file.bin" };
    }
    const imageBitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(imageBitmap.width, imageBitmap.height));
    const w = Math.max(1, Math.round(imageBitmap.width * scale));
    const h = Math.max(1, Math.round(imageBitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось обработать фото.");
    ctx.drawImage(imageBitmap, 0, 0, w, h);
    imageBitmap.close();
    const base64 = canvas.toDataURL("image/jpeg", 0.72);
    return { base64, mime: "image/jpeg", name: "proof.jpg" };
  }

  async function submitPaymentProof() {
    if (!data || !payPhoto) {
      setMsg("Выберите тариф и фото чека.");
      return;
    }
    if (data.subscriptions.length > 0 && !pickedSub) {
      setMsg("Выберите подписку.");
      return;
    }
    if (data.subscriptions.length === 0 && !newSubName.trim()) {
      setMsg("Введите название новой подписки.");
      return;
    }
    setBusyPay(true);
    setMsg("");
    try {
      const compressed = await compressImage(payPhoto);
      await sendMySubPaymentProof({
        init_data: initData,
        user_id: pickedSub?.id,
        plan_id: payPlanId,
        photo_base64: compressed.base64,
        photo_mime: compressed.mime,
        photo_name: compressed.name,
        new_subscription_name: data.subscriptions.length === 0 ? newSubName.trim().slice(0, 25) : undefined,
      });
      setMsg("Чек получен. Администратор проверит оплату и примет решение. Обычно это занимает немного времени. После подтверждения подписка придет в чат");
      setPayPhoto(null);
      if (data.subscriptions.length === 0) setNewSubName("");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("tg_webapp_auth_required")) setErr("Требуется авторизация через тг.");
      else setMsg(m);
    } finally {
      setBusyPay(false);
    }
  }

  function openPick(which: "copy" | "pay") {
    if (!data) return;
    setPickTarget(which);
    if (pickedSubId <= 0 && data.subscriptions[0]) setPickedSubId(data.subscriptions[0].id);
    if (data.subscriptions.length <= 1) {
      setPickedSubId(data.subscriptions[0]?.id ?? 0);
      if (which === "pay") setTab("subscription");
      return;
    }
    setShowPickModal(true);
  }

  function shareReferralInTelegram() {
    if (!data?.referral?.invite_link) {
      setMsg("Реферальная ссылка недоступна.");
      return;
    }
    const text = data.referral.invite_copy_text || "Присоединяйся по моей ссылке!";
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.referral.invite_link)}&text=${encodeURIComponent(text)}`;
    const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  function openSupportProfile() {
    const url = "https://t.me/hsnvps";
    const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }).Telegram?.WebApp;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function claimFriendReward(kind: "gb" | "days") {
    if (!friendRewardId) return;
    if (kind === "gb" && (data?.subscriptions ?? []).some((s) => s.total_gb <= 0)) {
      const text = "У вас безлимит. Можно выбрать только награду в днях.";
      setMsg(text);
      const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { showAlert?: (msg: string) => void } } }).Telegram?.WebApp;
      tgWebApp?.showAlert?.(text);
      return;
    }
    setFriendRewardBusy(true);
    try {
      await claimMySubReferralReward({ init_data: initData, reward_id: friendRewardId, kind });
      setMsg(kind === "gb" ? "Награда +ГБ успешно применена." : "Награда +дни успешно применена.");
      setFriendRewardId("");
      const profile = await loadMySubWebAppProfile(initData);
      setData(profile);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("inviter_unlimited_choose_days")) {
        const text = "У вас безлимит. Можно выбрать только награду в днях.";
        setMsg(text);
        const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { showAlert?: (msg: string) => void } } }).Telegram?.WebApp;
        tgWebApp?.showAlert?.(text);
      } else {
        setMsg("Не удалось применить награду. Попробуйте еще раз.");
      }
    } finally {
      setFriendRewardBusy(false);
    }
  }

  return (
    <div className="mysub-wrap">
      <div className="mysub-card">
        {err ? <div className="flash err">{err}</div> : null}
        {!err && !data ? <div className="sub">Загрузка…</div> : null}
        {data ? (
          <>
            <div className="mysub-head">
              {data.avatar_url ? (
                <img src={data.avatar_url} alt="avatar" className="mysub-avatar" />
              ) : (
                <div className="mysub-avatar-fallback">{(data.name || "U").trim().slice(0, 1).toUpperCase()}</div>
              )}
              <h1 className="mysub-name">{data.name}</h1>
            </div>

            {tab === "home" ? (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Подключитесь за минуту</h3>
                <p className="sub">Быстрый и надежный VPN для стабильного подключения.</p>
                <div className="mysub-sub-box">
                  {data.subscriptions.length > 1 ? (
                    <div className="form-field">
                      <label>Выберите подписку</label>
                      <select
                        value={homeSub?.id ? String(homeSub.id) : ""}
                        onChange={(e) => {
                          const id = Number(e.target.value) || 0;
                          setHomeSubId(id);
                          setPickedSubId(id);
                        }}
                      >
                        {data.subscriptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            #{s.id} {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <p className="sub" style={{ marginBottom: "0.4rem" }}>
                    {homeSub ? `Конфиг: #${homeSub.id} ${homeSub.name}` : "Выберите подписку"}
                  </p>
                  <div className="mysub-url">{homeSub?.subscription_url || "Нажмите кнопку «Скопировать конфиг»"}</div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={!homeSub}
                      onClick={() => {
                        if (!homeSub || (data.subscriptions.length > 1 && !showPickModal)) {
                          openPick("copy");
                          return;
                        }
                        void copySubscription(homeSub.subscription_url);
                      }}
                    >
                      Скопировать конфиг
                    </button>
                    {data.subscriptions.length === 1 ? (
                      <button type="button" className="ghost" onClick={() => setTab("subscription")}>
                        Купить еще подписку
                      </button>
                    ) : null}
                    <button type="button" className="ghost" onClick={() => setShowInstruction(true)}>
                      Инструкция
                    </button>
                  </div>
                </div>
              </section>
            ) : tab === "subscription" ? (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Подписка</h3>
                {data.subscriptions.length === 0 ? (
                  <div className="mysub-sub-box">
                    <p className="sub" style={{ marginBottom: "0.5rem" }}>
                      У вас пока нет подписок. Выберите тариф и отправьте чек, после подтверждения администратором создадим подписку.
                    </p>
                    <div className="form-field">
                      <label>Название новой подписки</label>
                      <input
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value.slice(0, 25))}
                        placeholder='Например: "Для мамы"'
                      />
                    </div>
                    <div className="form-field">
                      <label>Тариф</label>
                      <select value={payPlanId} onChange={(e) => setPayPlanId(Number(e.target.value) || 1)}>
                        {data.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            Тариф {p.id}: {p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит"} / {p.days} дн. / {p.price_rub} ₽
                          </option>
                        ))}
                      </select>
                      <a className="mysub-pay-link-btn" href={data.payment_url} target="_blank" rel="noreferrer">
                        Оплатить по ссылке
                      </a>
                    </div>
                    <div className="form-field">
                      <label>Фото чека</label>
                      <label className="mysub-file-btn">
                        <input
                          className="mysub-file-input"
                          type="file"
                          accept="image/*"
                          onChange={(e) => setPayPhoto(e.target.files?.[0] ?? null)}
                        />
                        Выберите файл
                      </label>
                      <p className="field-hint">{payPhoto ? `Выбрано: ${payPhoto.name}` : "Фото не выбрано."}</p>
                    </div>
                    <button type="button" className="primary" disabled={busyPay} onClick={() => void submitPaymentProof()}>
                      {busyPay ? "Отправка..." : "Подтвердить оплату"}
                    </button>
                  </div>
                ) : null}
                {data.subscriptions.length > 1 ? (
                  <div className="form-field">
                    <label>Выберите подписку</label>
                    <select
                      value={pickedSubId > 0 ? String(pickedSubId) : ""}
                      onChange={(e) => setPickedSubId(Number(e.target.value) || 0)}
                    >
                      <option value="">Выберите</option>
                      {data.subscriptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {pickedSub ? (
                  <div className="mysub-sub-box">
                    <p className="sub" style={{ marginBottom: "0.55rem" }}>
                      #{pickedSub.id} {pickedSub.name} {pickedSub.allowed ? "• активна" : "• ограничена"}
                    </p>
                    <div className="mysub-stat-list">
                      <div>Использовано: {pickedSub.used_text}</div>
                      <div>Лимит: {pickedSub.total_text}</div>
                      <div>
                        Осталось:{" "}
                        {pickedSub.total_gb > 0
                          ? `${Math.max(
                              0,
                              pickedSub.total_gb -
                                Math.floor((pickedSub.traffic_up + pickedSub.traffic_down) / (1024 * 1024 * 1024) * 100) / 100,
                            ).toFixed(2)} ГБ`
                          : "∞"}
                      </div>
                      <div>
                        Срок:{" "}
                        {pickedSub.expiry_time > 0
                          ? new Date(pickedSub.expiry_time).toLocaleDateString("ru-RU")
                          : "без срока"}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          if (data.subscriptions.length > 1) openPick("copy");
                          else void copySubscription(pickedSub.subscription_url);
                        }}
                      >
                        Копировать подписку
                      </button>
                    </div>
                    <hr style={{ borderColor: "var(--border)", opacity: 0.45, margin: "0.8rem 0" }} />
                    <div className="form-field">
                      <label>Тариф для оплаты</label>
                      <select value={payPlanId} onChange={(e) => setPayPlanId(Number(e.target.value) || 1)}>
                        {data.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            Тариф {p.id}: {p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит"} / {p.days} дн. / {p.price_rub} ₽
                          </option>
                        ))}
                      </select>
                      <p className="field-hint" style={{ marginTop: "0.45rem" }}>
                        1) Нажмите кнопку оплаты ниже.
                        <br />
                        2) В комментарии укажите номер тарифа.
                        <br />
                        3) Прикрепите фото чека ниже.
                      </p>
                      <a className="mysub-pay-link-btn" href={data.payment_url} target="_blank" rel="noreferrer">
                        Оплатить по ссылке
                      </a>
                    </div>
                    <div className="form-field">
                      <label>Фото чека</label>
                      <label className="mysub-file-btn">
                        <input
                          className="mysub-file-input"
                          type="file"
                          accept="image/*"
                          onChange={(e) => setPayPhoto(e.target.files?.[0] ?? null)}
                        />
                        Выберите файл
                      </label>
                      <p className="field-hint">{payPhoto ? `Выбрано: ${payPhoto.name}` : "Фото не выбрано."}</p>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busyPay}
                        onClick={() => {
                          if (data.subscriptions.length > 1 && !pickedSub) {
                            openPick("pay");
                            return;
                          }
                          void submitPaymentProof();
                        }}
                      >
                        {busyPay ? "Отправка..." : "Подтвердить оплату"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="sub">Выберите подписку, чтобы открыть ссылку.</p>
                )}
              </section>
            ) : tab === "friends" ? (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Друзья</h3>
                {data.referral?.enabled ? (
                  <>
                    <div className="mysub-sub-box">
                      <p style={{ margin: 0, fontWeight: 700 }}>Приглашайте друзей</p>
                      <p className="sub" style={{ marginTop: "0.35rem" }}>
                        Отправьте ссылку другу. Когда он откроет приложение, вам начислится награда.
                      </p>
                      <div className="mysub-url">{data.referral.invite_link || "Реферальная ссылка недоступна"}</div>
                      <div className="row-actions">
                        <button type="button" className="primary" disabled={!data.referral.invite_link} onClick={shareReferralInTelegram}>
                          Отправить в Telegram
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={!data.referral.invite_link}
                          onClick={() => {
                            if (data.referral.invite_link) void copySubscription(data.referral.invite_link);
                          }}
                        >
                          Скопировать ссылку
                        </button>
                      </div>
                    </div>
                    <div className="mysub-sub-box" style={{ marginTop: "0.65rem" }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>Приглашенные друзья</p>
                      <div className="mysub-stat-list" style={{ marginTop: "0.55rem" }}>
                        {data.referral.invited_friends.length === 0 ? (
                          <div>Пока никого не приглашено.</div>
                        ) : (
                          data.referral.invited_friends.map((f, idx) => (
                            <div key={`${f.tg_user_id}-${idx}`} className="mysub-friend-row">
                              <span>
                                {f.name} • {new Date(f.created_at).toLocaleDateString("ru-RU")} •{" "}
                                {f.status === "claimed" ? "награда выдана" : "ожидает награду"}
                              </span>
                              {f.status === "pending" ? (
                                <button type="button" className="mysub-gift-btn" onClick={() => setFriendRewardId(f.reward_id)}>
                                  🎁
                                </button>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="sub">Реферальная программа временно отключена.</p>
                )}
              </section>
            ) : (
              <section className="mysub-section mysub-section-anim">
                <h3 className="mysub-title">Профиль</h3>
                <div className="mysub-sub-box">
                  <p style={{ margin: 0, fontWeight: 600 }}>{data.name}</p>
                  <p className="sub" style={{ marginTop: "0.35rem" }}>Список подписок:</p>
                  <div className="mysub-stat-list">
                    {data.subscriptions.length === 0 ? (
                      <div>Подписок пока нет.</div>
                    ) : (
                      data.subscriptions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={pickedSubId === s.id ? "primary" : "ghost"}
                          onClick={() => {
                            setProfileSubModalId(s.id);
                          }}
                        >
                          #{s.id} {s.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="row-actions" style={{ marginTop: "0.75rem" }}>
                  <button type="button" className="ghost" onClick={openSupportProfile}>
                    Поддержка
                  </button>
                </div>
              </section>
            )}

            {msg ? <div className="flash ok">{msg}</div> : null}
            <div className="mysub-bottom-actions">
              {([
                ["home", "Главная"],
                ["subscription", "Подписка"],
                ["friends", "Друзья"],
                ["profile", "Профиль"],
              ] as Array<[Tab, string]>).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`mysub-nav-btn ${tab === t ? "active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  <NavIcon tab={t} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {showInstruction ? (
        <div className="modal-backdrop" onClick={() => setShowInstruction(false)}>
          <div className="modal mysub-modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Инструкция</h2>
              <button type="button" className="ghost modal-close" onClick={() => setShowInstruction(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="mysub-sub-box">
                <p><b>1. Установите приложение</b></p>
                <p className="sub">Скачайте одно из приложений: <b>Happ</b>, <b>V2rayTun</b> или <b>V2rayBox</b>.</p>
              </div>
              <div className="mysub-sub-box" style={{ marginTop: "0.7rem" }}>
                <p><b>2. Подключение</b></p>
                <ol style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)" }}>
                  <li>Скопируйте конфиг в кабинете.</li>
                  <li>Откройте приложение.</li>
                  <li>Импортируйте конфиг из буфера.</li>
                  <li>Нажмите подключить.</li>
                </ol>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setShowInstruction(false)}>
                Понятно
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showPickModal && data ? (
        <div className="modal-backdrop" onClick={() => setShowPickModal(false)}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Выбор подписки</h2>
              <button type="button" className="ghost modal-close" onClick={() => setShowPickModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="mysub-stat-list">
                {data.subscriptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={pickedSubId === s.id ? "primary" : "ghost"}
                    onClick={() => setPickedSubId(s.id)}
                  >
                    #{s.id} {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="ghost" onClick={() => setShowPickModal(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const selected = data.subscriptions.find((s) => s.id === pickedSubId) ?? data.subscriptions[0];
                  setShowPickModal(false);
                  if (!selected) return;
                  setPickedSubId(selected.id);
                  if (pickTarget === "copy") void copySubscription(selected.subscription_url);
                  else setTab("subscription");
                }}
              >
                Выбрать
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {profileSubModalId > 0 && data ? (
        <div className="modal-backdrop" onClick={() => setProfileSubModalId(0)}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Подписка</h2>
              <button type="button" className="ghost modal-close" onClick={() => setProfileSubModalId(0)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {(() => {
                const s = data.subscriptions.find((x) => x.id === profileSubModalId);
                if (!s) return <p className="sub">Подписка не найдена.</p>;
                return (
                  <div className="mysub-stat-list">
                    <div><b>#{s.id} {s.name}</b></div>
                    <div>Использовано: {s.used_text}</div>
                    <div>Лимит: {s.total_text}</div>
                    <div>
                      Осталось:{" "}
                      {s.total_gb > 0
                        ? `${Math.max(0, s.total_gb - Math.floor((s.traffic_up + s.traffic_down) / (1024 * 1024 * 1024) * 100) / 100).toFixed(2)} ГБ`
                        : "∞"}
                    </div>
                    <div>Срок: {s.expiry_time > 0 ? new Date(s.expiry_time).toLocaleDateString("ru-RU") : "без срока"}</div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const s = data.subscriptions.find((x) => x.id === profileSubModalId);
                  if (!s) return;
                  void copySubscription(s.subscription_url);
                }}
              >
                Скопировать ссылку подписки
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {friendRewardId ? (
        <div className="modal-backdrop" onClick={() => setFriendRewardId("")}>
          <div className="modal mysub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Выбор награды</h2>
              <button type="button" className="ghost modal-close" onClick={() => setFriendRewardId("")}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="sub" style={{ marginBottom: "0.5rem" }}>
                Выберите, какую награду применить к вашей подписке.
              </p>
              <div className="row-actions">
                <button type="button" className="primary" disabled={friendRewardBusy} onClick={() => void claimFriendReward("gb")}>
                  Получить ГБ
                </button>
                <button type="button" className="ghost" disabled={friendRewardBusy} onClick={() => void claimFriendReward("days")}>
                  Получить дни
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
