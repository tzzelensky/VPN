import type { AuthedAgent } from "./auth.js";

/** Fire the same request twice in parallel (client double-submit / retry). */
export async function doubleSubmit(
  agent: AuthedAgent,
  method: "post" | "delete" | "patch" | "put",
  url: string,
  body?: unknown,
): Promise<[number, number]> {
  const mk = () => {
    const r = agent[method](url);
    if (body !== undefined && method !== "delete") r.send(body);
    return r;
  };
  const [a, b] = await Promise.all([mk(), mk()]);
  return [a.status, b.status];
}

/** Simulate client abort: start request then destroy socket early. */
export async function abortablePost(
  agent: AuthedAgent,
  url: string,
  body: unknown,
  abortAfterMs: number,
): Promise<"aborted" | { status: number; body: unknown }> {
  return await new Promise((resolve) => {
    const req = agent.post(url).send(body);
    const t = setTimeout(() => {
      req.abort();
      resolve("aborted");
    }, abortAfterMs);
    req.end((err, res) => {
      clearTimeout(t);
      if (err && (err as { code?: string }).code === "ECONNABORTED") {
        resolve("aborted");
        return;
      }
      if (err) {
        resolve("aborted");
        return;
      }
      resolve({ status: res.status, body: res.body });
    });
  });
}
