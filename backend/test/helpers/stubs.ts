import { vi } from "vitest";
import * as userSync from "../../src/userSync.ts";

export function userSyncMocks() {
  return {
    push: userSync.pushClientListToAllDeployedServers as unknown as ReturnType<typeof vi.fn>,
    remove: userSync.removeUserUuidFromAllServers as unknown as ReturnType<typeof vi.fn>,
    clearSpeed: userSync.clearSpeedLimitsOnAllDeployedServers as unknown as ReturnType<typeof vi.fn>,
  };
}

export function resetUserSyncMocks(): void {
  const m = userSyncMocks();
  m.push.mockClear();
  m.remove.mockClear();
  m.clearSpeed.mockClear();
}
