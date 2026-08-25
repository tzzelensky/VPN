import { useEffect, useState } from "react";

export type PublicSiteMeta = {
  panelAccessPath: string | null;
};

let cached: PublicSiteMeta | null = null;
let inflight: Promise<PublicSiteMeta> | null = null;

async function loadPublicSiteMeta(): Promise<PublicSiteMeta> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch("/api/public/site-meta", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return { panelAccessPath: null };
      const data = (await res.json()) as { panelAccessPath?: unknown };
      const path = String(data.panelAccessPath ?? "").trim();
      cached = { panelAccessPath: path || null };
      return cached;
    })
    .catch(() => {
      cached = { panelAccessPath: null };
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function usePublicSiteMeta(enabled = true): PublicSiteMeta | null {
  const [meta, setMeta] = useState<PublicSiteMeta | null>(() => (enabled ? cached : { panelAccessPath: null }));

  useEffect(() => {
    if (!enabled) {
      setMeta({ panelAccessPath: null });
      return;
    }
    if (cached) {
      setMeta(cached);
      return;
    }
    let cancelled = false;
    void loadPublicSiteMeta().then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return meta;
}

export function invalidatePublicSiteMetaCache(): void {
  cached = null;
}
