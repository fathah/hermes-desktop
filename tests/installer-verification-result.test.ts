// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("fs", async (original) => ({
  ...(await original<typeof import("fs")>()),
  existsSync: () => true,
}));
vi.mock("../src/main/askpass", () => ({ setupAskpass: async () => null }));
vi.mock("../src/main/sudoCreds", () => ({
  precacheSudoCredentials: async () => ({
    ok: true,
    cancelled: false,
    stop: vi.fn(),
  }),
}));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: vi.fn(),
  getModelConfig: vi.fn(),
  hasOAuthCredentials: vi.fn(),
}));
vi.mock("child_process", async (original) => {
  const { EventEmitter } = await import("events");
  return {
    ...(await original<typeof import("child_process")>()),
    spawn: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 87));
      return child;
    },
  };
});

import { runInstall } from "../src/main/installer";

describe("installer verification result", () => {
  it.skipIf(process.platform === "win32")(
    "rejects verification failure even when previous binaries exist",
    async () => {
      const progress = vi.fn();
      await expect(runInstall(progress)).rejects.toThrow("verification failed");
      expect(progress.mock.calls.at(-1)?.[0].log).not.toContain(
        "installed successfully",
      );
    },
  );
});
