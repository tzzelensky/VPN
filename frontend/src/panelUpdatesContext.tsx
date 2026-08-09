import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyPanelUpdates,
  checkPanelUpdates,
  type PanelUpdateCheckDto,
} from "./api";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export type PanelUpdateApplyPhase =
  | "idle"
  | "pulling"
  | "building"
  | "restarting"
  | "done"
  | "error";

type PanelUpdatesContextValue = {
  updateAvailable: boolean;
  info: PanelUpdateCheckDto | null;
  lastCheckedAt: number | null;
  checking: boolean;
  applyPhase: PanelUpdateApplyPhase;
  applyMessage: string;
  refresh: () => Promise<PanelUpdateCheckDto | null>;
  apply: () => Promise<void>;
};

const PanelUpdatesContext = createContext<PanelUpdatesContextValue | null>(null);

export function PanelUpdatesProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [info, setInfo] = useState<PanelUpdateCheckDto | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [applyPhase, setApplyPhase] = useState<PanelUpdateApplyPhase>("idle");
  const [applyMessage, setApplyMessage] = useState("");
  const checkingRef = useRef(false);
  const applyBusyRef = useRef(false);
  const phaseTimers = useRef<number[]>([]);

  const clearPhaseTimers = useCallback(() => {
    for (const t of phaseTimers.current) window.clearTimeout(t);
    phaseTimers.current = [];
  }, []);

  const refresh = useCallback(async (): Promise<PanelUpdateCheckDto | null> => {
    if (!enabled || checkingRef.current || applyBusyRef.current) return null;
    checkingRef.current = true;
    setChecking(true);
    try {
      const next = await checkPanelUpdates();
      setInfo(next);
      setLastCheckedAt(Date.now());
      return next;
    } catch {
      setLastCheckedAt(Date.now());
      return null;
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setInfo(null);
      setLastCheckedAt(null);
      setApplyPhase("idle");
      setApplyMessage("");
      return;
    }
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  useEffect(() => () => clearPhaseTimers(), [clearPhaseTimers]);

  const apply = useCallback(async () => {
    if (applyBusyRef.current) return;
    if (!window.confirm("Скачать обновления, пересобрать панель и перезапустить API?")) return;
    applyBusyRef.current = true;
    clearPhaseTimers();
    setApplyPhase("pulling");
    setApplyMessage("Скачиваем обновления из репозитория…");
    phaseTimers.current.push(
      window.setTimeout(() => {
        setApplyPhase("building");
        setApplyMessage("Собираем backend и frontend…");
      }, 2500),
    );
    phaseTimers.current.push(
      window.setTimeout(() => {
        setApplyPhase((p) => (p === "done" || p === "error" ? p : "restarting"));
        setApplyMessage((m) =>
          m.includes("Готово") || m.includes("Ошибка") ? m : "Почти готово, готовим перезапуск…",
        );
      }, 12_000),
    );
    try {
      const r = await applyPanelUpdates();
      clearPhaseTimers();
      setApplyPhase("done");
      setApplyMessage(r.message || "Обновление завершено. Перезагрузка…");
      setInfo((prev) =>
        prev
          ? {
              ...prev,
              updateAvailable: false,
              behindCount: 0,
              currentVersion: r.currentVersion || prev.currentVersion,
              message: "Установлена актуальная версия.",
            }
          : prev,
      );
      window.setTimeout(() => {
        window.location.assign("/login");
      }, 2800);
    } catch (e) {
      clearPhaseTimers();
      setApplyPhase("error");
      setApplyMessage(String(e));
      applyBusyRef.current = false;
    }
  }, [clearPhaseTimers]);

  const value = useMemo<PanelUpdatesContextValue>(
    () => ({
      updateAvailable: Boolean(info?.updateAvailable),
      info,
      lastCheckedAt,
      checking,
      applyPhase,
      applyMessage,
      refresh,
      apply,
    }),
    [info, lastCheckedAt, checking, applyPhase, applyMessage, refresh, apply],
  );

  return <PanelUpdatesContext.Provider value={value}>{children}</PanelUpdatesContext.Provider>;
}

export function usePanelUpdates(): PanelUpdatesContextValue {
  const ctx = useContext(PanelUpdatesContext);
  if (!ctx) {
    return {
      updateAvailable: false,
      info: null,
      lastCheckedAt: null,
      checking: false,
      applyPhase: "idle",
      applyMessage: "",
      refresh: async () => null,
      apply: async () => undefined,
    };
  }
  return ctx;
}
