import type { Request, Response } from "express";

export function wantsNdjsonStream(req: Request): boolean {
  const q = req.query.stream;
  return q === "1" || q === "true";
}

export function initNdjsonStream(res: Response): void {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  (res as { flushHeaders?: () => void }).flushHeaders?.();
}

export function ndjsonLine(res: Response, obj: object): void {
  res.write(`${JSON.stringify(obj)}\n`);
}
