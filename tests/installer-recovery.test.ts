// @vitest-environment node
import { EventEmitter } from "events";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  code: 1 as number | null,
  installed: false,
}));
vi.mock("fs", async (original) => ({
  ...(await original<typeof import("fs")>()),
  existsSync: () => state.installed,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
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
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    queueMicrotask(() => {
      child.stderr.emit(
        "data",
        Buffer.from("Actual failing installer command\n"),
      );
      child.emit("close", state.code);
    });
    return child;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  state.installed = false;
});

// @lat: [[dashboard-shutdown#Installer recovery follows the platform]]
it.each(["linux", "darwin", "win32"] as const)(
  "routes an actual %s installer failure to appropriate safe recovery guidance",
  async (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    vi.resetModules();
    state.code = 259;
    const { runInstall } = await import("../src/main/installer");
    const progress = vi.fn();
    let message = "";
    try {
      await runInstall(progress);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("exit code 259");
    expect(message).toContain(
      platform === "win32" ? "open PowerShell" : "open a terminal",
    );
    expect(message).toContain("Check the installation log");
    expect(message).toContain("Keep existing Hermes configuration");
    expect(message).not.toMatch(
      /Remove-Item|rm -rf|path is too long|Administrator|Set-ExecutionPolicy|\| iex/,
    );
    expect(progress.mock.calls.at(-1)?.[0].log).toContain(
      "Actual failing installer command",
    );
  },
);

it("does not invent a normal exit code when the installer was interrupted", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  vi.resetModules();
  state.code = null;
  const { runInstall } = await import("../src/main/installer");
  await expect(runInstall(vi.fn())).rejects.toThrow(
    "Installation was interrupted",
  );
});
