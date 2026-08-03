import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

export function normalizeBasePath(basePath: string): string {
  const p = String(basePath ?? "").trim();
  if (!p || p === "/") return "/";
  return p.replace(/\/$/, "") || "/";
}

export function tabPath(basePath: string, slug: string): string {
  const base = normalizeBasePath(basePath);
  const s = String(slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!s) return base;
  return `${base}/${s}`;
}

export function resolvePanelTabSlug<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  defaultSlug: T,
): T {
  const slug = String(raw ?? "").trim() as T;
  if ((allowed as readonly string[]).includes(slug)) return slug;
  return defaultSlug;
}

/**
 * Синхронизация верхней вкладки страницы с `/base/:tab`.
 * Неизвестный или пустой `:tab` → replace-редирект на defaultSlug.
 * Query string (например `?user=`) сохраняется.
 */
export function usePanelTabParam<T extends string>(
  basePath: string,
  allowed: readonly T[],
  defaultSlug?: T,
): { tab: T; setTab: (next: T) => void } {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const fallback = (defaultSlug ?? allowed[0]) as T;
  const allowedKey = useMemo(() => allowed.join("|"), [allowed]);

  const tab = resolvePanelTabSlug(params.tab, allowed, fallback);
  const rawTab = String(params.tab ?? "").trim();
  const needsRedirect = !rawTab || !(allowed as readonly string[]).includes(rawTab);

  useEffect(() => {
    if (!needsRedirect) return;
    navigate(
      { pathname: tabPath(basePath, fallback), search: location.search },
      { replace: true },
    );
  }, [needsRedirect, basePath, fallback, navigate, allowedKey, location.search]);

  const setTab = useCallback(
    (next: T) => {
      if (!(allowed as readonly string[]).includes(next)) return;
      navigate({ pathname: tabPath(basePath, next), search: location.search });
    },
    [allowed, basePath, navigate, location.search],
  );

  return { tab, setTab };
}
