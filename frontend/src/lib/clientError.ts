export function formatClientError(e: unknown): string {
  const raw =
    e instanceof Error ? e.message.trim() : typeof e === "string" ? e.trim() : String(e ?? "").trim();
  if (!raw) return "Что-то пошло не так.";
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const fromApi = parsed.error ?? parsed.message;
    if (typeof fromApi === "string" && fromApi.trim()) return fromApi.trim();
  } catch {
    // not JSON
  }
  return raw.replace(/^Error:\s*/i, "");
}
