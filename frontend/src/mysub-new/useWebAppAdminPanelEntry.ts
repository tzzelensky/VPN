import { useCallback, useRef, useState } from "react";
import { checkWebAppAdminGate, loginWebAppAdmin } from "../api";

const TAP_NEED = 5;
const TAP_WINDOW_MS = 2500;

export function useWebAppAdminPanelEntry(initData: string, disabled = false) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tapsRef = useRef(0);
  const timerRef = useRef(0);

  const onAvatarTap = useCallback(
    (e?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      if (disabled || !initData.trim()) return;
      tapsRef.current += 1;
      window.clearTimeout(timerRef.current);
      if (tapsRef.current >= TAP_NEED) {
        tapsRef.current = 0;
        void checkWebAppAdminGate(initData)
          .then((r) => {
            if (r.ok) setOpen(true);
          })
          .catch(() => undefined);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        tapsRef.current = 0;
      }, TAP_WINDOW_MS);
    },
    [disabled, initData],
  );

  const cancel = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loginWebAppAdmin(initData);
      window.location.replace("/servers");
    } catch {
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [busy, initData]);

  return { open, busy, onAvatarTap, confirm, cancel };
}
