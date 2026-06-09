import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import DualListPicker, { type DualListItem } from "../components/DualListPicker";
import {
  bulkAssignWhitelistVaultKeys,
  bulkDeleteWhitelistVaultKeys,
  bulkRenameWhitelistVaultKeys,
  checkAllWhitelistVaultKeys,
  checkWhitelistVaultKey,
  createWhitelistVaultKey,
  deleteWhitelistVaultKey,
  fetchWhitelistVaultKeyRaw,
  importWhitelistVaultJson,
  importWhitelistVaultKeys,
  listUsers,
  listWhitelistVaultChecks,
  loadWhitelistVault,
  patchWhitelistInstructionSettings,
  patchWhitelistPurchaseSettings,
  pollUntilVaultChecksDone,
  patchWhitelistVaultSettings,
  listWhitelistPurchases,
  uploadWhitelistInstructionPhoto,
  deleteWhitelistInstructionPhoto,
  testWhitelistInstruction,
  setWhitelistVaultAssignment,
  updateWhitelistVaultKey,
  type ConfigVaultCheckDto,
  type UserDto,
  type WhitelistAssignmentModeDto,
  type WhitelistVaultKeyDto,
  type WhitelistVaultOverviewDto,
  type WhitelistVaultSettingsDto,
  type WhitelistPurchaseRowDto,
  type VlessCheckStatusDto,
} from "../api";
import { usePanelSettings } from "../panelSettingsContext";

const STATUS_LABEL: Record<VlessCheckStatusDto, string> = {
  available: "Доступен",
  unavailable: "Недоступен",
  unstable: "Нестабильно",
  never: "Не проверялся",
  checking: "Проверяется",
};

type FilterKey = "all" | "assigned" | "unassigned" | "available" | "unavailable" | "unstable" | "never";

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function parseErr(e: unknown): string {
  if (e instanceof Error) {
    try {
      const j = JSON.parse(e.message) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* ignore */
    }
    return e.message;
  }
  return String(e);
}

