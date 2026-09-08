import { vi } from "vitest";

vi.mock("../src/userSync.ts", () => ({
  pushClientListToAllDeployedServers: vi.fn(async () => undefined),
  removeUserUuidFromAllServers: vi.fn(async () => undefined),
  refreshSpeedLimitsOnAllDeployedServers: vi.fn(async () => undefined),
  resolveConfigPath: vi.fn(async () => "/tmp/fake-xray.json"),
  managedClientsForServer: vi.fn(() => []),
}));

vi.mock("../src/telegram/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telegram/api.js")>();
  return {
    ...actual,
    sendTelegramMessage: vi.fn(async () => ({ ok: true })),
    sendTelegramHtml: vi.fn(async () => ({ ok: true })),
    sendTelegramPhoto: vi.fn(async () => ({ ok: true })),
    sendTelegramPhotoBinary: vi.fn(async () => ({ ok: true })),
    editMessageText: vi.fn(async () => ({ ok: true })),
    editMessageCaption: vi.fn(async () => ({ ok: true })),
    editTelegramReplyMarkup: vi.fn(async () => ({ ok: true })),
  };
});
