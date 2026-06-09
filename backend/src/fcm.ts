import fs from "node:fs";
import { GoogleAuth } from "google-auth-library";
import { listPanelFcmTokens, removePanelFcmTokens } from "./db.js";

export type PanelPushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function loadServiceAccount(): ServiceAccount | null {
  const path = (process.env.FCM_SERVICE_ACCOUNT_PATH ?? "").trim();
  const raw = (process.env.FCM_SERVICE_ACCOUNT_JSON ?? "").trim();
  try {
    if (path && fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, "utf8")) as ServiceAccount;
    }
    if (raw.startsWith("{")) {
      return JSON.parse(raw) as ServiceAccount;
    }
  } catch (e) {
    console.error("[fcm] service account parse:", e);
  }
  return null;
}

function legacyServerKey(): string | null {
  const key = (process.env.FCM_SERVER_KEY ?? "").trim();
  if (key.startsWith("AAAA") && key.length > 30) return key;
  return null;
}

let authClient: GoogleAuth | null = null;
let authProjectId: string | null = null;

async function getV1AccessToken(): Promise<{ token: string; projectId: string } | null> {
  const sa = loadServiceAccount();
  if (!sa?.project_id || !sa.private_key) return null;
  if (!authClient || authProjectId !== sa.project_id) {
    authClient = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    authProjectId = sa.project_id;
  }
  const client = await authClient.getClient();
  const res = await client.getAccessToken();
  const token = res?.token;
  if (!token) return null;
  return { token, projectId: sa.project_id };
}

async function sendV1One(
  accessToken: string,
  projectId: string,
  deviceToken: string,
  payload: PanelPushPayload,
): Promise<string | null> {
  const data: Record<string, string> = {
    path: "/support-appeals",
    type: "new_appeal",
    title: payload.title,
    body: payload.body,
    ...(payload.data ?? {}),
  };
  for (const k of Object.keys(data)) {
    if (data[k] == null) data[k] = "";
    data[k] = String(data[k]);
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data,
        android: {
          priority: "HIGH",
          notification: {
            channel_id: "support_appeals",
            notification_priority: "PRIORITY_HIGH",
          },
        },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("[fcm] v1 send failed:", res.status, text.slice(0, 400));
    try {
      const j = JSON.parse(text) as { error?: { status?: string; message?: string } };
      const status = j.error?.status ?? "";
      if (
        status === "NOT_FOUND" ||
        status === "INVALID_ARGUMENT" ||
        text.includes("UNREGISTERED") ||
        text.includes("not a valid FCM")
      ) {
        return "stale";
      }
    } catch {
      /* ignore */
    }
    return "error";
  }
  return null;
}

async function sendLegacyChunk(
  key: string,
  tokens: string[],
  payload: PanelPushPayload,
): Promise<string[]> {
  const stale: string[] = [];
  const data: Record<string, string> = {
    path: "/support-appeals",
    type: "new_appeal",
    title: payload.title,
    body: payload.body,
    ...(payload.data ?? {}),
  };
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      registration_ids: tokens,
      priority: "high",
      notification: { title: payload.title, body: payload.body },
      data,
    }),
  });
  const json = (await res.json()) as {
    success?: number;
    failure?: number;
    results?: Array<{ message_id?: string; error?: string }>;
  };
  if (!res.ok) {
    console.error("[fcm] legacy HTTP", res.status, json);
    return stale;
  }
  const results = json.results ?? [];
  for (let j = 0; j < results.length; j++) {
    const err = results[j]?.error;
    if (err === "NotRegistered" || err === "InvalidRegistration" || err === "MismatchSenderId") {
      stale.push(tokens[j]!);
    }
  }
  return stale;
}

export function isFcmConfigured(): boolean {
  return Boolean(loadServiceAccount() || legacyServerKey());
}

/** Отправка push на все зарегистрированные устройства панели. */
export async function sendPanelPushToAll(payload: PanelPushPayload): Promise<void> {
  const tokens = listPanelFcmTokens();
  if (tokens.length === 0) {
    console.warn("[fcm] нет зарегистрированных токенов приложения");
    return;
  }

  const stale: string[] = [];
  const v1 = await getV1AccessToken();
  if (v1) {
    for (const deviceToken of tokens) {
      try {
        const err = await sendV1One(v1.token, v1.projectId, deviceToken, payload);
        if (err === "stale") stale.push(deviceToken);
      } catch (e) {
        console.error("[fcm] v1:", e);
      }
    }
    console.log(`[fcm] v1 sent to ${tokens.length} device(s), stale=${stale.length}`);
  } else {
    const legacy = legacyServerKey();
    if (!legacy) {
      console.warn(
        "[fcm] не настроен: нужен FCM_SERVICE_ACCOUNT_PATH (JSON сервисного аккаунта) или FCM_SERVER_KEY (AAAA...)",
      );
      return;
    }
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      try {
        stale.push(...(await sendLegacyChunk(legacy, chunk, payload)));
      } catch (e) {
        console.error("[fcm] legacy:", e);
      }
    }
    console.log(`[fcm] legacy sent, stale=${stale.length}`);
  }

  if (stale.length > 0) removePanelFcmTokens(stale);
}