export default function WhitelistVaultPage({ onLogout }: { onLogout: () => void }) {
  const { confirmDangerous, maskSecret } = usePanelSettings();
  const [data, setData] = useState<WhitelistVaultOverviewDto | null>(null);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<"new" | "old" | "status" | "last_check">("new");

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");

  const [viewKey, setViewKey] = useState<WhitelistVaultKeyDto | null>(null);
  const [viewFullUri, setViewFullUri] = useState(false);
  const [viewRawUri, setViewRawUri] = useState<string | null>(null);

  const [editKey, setEditKey] = useState<WhitelistVaultKeyDto | null>(null);
  const [assignKey, setAssignKey] = useState<WhitelistVaultKeyDto | null>(null);
  const [historyKey, setHistoryKey] = useState<WhitelistVaultKeyDto | null>(null);
  const [history, setHistory] = useState<ConfigVaultCheckDto[]>([]);
  const [historyFilter, setHistoryFilter] = useState<{ status: string; triggered: string }>({
    status: "",
    triggered: "",
  });

  const [formName, setFormName] = useState("");
  const [formUri, setFormUri] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formIncludeInSale, setFormIncludeInSale] = useState(false);
  const [formNotify, setFormNotify] = useState(true);
  const [importText, setImportText] = useState("");
  const [importPrefix, setImportPrefix] = useState("");
  const [pageTab, setPageTab] = useState<"keys" | "purchase" | "instruction" | "history">("keys");
  const [purchases, setPurchases] = useState<WhitelistPurchaseRowDto[]>([]);
  const [purchaseForm, setPurchaseForm] = useState<WhitelistVaultSettingsDto["purchase"] | null>(null);
  const [instructionForm, setInstructionForm] = useState<WhitelistVaultSettingsDto["instruction"] | null>(null);
  const [testAdminChatId, setTestAdminChatId] = useState("");
  const [settingsForm, setSettingsForm] = useState<WhitelistVaultSettingsDto | null>(null);
  const [formAssignment, setFormAssignment] = useState<WhitelistAssignmentModeDto>("none");
  const [formUserIds, setFormUserIds] = useState<number[]>([]);
  const [selectedKeyIds, setSelectedKeyIds] = useState<number[]>([]);
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [bulkRemark, setBulkRemark] = useState("");
  const [usersPickerOpen, setUsersPickerOpen] = useState(false);
  const [usersPickerTitle, setUsersPickerTitle] = useState("Кому назначить белые списки");
  const [usersPickerPurpose, setUsersPickerPurpose] = useState<null | "form" | "assign-one" | "assign-bulk">(null);

  const showToast = useCallback((type: "ok" | "err", text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const reload = useCallback(async () => {
    const r = await loadWhitelistVault();
    setData(r);
    setPurchaseForm(r.settings.purchase);
    setInstructionForm(r.settings.instruction);
    return r;
  }, []);

  useEffect(() => {
    void reload().catch((e) => showToast("err", parseErr(e)));
    void listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [reload, showToast]);

  const keys = useMemo(() => {
    const list = data?.keys ?? [];
    const q = search.trim().toLowerCase();
    let out = list.filter((k) => {
      if (!q) return true;
      return k.name.toLowerCase().includes(q) || k.masked_uri.toLowerCase().includes(q);
    });
    if (filter === "assigned") out = out.filter((k) => (k.assigned_users_count ?? 0) > 0);
    else if (filter === "unassigned") out = out.filter((k) => (k.assigned_users_count ?? 0) === 0);
    else if (filter === "available") out = out.filter((k) => k.last_check_status === "available");
    else if (filter === "unavailable") out = out.filter((k) => k.last_check_status === "unavailable");
    else if (filter === "unstable") out = out.filter((k) => k.last_check_status === "unstable");
    else if (filter === "never") out = out.filter((k) => k.last_check_status === "never");
    const statusOrder: Record<VlessCheckStatusDto, number> = {
      unavailable: 0,
      unstable: 1,
      checking: 2,
      never: 3,
      available: 4,
    };
    out = [...out].sort((a, b) => {
      if (sortBy === "old") return a.id - b.id;
      if (sortBy === "status") return statusOrder[a.last_check_status] - statusOrder[b.last_check_status];
      if (sortBy === "last_check") {
        const ta = a.last_check_at ? Date.parse(a.last_check_at) : 0;
        const tb = b.last_check_at ? Date.parse(b.last_check_at) : 0;
        return tb - ta;
      }
      return b.id - a.id;
    });
    return out;
  }, [data?.keys, search, filter, sortBy]);

  async function runBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      showToast("err", parseErr(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function openView(k: WhitelistVaultKeyDto) {
    setViewKey(k);
    setViewFullUri(false);
    setViewRawUri(k.raw_uri ?? null);
    if (!k.raw_uri) {
      const r = await runBusy(() => fetchWhitelistVaultKeyRaw(k.id));
      if (r?.key.raw_uri) setViewRawUri(r.key.raw_uri);
    }
  }

  async function openEdit(k: WhitelistVaultKeyDto, prefilledUri?: string | null) {
    setEditKey(k);
    setFormName(k.name);
    setFormActive(k.active);
    setFormIncludeInSale(!!k.include_in_sale);
    setFormNotify(k.notify_on_fail);
    setFormAssignment(k.assignment_mode);
    setFormUserIds(k.assigned_user_ids ?? []);
    const uri = (prefilledUri ?? k.raw_uri ?? "").trim();
    if (uri) {
      setFormUri(uri);
      return;
    }
    setFormUri("");
    const r = await runBusy(() => fetchWhitelistVaultKeyRaw(k.id));
    if (r?.key.raw_uri) setFormUri(r.key.raw_uri);
  }

  const purchasedUserIds = useMemo(
    () => users.filter((u) => u.whitelist_purchased).map((u) => u.id),
    [users],
  );

  const whitelistUserPickerItems = useMemo((): DualListItem[] => {
    return users.map((u) => {
      const title = (u.name || u.email || `Клиент #${u.id}`).trim();
      const bought = u.whitelist_purchased ? " (куплено)" : "";
      return { id: u.id, label: `#${u.id} ${title}${bought}` };
    });
  }, [users]);

  function openUsersPicker(title: string, purpose: "form" | "assign-one" | "assign-bulk", ids: number[]) {
    setUsersPickerTitle(title);
    setUsersPickerPurpose(purpose);
    setFormUserIds(ids);
    setFormAssignment("selected");
    setUsersPickerOpen(true);
  }

  async function openAssign(k: WhitelistVaultKeyDto) {
    setAssignKey(k);
    if (k.assignment_mode === "all" || k.assignment_mode === "none") {
      setFormAssignment(k.assignment_mode);
      setFormUserIds([]);
      return;
    }
    let ids = k.assigned_user_ids ?? [];
    if (ids.length === 0 && (k.assigned_users_count ?? 0) > 0) {
      try {
        const { key } = await fetchWhitelistVaultKeyRaw(k.id);
        ids = key.assigned_user_ids ?? [];
      } catch {
        /* список ключей после обновления API уже содержит ids */
      }
    }
    openUsersPicker(`Кому назначить: ${k.name}`, "assign-one", ids);
  }

  async function handleUsersPickerSave(ids: number[]) {
    setFormUserIds(ids);
    setFormAssignment("selected");
    setUsersPickerOpen(false);
    const purpose = usersPickerPurpose;
    setUsersPickerPurpose(null);

    if (purpose === "assign-one" && assignKey) {
      await runBusy(async () => {
        await setWhitelistVaultAssignment(assignKey.id, "selected", ids);
        await reload();
        setAssignKey(null);
        showToast("ok", "Назначение сохранено");
      });
      return;
    }

    if (purpose === "assign-bulk") {
      if (selectedKeyIds.length === 0) return;
      await runBusy(async () => {
        const r = await bulkAssignWhitelistVaultKeys({
          ids: selectedKeyIds,
          assignment_mode: "selected",
          assigned_user_ids: ids,
        });
        await reload();
        clearKeySelection();
        showToast(
          "ok",
          `Назначено ключей: ${r.updated}${r.errors.length ? `, ошибок: ${r.errors.length}` : ""}`,
        );
      });
    }
  }

  async function openHistory(k: WhitelistVaultKeyDto) {
    setHistoryKey(k);
    setHistoryFilter({ status: "", triggered: "" });
    const r = await runBusy(() => listWhitelistVaultChecks(k.id, { limit: 50 }));
    if (r) setHistory(r.checks);
  }

  async function reloadHistory() {
    if (!historyKey) return;
    const r = await runBusy(() =>
      listWhitelistVaultChecks(historyKey.id, {
        limit: 50,
        status: historyFilter.status || undefined,
        triggered_by: historyFilter.triggered || undefined,
      }),
    );
    if (r) setHistory(r.checks);
  }

  async function handleCreate() {
    await runBusy(async () => {
      await createWhitelistVaultKey({
        name: formName,
        raw_uri: formUri,
        active: formActive,
        include_in_sale: formIncludeInSale,
        notify_on_fail: formNotify,
        assignment_mode: formAssignment,
        assigned_user_ids: formAssignment === "selected" ? formUserIds : [],
      });
      await reload();
      setAddOpen(false);
      setFormName("");
      setFormUri("");
      setFormAssignment("none");
      setFormUserIds([]);
      showToast("ok", "VLESS-ключ белого списка добавлен");
    });
  }

  async function handleImport() {
    await runBusy(async () => {
      const r = await importWhitelistVaultKeys({
        text: importText,
        name_prefix: importPrefix,
        active: formActive,
        include_in_sale: formIncludeInSale,
        notify_on_fail: formNotify,
        assignment_mode: formAssignment,
        assigned_user_ids: formAssignment === "selected" ? formUserIds : [],
      });
      setData((d) => (d ? { ...d, keys: r.keys } : d));
      setImportOpen(false);
      setImportText("");
      showToast(
        "ok",
        `Импорт: добавлено ${r.added}, дублей ${r.skipped_duplicates}, ошибок ${r.errors.length}`,
      );
    });
  }

  async function handleJsonImport() {
    await runBusy(async () => {
      const r = await importWhitelistVaultJson({
        json: jsonText,
        name: formName || undefined,
        active: formActive,
        include_in_sale: formIncludeInSale,
        notify_on_fail: formNotify,
        assignment_mode: formAssignment,
        assigned_user_ids: formAssignment === "selected" ? formUserIds : [],
      });
      await reload();
      setJsonImportOpen(false);
      setJsonText("");
      setFormName("");
      showToast("ok", `Импортировано ключей: ${r.added ?? 1}`);
    });
  }

  async function handleSaveEdit() {
    if (!editKey) return;
    await runBusy(async () => {
      await updateWhitelistVaultKey(editKey.id, {
        name: formName,
        raw_uri: formUri,
        active: formActive,
        include_in_sale: formIncludeInSale,
        notify_on_fail: formNotify,
        assignment_mode: formAssignment,
        assigned_user_ids: formAssignment === "selected" ? formUserIds : [],
      });
      await reload();
      setEditKey(null);
      showToast("ok", "VLESS-ключ обновлен");
    });
  }

  function toggleKeySelected(id: number) {
    setSelectedKeyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function clearKeySelection() {
    setSelectedKeyIds([]);
  }

  function selectAllVaultKeys() {
    const ids = (data?.keys ?? []).map((k) => k.id);
    setSelectedKeyIds(ids);
  }

  const allVaultSelected =
    (data?.keys?.length ?? 0) > 0 && selectedKeyIds.length === (data?.keys?.length ?? 0);

  async function handleBulkDelete() {
    if (selectedKeyIds.length === 0) return;
    const n = selectedKeyIds.length;
    const msg = `Удалить выбранные ключи (${n})? Они исчезнут из подписок всех пользователей.`;
    if (!confirmDangerous(msg)) return;
    await runBusy(async () => {
      const r = await bulkDeleteWhitelistVaultKeys({ ids: selectedKeyIds });
      await reload();
      clearKeySelection();
      setViewKey(null);
      showToast("ok", `Удалено ключей: ${r.deleted}`);
    });
  }

  async function handleDeleteAllKeys() {
    const total = data?.keys?.length ?? 0;
    if (total === 0) return;
    const msg = `Удалить все ключи белых списков (${total})? Они будут убраны из подписок всех пользователей.`;
    if (!confirmDangerous(msg)) return;
    await runBusy(async () => {
      const r = await bulkDeleteWhitelistVaultKeys({ delete_all: true });
      await reload();
      clearKeySelection();
      setViewKey(null);
      showToast("ok", `Удалено ключей: ${r.deleted}`);
    });
  }

  async function handleBulkRename() {
    if (selectedKeyIds.length === 0) return;
    await runBusy(async () => {
      const r = await bulkRenameWhitelistVaultKeys({ ids: selectedKeyIds, remark: bulkRemark });
      await reload();
      setBulkRenameOpen(false);
      setBulkRemark("");
      clearKeySelection();
      showToast(
        "ok",
        `Переименовано: ${r.updated}${r.errors.length ? `, ошибок: ${r.errors.length}` : ""}`,
      );
    });
  }

  async function handleDelete(k: WhitelistVaultKeyDto) {
    const msg = `Удалить VLESS-ключ «${k.name}»?`;
    if (!confirmDangerous(msg)) return;
    await runBusy(async () => {
      await deleteWhitelistVaultKey(k.id);
      await reload();
      if (viewKey?.id === k.id) setViewKey(null);
      showToast("ok", "VLESS-ключ удален");
    });
  }

  async function checkOne(k: WhitelistVaultKeyDto) {
    await runBusy(async () => {
      const r = await checkWhitelistVaultKey(k.id);
      await reload();
      if (viewKey?.id === k.id) setViewKey(r.key);
      showToast("ok", `Проверка: ${STATUS_LABEL[r.key.last_check_status] ?? r.key.last_check_status}`);
    });
  }

  function copyUri(uri: string) {
    if (!confirmDangerous("Ссылка содержит рабочий ключ доступа. Не передавайте ее посторонним.")) return;
    void navigator.clipboard.writeText(uri).then(
      () => showToast("ok", "Ключ скопирован"),
      () => showToast("err", "Не удалось скопировать"),
    );
  }

  function revealFull() {
    if (!confirmDangerous("Ссылка содержит рабочий ключ доступа. Не показывайте ее посторонним.")) return;
    setViewFullUri(true);
  }

  const stats = data?.stats;

  function renderAssignmentFields() {
    const assignedCount = formUserIds.length;
    const pickedPurchased = formUserIds.filter((id) => purchasedUserIds.includes(id)).length;
    return (
      <>
        <label className="field">
          <span>Кому назначить</span>
          <select
            className="input"
            value={formAssignment}
            onChange={(e) => {
              const mode = e.target.value as WhitelistAssignmentModeDto;
              setFormAssignment(mode);
              if (mode === "selected") {
                openUsersPicker("Кому назначить белые списки", "form", formUserIds);
              } else {
                setFormUserIds([]);
              }
            }}
          >
            <option value="none">Никому</option>
            <option value="all">Всем пользователям (с режимом белых списков)</option>
            <option value="selected">Выбранным пользователям</option>
          </select>
        </label>
        {formAssignment === "selected" && (
          <div className="field">
            <button
              type="button"
              className="btn"
              onClick={() => openUsersPicker("Кому назначить белые списки", "form", formUserIds)}
            >
              Выбрать пользователей
            </button>
            <span className="muted vault-hint">
              Назначено вручную: {assignedCount}
              {purchasedUserIds.length > 0
                ? ` · с покупкой (куплено): ${purchasedUserIds.length}${pickedPurchased > 0 ? `, из них в списке: ${pickedPurchased}` : ""}`
                : ""}
            </span>
          </div>
        )}
      </>
    );
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="vault-page">
        <h1 className="page-title">Белые списки</h1>
        <p className="vault-lead muted">
          VLESS-ключи для белых списков: назначение пользователям, проверка доступности и уведомления.
        </p>

        <div className="vault-global-toggle">
          <label className="check-row vault-enabled-row">
            <span className="vault-enabled-label">Белые списки включены</span>
            <button
              type="button"
              className={`toggle ${data?.settings.enabled ? "on" : ""}`}
              disabled={busy}
              aria-pressed={data?.settings.enabled ?? false}
              onClick={() =>
                void runBusy(async () => {
                  const next = !data?.settings.enabled;
                  const r = await patchWhitelistVaultSettings({ enabled: next });
                  setData((d) => (d ? { ...d, settings: r.settings, disabled_warning: r.disabled_warning } : d));
                  showToast("ok", next ? "Белые списки включены" : "Белые списки выключены");
                })
              }
            />
          </label>
        </div>

        {data?.disabled_warning && (
          <div className="vault-warn" role="status">
            {data.disabled_warning}
          </div>
        )}

        {!data?.telegram_configured && (
          <div className="vault-warn" role="status">
            Telegram-уведомления не настроены (укажите токен бота и ID админов в настройках панели).
          </div>
        )}

        {toast && (
          <div className={`vault-toast vault-toast--${toast.type}`} role="status">
            {toast.text}
          </div>
        )}

        {data?.purchase_warning && (
          <div className="vault-warn" role="status">
            {data.purchase_warning}
          </div>
        )}

        <div className="vault-toolbar" style={{ marginBottom: "0.75rem", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
          {(["keys", "purchase", "instruction", "history"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={pageTab === t ? "primary" : "ghost"}
              onClick={() => {
                setPageTab(t);
                if (t === "history") {
                  void listWhitelistPurchases()
                    .then((r) => setPurchases(r.purchases))
                    .catch(() => setPurchases([]));
                }
              }}
            >
              {t === "keys"
                ? "VLESS-ключи"
                : t === "purchase"
                  ? "Покупка"
                  : t === "instruction"
                    ? "Инструкция"
                    : "История покупок"}
            </button>
          ))}
        </div>

        {pageTab === "purchase" && purchaseForm ? (
          <section className="vault-panel" style={{ marginBottom: "1rem" }}>
            <h2 className="vault-section-title">Продажа белых списков</h2>
            <p className="muted vault-hint">
              После оплаты VLESS-ключи белого списка будут добавлены в подписку пользователя. Пользователю нужно будет
              обновить подписку в приложении. Отметьте у ключей «Включать в продажу», иначе покупка будет скрыта.
            </p>
            {data?.purchase_warning ? <div className="vault-warn">{data.purchase_warning}</div> : null}
            {data?.sale_keys_count != null ? (
              <p className="muted vault-hint">Ключей для продажи: {data.sale_keys_count}</p>
            ) : null}
            <label className="check-row vault-enabled-row">
              <span>Продажа белых списков включена</span>
              <button
                type="button"
                className={`toggle ${purchaseForm.sale_enabled && data?.settings.enabled ? "on" : ""}`}
                disabled={busy || !data?.settings.enabled}
                onClick={() => setPurchaseForm((p) => (p ? { ...p, sale_enabled: !p.sale_enabled } : p))}
              />
            </label>
            <label className="field">
              <span>Цена, ₽</span>
              <input
                className="input"
                type="number"
                min={0}
                value={purchaseForm.price_rub}
                onChange={(e) =>
                  setPurchaseForm((p) => (p ? { ...p, price_rub: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : p))
                }
              />
            </label>
            <label className="field">
              <span>Срок действия</span>
              <select
                className="input"
                value={purchaseForm.duration}
                onChange={(e) =>
                  setPurchaseForm((p) =>
                    p ? { ...p, duration: e.target.value as WhitelistVaultSettingsDto["purchase"]["duration"] } : p,
                  )
                }
              >
                <option value="subscription_end">До конца основной подписки</option>
                <option value="30_days">30 дней</option>
                <option value="forever">Бессрочно</option>
              </select>
            </label>
            <label className="field">
              <span>Описание для Mini App</span>
              <textarea
                className="input"
                rows={3}
                value={purchaseForm.miniapp_description}
                onChange={(e) => setPurchaseForm((p) => (p ? { ...p, miniapp_description: e.target.value } : p))}
              />
            </label>
            <label className="field">
              <span>Описание для Telegram-бота</span>
              <textarea
                className="input"
                rows={3}
                value={purchaseForm.bot_description}
                onChange={(e) => setPurchaseForm((p) => (p ? { ...p, bot_description: e.target.value } : p))}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void runBusy(async () => {
                  const r = await patchWhitelistPurchaseSettings(purchaseForm);
                  setData((d) => (d ? { ...d, ...r, settings: { ...r.settings, purchase: r.settings.purchase } } : d));
                  showToast("ok", "Настройки покупки сохранены");
                })
              }
            >
              Сохранить
            </button>
          </section>
        ) : null}

        {pageTab === "instruction" && instructionForm ? (
          <section className="vault-panel" style={{ marginBottom: "1rem" }}>
            <h2 className="vault-section-title">Инструкция по обновлению подписки</h2>
            {!instructionForm.photo_path ? (
              <div className="vault-warn">Фото инструкции не загружено</div>
            ) : null}
            <label className="field">
              <span>Заголовок</span>
              <input
                className="input"
                value={instructionForm.title}
                onChange={(e) => setInstructionForm((p) => (p ? { ...p, title: e.target.value } : p))}
              />
            </label>
            <label className="field">
              <span>Текст</span>
              <textarea
                className="input"
                rows={8}
                value={instructionForm.text}
                onChange={(e) => setInstructionForm((p) => (p ? { ...p, text: e.target.value } : p))}
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <label className="ghost" style={{ cursor: "pointer" }}>
                Загрузить фото
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => {
                      void runBusy(async () => {
                        const updated = await uploadWhitelistInstructionPhoto(String(r.result ?? ""));
                        setData(updated);
                        setInstructionForm(updated.settings.instruction);
                        showToast("ok", "Фото загружено");
                      });
                    };
                    r.readAsDataURL(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="ghost"
                disabled={!instructionForm.photo_path}
                onClick={() =>
                  void runBusy(async () => {
                    const updated = await deleteWhitelistInstructionPhoto();
                    setData(updated);
                    setInstructionForm(updated.settings.instruction);
                    showToast("ok", "Фото удалено");
                  })
                }
              >
                Удалить фото
              </button>
            </div>
            <label className="field">
              <span>Telegram ID админа для теста</span>
              <input className="input" value={testAdminChatId} onChange={(e) => setTestAdminChatId(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void runBusy(async () => {
                    const updated = await patchWhitelistInstructionSettings(instructionForm);
                    setData(updated);
                    setInstructionForm(updated.settings.instruction);
                    showToast("ok", "Инструкция сохранена");
                  })
                }
              >
                Сохранить инструкцию
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!testAdminChatId.trim()}
                onClick={() =>
                  void runBusy(async () => {
                    await testWhitelistInstruction(Number(testAdminChatId.trim()));
                    showToast("ok", "Тест отправлен");
                  })
                }
              >
                Отправить тест админу
              </button>
            </div>
          </section>
        ) : null}

        {pageTab === "history" ? (
          <section className="vault-panel" style={{ marginBottom: "1rem" }}>
            <h2 className="vault-section-title">История покупок белых списков</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Telegram ID</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Дата</th>
                    <th>Срок</th>
                    <th>Инструкция</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id}>
                      <td>{p.user_name}</td>
                      <td>{p.tg_id || "—"}</td>
                      <td>{p.amount} ₽</td>
                      <td>{p.status}</td>
                      <td>{formatDt(p.activated_at || p.created_at)}</td>
                      <td>{formatDt(p.expires_at)}</td>
                      <td>
                        {p.instruction_sent ? "да" : "нет"}
                        {p.instruction_error ? ` · ${p.instruction_error}` : ""}
                        {p.activation_error ? ` · ${p.activation_error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {pageTab === "keys" ? (
          <>
        <div className="vault-stats">
          <div className="vault-stat-card">
            <span className="vault-stat-label">Всего ключей</span>
            <strong>{stats?.total ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">Назначено пользователям</span>
            <strong>{stats?.assigned_users ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--ok">
            <span className="vault-stat-label">Доступны</span>
            <strong>{stats?.available ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--bad">
            <span className="vault-stat-label">Недоступны</span>
            <strong>{stats?.unavailable ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--warn">
            <span className="vault-stat-label">Нестабильны</span>
            <strong>{stats?.unstable ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">Не проверялись</span>
            <strong>{stats?.never ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">Последняя автопроверка</span>
            <strong className="vault-stat-sm">{formatDt(stats?.last_auto_run_at ?? null)}</strong>
          </div>
        </div>

        <div className="vault-toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={() => {
            setFormName("");
            setFormUri("");
            setFormActive(true);
            setFormNotify(true);
            setFormAssignment("none");
            setFormUserIds([]);
            setAddOpen(true);
          }}>
            Добавить ключ
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setImportOpen(true)}>
            Импорт VLESS-ссылок
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setJsonImportOpen(true)}>
            Импорт из JSON
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void runBusy(async () => {
              const start = await checkAllWhitelistVaultKeys();
              if (start.already_running) {
                showToast("ok", "Проверка уже выполняется");
              } else {
                showToast("ok", `Проверка запущена (${start.total ?? 0} ключей)`);
              }
              await pollUntilVaultChecksDone(async () => {
                const r = await reload();
                return r ?? { keys: [] };
              }, start.total ?? 0);
              await reload();
              showToast("ok", "Проверка всех ключей завершена");
            })}
          >
            Проверить все сейчас
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setSettingsForm(data?.settings ?? null);
              setSettingsOpen(true);
            }}
          >
            Настройки автопроверки
          </button>
        </div>

        <div className="vault-filters">
          <input
            className="input"
            placeholder="Поиск по названию или части ключа"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
            <option value="all">Все</option>
            <option value="assigned">Назначены</option>
            <option value="unassigned">Никому</option>
            <option value="available">Доступные</option>
            <option value="unavailable">Недоступные</option>
            <option value="unstable">Нестабильные</option>
            <option value="never">Не проверялись</option>
          </select>
          <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="new">Новые сверху</option>
            <option value="old">Старые сверху</option>
            <option value="status">По статусу</option>
            <option value="last_check">По последней проверке</option>
          </select>
        </div>

        {(data?.keys?.length ?? 0) > 0 ? (
          <div className="vault-list-toolbar">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || allVaultSelected}
              onClick={selectAllVaultKeys}
            >
              Выбрать все
            </button>
            <button
              type="button"
              className="btn btn-sm danger"
              disabled={busy}
              onClick={() => void handleDeleteAllKeys()}
            >
              Удалить все
            </button>
          </div>
        ) : null}

        {keys.length === 0 ? (
          <p className="muted vault-empty">Нет ключей. Добавьте VLESS-ключ или импортируйте список.</p>
        ) : (
          <>
            {selectedKeyIds.length > 0 ? (
              <div className="vault-bulk-bar">
                <span className="vault-bulk-bar__count">Выбрано: {selectedKeyIds.length}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setBulkRemark("");
                    setBulkRenameOpen(true);
                  }}
                >
                  Переименовать
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    openUsersPicker(`Назначить клиентам (${selectedKeyIds.length})`, "assign-bulk", [])
                  }
                >
                  Назначить клиентам
                </button>
                <button type="button" className="btn btn-sm danger" disabled={busy} onClick={() => void handleBulkDelete()}>
                  Удалить выбранные
                </button>
                <button type="button" className="btn btn-sm ghost" onClick={clearKeySelection}>
                  Снять выбор
                </button>
              </div>
            ) : null}
            <div className="vault-list">
            {keys.map((k) => (
              <article
                key={k.id}
                className={`vault-row${selectedKeyIds.includes(k.id) ? " vault-row--selected" : ""}`}
              >
                <div className="vault-pick">
                  <label title="Выбрать ключ">
                    <input
                      type="checkbox"
                      checked={selectedKeyIds.includes(k.id)}
                      onChange={() => toggleKeySelected(k.id)}
                    />
                  </label>
                </div>
                <div className="vault-row-main">
                  <div className="vault-row-title">
                    <strong>{k.name}</strong>
                    {!k.active && <span className="vault-badge vault-badge--off">Отключён</span>}
                  </div>
                  <code className="vault-uri">{maskSecret(k.masked_uri)}</code>
                  <div className="vault-row-meta">
                    <span className={`vault-status vault-status--${k.last_check_status}`}>
                      {STATUS_LABEL[k.last_check_status]}
                    </span>
                    {k.last_check_latency_ms != null && (
                      <span className="muted">{k.last_check_latency_ms} мс</span>
                    )}
                    <span className="muted">Проверка: {formatDt(k.last_check_at)}</span>
                    <span className="muted">Подключено: {k.assignment_label}</span>
                  </div>
                </div>
                <div className="vault-row-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void openView(k)}>
                    Просмотр
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void openEdit(k)}>
                    Редактировать
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void checkOne(k)}>
                    Проверить
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => openAssign(k)}>
                    Назначить
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void openHistory(k)}>
                    История
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const uri = k.raw_uri;
                      if (uri) copyUri(uri);
                      else
                        void fetchWhitelistVaultKeyRaw(k.id).then((r) => {
                          if (r.key.raw_uri) copyUri(r.key.raw_uri);
                        });
                    }}
                  >
                    Скопировать
                  </button>
                  <button type="button" className="btn btn-sm danger" onClick={() => void handleDelete(k)}>
                    Удалить
                  </button>
                </div>
              </article>
            ))}
            </div>
          </>
        )}
          </>
        ) : null}

      {bulkRenameOpen && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Переименовать ({selectedKeyIds.length})</h2>
              <button type="button" className="modal-close" onClick={() => setBulkRenameOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="muted vault-hint">
                Новое название попадёт в подписку после символа # (как в Happ / v2rayN).
              </p>
              <label className="field">
                <span>Название в ссылке</span>
                <input
                  className="input"
                  value={bulkRemark}
                  onChange={(e) => setBulkRemark(e.target.value)}
                  placeholder="🇪🇺 [Глушилки] – РЕЗЕРВ · proxy-5"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setBulkRenameOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleBulkRename()}>
                Применить
              </button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Добавить VLESS-ключ</h2>
              <button type="button" className="modal-close" onClick={() => setAddOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Название</span>
                <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label className="field">
                <span>VLESS URI</span>
                <textarea className="input" rows={4} value={formUri} onChange={(e) => setFormUri(e.target.value)} />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Активен
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={formIncludeInSale}
                  onChange={(e) => setFormIncludeInSale(e.target.checked)}
                />
                Включать в продажу
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formNotify} onChange={(e) => setFormNotify(e.target.checked)} />
                Уведомлять при недоступности
              </label>
              {renderAssignmentFields()}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setAddOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleCreate()}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {editKey && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Редактировать ключ</h2>
              <button type="button" className="modal-close" onClick={() => setEditKey(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Название</span>
                <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label className="field">
                <span>VLESS URI</span>
                <textarea className="input" rows={4} value={formUri} onChange={(e) => setFormUri(e.target.value)} />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Активен
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={formIncludeInSale}
                  onChange={(e) => setFormIncludeInSale(e.target.checked)}
                />
                Включать в продажу
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formNotify} onChange={(e) => setFormNotify(e.target.checked)} />
                Уведомлять при недоступности
              </label>
              {renderAssignmentFields()}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setEditKey(null)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleSaveEdit()}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {viewKey && (
        <div className="modal-backdrop">
          <div className="modal vault-modal">
            <div className="modal-head">
              <h2>{viewKey.name}</h2>
              <button type="button" className="modal-close" onClick={() => setViewKey(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                <span className="muted">Ключ: </span>
                <code className="vault-uri">
                  {viewFullUri && viewRawUri ? viewRawUri : maskSecret(viewKey.masked_uri)}
                </code>
              </p>
              {!viewFullUri && (
                <button type="button" className="btn btn-sm" onClick={revealFull}>
                  Показать полностью
                </button>
              )}
              {viewRawUri && (
                <button type="button" className="btn btn-sm" onClick={() => copyUri(viewRawUri)}>
                  Скопировать ключ
                </button>
              )}
              <dl className="vault-dl">
                <dt>Статус</dt>
                <dd>{STATUS_LABEL[viewKey.last_check_status]}</dd>
                <dt>Последняя проверка</dt>
                <dd>{formatDt(viewKey.last_check_at)}</dd>
                <dt>Задержка</dt>
                <dd>{viewKey.last_check_latency_ms != null ? `${viewKey.last_check_latency_ms} мс` : "—"}</dd>
                <dt>Ошибка</dt>
                <dd>{viewKey.last_error ?? "—"}</dd>
                <dt>Назначение</dt>
                <dd>{viewKey.assignment_label}</dd>
                <dt>Активен</dt>
                <dd>{viewKey.active ? "Да" : "Нет"}</dd>
                <dt>Уведомления</dt>
                <dd>{viewKey.notify_on_fail ? "Включены" : "Выключены"}</dd>
              </dl>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" disabled={busy} onClick={() => void checkOne(viewKey)}>
                Проверить сейчас
              </button>
              <button type="button" className="btn" onClick={() => openAssign(viewKey)}>
                Назначить
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setViewKey(null);
                  void openEdit(viewKey, viewRawUri);
                }}
              >
                Редактировать
              </button>
              <button type="button" className="btn danger" onClick={() => void handleDelete(viewKey)}>
                Удалить
              </button>
              <button type="button" className="btn" onClick={() => setViewKey(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {jsonImportOpen && (
        <div className="modal-backdrop">
          <div className="modal modal-import vault-modal">
            <div className="modal-head">
              <h2>Импорт из JSON</h2>
              <button type="button" className="modal-close" onClick={() => setJsonImportOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Название (опционально)</span>
                <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label className="field">
                <span>JSON-конфиг Xray</span>
                <textarea className="input" rows={12} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
              </label>
              {renderAssignmentFields()}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setJsonImportOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleJsonImport()}>
                Импортировать
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop">
          <div className="modal modal-import vault-modal">
            <div className="modal-head">
              <h2>Импорт VLESS-ссылок</h2>
              <button type="button" className="modal-close" onClick={() => setImportOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Префикс названия (опционально)</span>
                <input className="input" value={importPrefix} onChange={(e) => setImportPrefix(e.target.value)} />
              </label>
              <label className="field">
                <span>VLESS-ссылки (по одной на строку)</span>
                <textarea className="input" rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setImportOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleImport()}>
                Импортировать
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && settingsForm && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Автопроверка</h2>
              <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsForm.auto_check_enabled}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, auto_check_enabled: e.target.checked })
                  }
                />
                Автопроверка включена
              </label>
              <label className="field">
                <span>Интервал (минут)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={settingsForm.interval_minutes}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, interval_minutes: Number(e.target.value) || 15 })
                  }
                />
              </label>
              <label className="field">
                <span>Попыток на проверку</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={settingsForm.attempts_per_check}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, attempts_per_check: Number(e.target.value) || 5 })
                  }
                />
              </label>
              <label className="field">
                <span>Таймаут попытки (сек)</span>
                <input
                  className="input"
                  type="number"
                  min={3}
                  value={settingsForm.attempt_timeout_sec}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, attempt_timeout_sec: Number(e.target.value) || 8 })
                  }
                />
              </label>
              <label className="field">
                <span>Тестовый URL</span>
                <input
                  className="input"
                  value={settingsForm.test_url}
                  onChange={(e) => setSettingsForm({ ...settingsForm, test_url: e.target.value })}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsForm.notify_on_unavailable}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, notify_on_unavailable: e.target.checked })
                  }
                />
                Уведомлять при недоступности
              </label>
              <label className="field">
                <span>Cooldown уведомлений (мин)</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  value={settingsForm.notify_cooldown_minutes}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      notify_cooldown_minutes: Number(e.target.value) || 45,
                    })
                  }
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void runBusy(async () => {
                    await patchWhitelistVaultSettings(settingsForm);
                    await reload();
                    setSettingsOpen(false);
                    showToast("ok", "Настройки сохранены");
                  })
                }
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {historyKey && (
        <div className="modal-backdrop">
          <div className="modal vault-modal">
            <div className="modal-head">
              <h2>История: {historyKey.name}</h2>
              <button type="button" className="modal-close" onClick={() => setHistoryKey(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="vault-filters">
                <select
                  className="input"
                  value={historyFilter.status}
                  onChange={(e) => setHistoryFilter((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="">Все статусы</option>
                  <option value="available">Доступен</option>
                  <option value="unavailable">Недоступен</option>
                  <option value="unstable">Нестабильно</option>
                </select>
                <select
                  className="input"
                  value={historyFilter.triggered}
                  onChange={(e) => setHistoryFilter((f) => ({ ...f, triggered: e.target.value }))}
                >
                  <option value="">Все</option>
                  <option value="manual">Ручная</option>
                  <option value="auto">Авто</option>
                </select>
                <button type="button" className="btn btn-sm" onClick={() => void reloadHistory()}>
                  Применить
                </button>
              </div>
              <div className="vault-history-table">
                {history.length === 0 ? (
                  <p className="muted">Нет записей</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Время</th>
                        <th>Статус</th>
                        <th>Успех</th>
                        <th>Задержка</th>
                        <th>Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((c) => (
                        <tr key={c.id}>
                          <td>{formatDt(c.checked_at)}</td>
                          <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                          <td>
                            {c.attempts_success}/{c.attempts_total}
                          </td>
                          <td>{c.avg_latency_ms ?? "—"}</td>
                          <td>{c.triggered_by === "auto" ? "Авто" : "Ручная"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <DualListPicker
        open={usersPickerOpen}
        title={usersPickerTitle}
        leftLabel="Доступные пользователи"
        rightLabel="Назначено"
        items={whitelistUserPickerItems}
        selectedIds={formUserIds}
        onClose={() => {
          const purpose = usersPickerPurpose;
          setUsersPickerOpen(false);
          setUsersPickerPurpose(null);
          if (purpose === "assign-one") setAssignKey(null);
        }}
        onSave={(ids) => void handleUsersPickerSave(ids)}
      />
      </div>
    </DashboardLayout>
  );
}
