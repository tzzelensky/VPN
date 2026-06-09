import { randomBytes } from "node:crypto";

export type VlessAuthGenMode = "x25519" | "ml-kem-768";

function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/** Разбор вывода `xray vlessenc` — server decryption (600s) + client encryption (0rtt). */
export function parseVlessEncOutput(raw: string, mode: VlessAuthGenMode): { decrypt_value: string; encrypt_value: string } {
  const wantMl = mode === "ml-kem-768";
  const chunks = raw.split(/Authentication:/);
  for (const chunk of chunks) {
    const isX25519 = chunk.includes("X25519");
    const isMl = chunk.includes("ML-KEM-768");
    if (wantMl && !isMl) continue;
    if (!wantMl && !isX25519) continue;
    const decrypt_value = chunk.match(/"decryption":\s*"([^"]+)"/)?.[1]?.trim() ?? "";
    const encrypt_value = chunk.match(/"encryption":\s*"([^"]+)"/)?.[1]?.trim() ?? "";
    if (decrypt_value && encrypt_value) return { decrypt_value, encrypt_value };
  }
  throw new Error("Не удалось разобрать вывод xray vlessenc");
}

export function buildVlessAuthPair(
  mode: VlessAuthGenMode,
  decrypt_value: string,
  encrypt_value: string,
): {
  auth_mode: VlessAuthGenMode;
  encrypt_value: string;
  decrypt_value: string;
  encryption: string;
} {
  return {
    auth_mode: mode,
    encrypt_value,
    decrypt_value,
    encryption: encrypt_value,
  };
}

/** Локальный fallback (без xray на сервере) — только для dev; формат 600s/0rtt. */
export function generateVlessAuthPairLocalFallback(mode: VlessAuthGenMode): ReturnType<typeof buildVlessAuthPair> {
  const serverKey = randomToken(32);
  const clientKey = randomToken(32);
  return buildVlessAuthPair(
    mode,
    `mlkem768x25519plus.native.600s.${serverKey}`,
    `mlkem768x25519plus.native.0rtt.${clientKey}`,
  );
}

/** @deprecated Используйте generateRemoteVlessAuthPair через SSH + xray vlessenc. */
export function generateVlessAuthPair(mode: VlessAuthGenMode): ReturnType<typeof buildVlessAuthPair> {
  return generateVlessAuthPairLocalFallback(mode);
}
