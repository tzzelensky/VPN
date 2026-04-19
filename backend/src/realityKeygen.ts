import { generateKeyPairSync, randomBytes } from "node:crypto";

const DEFAULT_FLOW = "xtls-rprx-vision";
const DEFAULT_REALITY_SNI = "www.oracle.com";

export function defaultRealityFlow(): string {
  return DEFAULT_FLOW;
}

export function defaultRealitySni(): string {
  return DEFAULT_REALITY_SNI;
}

/** Короткий shortId в стиле x-ui (hex, 6 символов). */
export function randomRealityShortId(): string {
  return randomBytes(3).toString("hex");
}

export function normalizeFlow(flow: string | undefined): string {
  const t = (flow ?? "").trim();
  if (t === "xtls-rprx-vision-udp443") return DEFAULT_FLOW;
  return t;
}

/** Сырые 32 байта X25519 → publicKey для VLESS Reality (base64url без паддинга). */
export function generateX25519RealityKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const pubDer = publicKey as Buffer;
  const privDer = privateKey as Buffer;
  const rawPub = pubDer.subarray(pubDer.length - 32);
  const rawPriv = privDer.subarray(privDer.length - 32);
  return {
    publicKey: rawPub.toString("base64url"),
    privateKey: rawPriv.toString("base64url"),
  };
}
