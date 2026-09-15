import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listUsers,
  loadAdminMySubWebAppProfile,
  type MySubProfileDto,
  type UserDto,
} from "../api";
import { subscriptionLabel } from "../subscriptionLabel";
import Spinner from "./Spinner";
import MySubWebAppNew from "../mysub-new/MySubWebAppNew";
import { useWebAppPreviewController } from "../mysub-new/useWebAppPreviewController";
import { MySubPortalProvider } from "../mysub-new/portalContext";
import type { MySubTheme } from "../mysub-new/types";
import "../mysub-new/mysubNew.css";

function parseTgId(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function uniqueByTg(users: UserDto[]): Array<{ tgId: number; label: string; sample: UserDto }> {
  const map = new Map<number, { tgId: number; label: string; sample: UserDto; names: string[] }>();
  for (const u of users) {
    const tgId = parseTgId(u.tg_id);
    if (!tgId) continue;
    const prev = map.get(tgId);
    if (!prev) {
      map.set(tgId, { tgId, label: "", sample: u, names: [u.name] });
    } else {
      prev.names.push(u.name);
      if (u.id < prev.sample.id) prev.sample = u;
    }
  }
  return [...map.values()]
    .map((row) => ({
      tgId: row.tgId,
      sample: row.sample,
      label: `${row.sample.name}${row.names.length > 1 ? ` (+${row.names.length - 1})` : ""} · tg ${row.tgId}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

type PhoneHostProps = {
  profile: MySubProfileDto;
  theme: MySubTheme;
  onRefresh: () => Promise<void>;
  onThemeChange: (t: MySubTheme) => void;
};

function PreviewPhoneHost({ profile, theme, onRefresh, onThemeChange }: PhoneHostProps) {
  const ctrl = useWebAppPreviewController({ profile, theme, onRefresh, onThemeChange });
  return <MySubWebAppNew ctrl={ctrl} embedInAdmin />;
}

export default function WebAppPreviewPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedTgId, setSelectedTgId] = useState<number | null>(() => parseTgId(searchParams.get("tgId")));
  const [profile, setProfile] = useState<MySubProfileDto | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<MySubTheme>("light");
  const [frameKey, setFrameKey] = useState(0);
  const [phonePortalRoot, setPhonePortalRoot] = useState<HTMLElement | null>(null);

  const tgOptions = useMemo(() => uniqueByTg(users), [users]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tgOptions;
    return tgOptions.filter((o) => {
      const hay = `${o.label} ${o.sample.id} ${o.sample.name} ${o.tgId} ${o.sample.email}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, tgOptions]);

  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);
    void listUsers()
      .then((rows) => {
        if (!cancelled) setUsers(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProfile = useCallback(async (tgId: number) => {
    setProfileLoading(true);
    setError(null);
    try {
      let p: MySubProfileDto | null = null;
      let lastErr: unknown = null;
      for (let i = 0; i < 2; i++) {
        try {
          p = await loadAdminMySubWebAppProfile(tgId);
          break;
        } catch (e) {
          lastErr = e;
          if (!(e instanceof Error) || e.message !== "Failed to fetch" || i === 1) throw e;
          await new Promise((r) => window.setTimeout(r, 300));
        }
      }
      if (!p) throw (lastErr instanceof Error ? lastErr : new Error("Failed to fetch"));
      setProfile(p);
      setFrameKey((k) => k + 1);
    } catch (e) {
      setProfile(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "Failed to fetch" ? "?? ??????? ????????? ?????? (????????? API/????)." : msg);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedTgId) {
      setProfile(null);
      return;
    }
    void loadProfile(selectedTgId);
  }, [selectedTgId, loadProfile]);

  useEffect(() => {
    const fromUrl = parseTgId(searchParams.get("tgId"));
    if (fromUrl && fromUrl !== selectedTgId) setSelectedTgId(fromUrl);
  }, [searchParams, selectedTgId]);

  function selectTg(tgId: number | null) {
    setSelectedTgId(tgId);
    const next = new URLSearchParams(searchParams);
    if (tgId) next.set("tgId", String(tgId));
    else next.delete("tgId");
    setSearchParams(next, { replace: true });
  }

  const selectedMeta = tgOptions.find((o) => o.tgId === selectedTgId) ?? null;

  return (
    <div className="webapp-preview">
      <aside className="webapp-preview__sidebar">
        <div className="webapp-preview__title-block">
          <div className="webapp-preview__title-row">
            <h2 className="webapp-preview__title">?????? WebApp</h2>
            <span className="webapp-preview__badge" title="??????? ?????????">
              ?????? ????????
            </span>
          </div>
          <p className="webapp-preview__subtitle">??? ?????? ????? Mini App ?? ????? ??????? ??????</p>
        </div>

        <div className="webapp-preview__controls">
          <label className="webapp-preview__field">
            <span>?????</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="???, tg id, id ?????????"
              autoComplete="off"
            />
          </label>
          <label className="webapp-preview__field webapp-preview__field--select">
            <span>????????????</span>
            <select
              value={selectedTgId ? String(selectedTgId) : ""}
              disabled={usersLoading}
              onChange={(e) => {
                const v = e.target.value;
                selectTg(v ? Number(v) : null);
              }}
            >
              <option value="">{usersLoading ? "?????????" : "???????? ????????????"}</option>
              {filteredOptions.map((o) => (
                <option key={o.tgId} value={o.tgId}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="webapp-preview__field">
            <span>????</span>
            <div className="webapp-preview__theme" role="group" aria-label="???? ??????">
              <button
                type="button"
                className={theme === "light" ? "is-active" : ""}
                onClick={() => setTheme("light")}
              >
                ???????
              </button>
              <button
                type="button"
                className={theme === "dark" ? "is-active" : ""}
                onClick={() => setTheme("dark")}
              >
                ??????
              </button>
            </div>
          </div>

          <button
            type="button"
            className="ghost webapp-preview__refresh"
            disabled={!selectedTgId || profileLoading}
            onClick={() => selectedTgId && void loadProfile(selectedTgId)}
          >
            {profileLoading ? (
              <>
                <Spinner /> ???????????
              </>
            ) : (
              "????????"
            )}
          </button>
        </div>

        {selectedMeta ? (
          <p className="webapp-preview__meta">
            {subscriptionLabel(selectedMeta.sample)}
            <br />
            Telegram ID <b>{selectedMeta.tgId}</b>
          </p>
        ) : null}
        {error ? <div className="flash err webapp-preview__error">{error}</div> : null}
      </aside>

      <div className="webapp-preview__stage">
        {!selectedTgId ? (
          <div className="webapp-preview__empty">
            <div className="webapp-preview__empty-card">
              <p className="webapp-preview__empty-title">???????? ????????????</p>
              <p className="webapp-preview__empty-text">
                ??????? ??????? ????? ? ?????? ????????? ??? WebApp ? ?????? ?????????.
              </p>
            </div>
          </div>
        ) : (
          <div key={frameKey} className={`webapp-preview__phone webapp-preview__phone--${theme}`}>
            <div className="webapp-preview__phone-screen" ref={setPhonePortalRoot}>
              {profileLoading && !profile ? (
                <div className="webapp-preview__phone-loading">
                  <Spinner />
                  <span>???????? ????????</span>
                </div>
              ) : profile && phonePortalRoot ? (
                <MySubPortalProvider root={phonePortalRoot}>
                  <div
                    className={`webapp-preview__app mn-app mn-app--${theme}${theme === "light" ? " mysub-wrap--light" : ""}`}
                  >
                    <PreviewPhoneHost
                      profile={profile}
                      theme={theme}
                      onThemeChange={setTheme}
                      onRefresh={async () => {
                        if (selectedTgId) await loadProfile(selectedTgId);
                      }}
                    />
                  </div>
                </MySubPortalProvider>
              ) : profile ? (
                <div className="webapp-preview__phone-loading">
                  <Spinner />
                  <span>?????????</span>
                </div>
              ) : (
                <div className="webapp-preview__phone-loading">
                  <span>?? ??????? ????????? ???????</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

