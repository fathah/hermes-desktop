import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * gpu-fallback drives Electron's hardware-acceleration kill switch. We stub
 * the `electron` module's `app` so the pure decision logic (which env/flag/arg
 * disables the GPU) and the crash-guard relaunch behaviour can be exercised in
 * a plain Node test. Covers the two PR #605 review fixes:
 *   1. HERMES_DISABLE_GPU=0 must override a persisted flag file.
 *   2. A failed flag write must not cause an infinite crash/relaunch loop.
 */

const h = vi.hoisted(() => ({
  state: {
    userData: "",
    relaunchArgs: undefined as string[] | undefined,
    relaunchCount: 0,
    exited: false,
    hwAccelDisabled: false,
    switches: [] as string[],
    handlers: {} as Record<string, (...args: unknown[]) => void>,
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string): string =>
      name === "userData" ? h.state.userData : "",
    disableHardwareAcceleration: (): void => {
      h.state.hwAccelDisabled = true;
    },
    commandLine: {
      appendSwitch: (s: string): void => {
        h.state.switches.push(s);
      },
    },
    relaunch: (opts?: { args?: string[] }): void => {
      h.state.relaunchCount++;
      h.state.relaunchArgs = opts?.args;
    },
    exit: (): void => {
      h.state.exited = true;
    },
    on: (event: string, cb: (...args: unknown[]) => void): void => {
      h.state.handlers[event] = cb;
    },
  },
}));

const SENTINEL = "--hermes-gpu-disabled";
let testHome: string;
let originalArgv: string[];

async function load(): Promise<typeof import("../src/main/gpu-fallback")> {
  vi.resetModules();
  return import("../src/main/gpu-fallback");
}

function flagFile(): string {
  return join(testHome, "disable-gpu.flag");
}

function prefFile(): string {
  return join(testHome, "gpu-preference.json");
}

function writePref(mode: string): void {
  writeFileSync(prefFile(), JSON.stringify({ mode }));
}

function fireGpuCrash(reason = "crashed", exitCode = 9): void {
  h.state.handlers["child-process-gone"]?.(
    {},
    { type: "GPU", reason, exitCode },
  );
}

describe("gpu-fallback", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-gpu-"));
    originalArgv = process.argv;
    process.argv = ["/path/to/app"];
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    h.state.userData = testHome;
    h.state.relaunchArgs = undefined;
    h.state.relaunchCount = 0;
    h.state.exited = false;
    h.state.hwAccelDisabled = false;
    h.state.switches = [];
    h.state.handlers = {};
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("isGpuDisabled is true when the persisted flag file exists", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(true);
  });

  it("a flag older than the TTL no longer disables the GPU", async () => {
    // 25h old — one hour past the 24h TTL.
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(flagFile(), stale);
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(false);
  });

  it("a flag with unparseable content is treated as stale", async () => {
    writeFileSync(flagFile(), "not-a-date");
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(false);
  });

  it("applyGpuPreferences clears a stale flag and keeps hardware acceleration", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(flagFile(), stale);
    const { applyGpuPreferences, installGpuCrashGuard } = await load();

    applyGpuPreferences();
    expect(existsSync(flagFile())).toBe(false);
    expect(h.state.hwAccelDisabled).toBe(false);

    // With the stale flag gone the crash guard must re-arm, so a repeat
    // crash re-persists a fresh flag instead of leaving the machine looping.
    installGpuCrashGuard();
    expect(h.state.handlers["child-process-gone"]).toBeDefined();
    fireGpuCrash();
    expect(existsSync(flagFile())).toBe(true);
  });

  it("ignores and clears a persisted flag on macOS unless fallback is forced", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const { applyGpuPreferences, installGpuCrashGuard, isGpuDisabled } =
      await load();

    expect(isGpuDisabled()).toBe(false);
    applyGpuPreferences();
    expect(existsSync(flagFile())).toBe(false);
    expect(h.state.hwAccelDisabled).toBe(false);

    installGpuCrashGuard();
    expect(h.state.handlers["child-process-gone"]).toBeUndefined();
  });

  it("allows forcing the persistent GPU fallback on macOS", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("HERMES_GPU_FALLBACK", "1");
    const { applyGpuPreferences } = await load();

    applyGpuPreferences();
    expect(h.state.hwAccelDisabled).toBe(true);
    expect(h.state.switches).toContain("disable-gpu");
  });

  it("HERMES_DISABLE_GPU=0 force-enables even when the flag file exists", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    vi.stubEnv("HERMES_DISABLE_GPU", "0");
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(false);
  });

  it("HERMES_DISABLE_GPU=1 force-disables with no flag file", async () => {
    vi.stubEnv("HERMES_DISABLE_GPU", "1");
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(true);
  });

  it("the relaunch sentinel arg disables the GPU", async () => {
    process.argv = ["/path/to/app", SENTINEL];
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(true);
  });

  it("applyGpuPreferences clears the flag file on an explicit force-enable", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    vi.stubEnv("HERMES_DISABLE_GPU", "0");
    const { applyGpuPreferences } = await load();
    applyGpuPreferences();
    expect(existsSync(flagFile())).toBe(false);
    expect(h.state.hwAccelDisabled).toBe(false);
  });

  it("applyGpuPreferences disables hardware acceleration when the flag is set", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    const { applyGpuPreferences } = await load();
    applyGpuPreferences();
    expect(h.state.hwAccelDisabled).toBe(true);
    expect(h.state.switches).toContain("disable-gpu");
  });

  it("the crash guard persists the flag and relaunches with the sentinel arg", async () => {
    const { installGpuCrashGuard } = await load();
    installGpuCrashGuard();
    fireGpuCrash();
    expect(existsSync(flagFile())).toBe(true);
    expect(h.state.relaunchArgs).toContain(SENTINEL);
    expect(h.state.exited).toBe(true);
  });

  it("the crash guard still passes the sentinel when the flag write fails (no loop)", async () => {
    // userData points at a regular file, so mkdir/writeFile for the flag both
    // fail — emulating a read-only/locked filesystem. The relaunch must still
    // carry the sentinel so the next process starts GPU-off.
    const filePath = join(testHome, "not-a-dir");
    writeFileSync(filePath, "x");
    h.state.userData = join(filePath, "nested");
    const { installGpuCrashGuard } = await load();
    installGpuCrashGuard();
    fireGpuCrash();
    expect(h.state.relaunchArgs).toContain(SENTINEL);
    expect(h.state.exited).toBe(true);
  });

  it("the crash guard ignores clean GPU exits and only relaunches once", async () => {
    const { installGpuCrashGuard } = await load();
    installGpuCrashGuard();
    fireGpuCrash("clean-exit", 0);
    expect(h.state.relaunchCount).toBe(0);
    fireGpuCrash();
    fireGpuCrash();
    expect(h.state.relaunchCount).toBe(1);
  });

  it("the crash guard is a no-op when the GPU is already disabled", async () => {
    process.argv = ["/path/to/app", SENTINEL];
    const { installGpuCrashGuard } = await load();
    installGpuCrashGuard();
    expect(h.state.handlers["child-process-gone"]).toBeUndefined();
  });

  it("getGpuStatus reports the flag reason and its timestamp", async () => {
    const writtenAt = new Date().toISOString();
    writeFileSync(flagFile(), writtenAt);
    const { getGpuStatus } = await load();
    expect(getGpuStatus()).toEqual({
      disabled: true,
      reason: "flag",
      flagWrittenAt: writtenAt,
      canReenable: true,
      preference: "auto",
      bootPreference: "auto",
    });
  });

  it("getGpuStatus reports env-forced disable as non-reenableable", async () => {
    vi.stubEnv("HERMES_DISABLE_GPU", "1");
    const { getGpuStatus } = await load();
    const status = getGpuStatus();
    expect(status.disabled).toBe(true);
    expect(status.reason).toBe("env");
    expect(status.canReenable).toBe(false);
  });

  it("getGpuStatus reports enabled when nothing disables the GPU", async () => {
    const { getGpuStatus } = await load();
    expect(getGpuStatus().disabled).toBe(false);
  });

  it("reenableGpuAndRelaunch clears the flag and relaunches without the sentinel", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    process.argv = ["/path/to/app", SENTINEL];
    const { reenableGpuAndRelaunch } = await load();
    expect(reenableGpuAndRelaunch()).toBe(true);
    expect(existsSync(flagFile())).toBe(false);
    expect(h.state.relaunchArgs).not.toContain(SENTINEL);
    expect(h.state.exited).toBe(true);
  });

  it("reenableGpuAndRelaunch refuses when HERMES_DISABLE_GPU=1 forces GPU off", async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    vi.stubEnv("HERMES_DISABLE_GPU", "1");
    const { reenableGpuAndRelaunch } = await load();
    expect(reenableGpuAndRelaunch()).toBe(false);
    expect(existsSync(flagFile())).toBe(true);
    expect(h.state.relaunchCount).toBe(0);
    expect(h.state.exited).toBe(false);
  });

  it('a Settings preference of "off" disables the GPU with no crash flag', async () => {
    writePref("off");
    const { isGpuDisabled, getGpuStatus } = await load();
    expect(isGpuDisabled()).toBe(true);
    const status = getGpuStatus();
    expect(status.reason).toBe("preference");
    expect(status.canReenable).toBe(false);
  });

  it('a Settings preference of "on" ignores a fresh crash flag', async () => {
    writeFileSync(flagFile(), new Date().toISOString());
    writePref("on");
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(false);
  });

  it("the relaunch sentinel outranks a force-on preference (crash-loop protection)", async () => {
    writePref("on");
    process.argv = ["/path/to/app", SENTINEL];
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(true);
  });

  it('HERMES_DISABLE_GPU=0 outranks a Settings preference of "off"', async () => {
    writePref("off");
    vi.stubEnv("HERMES_DISABLE_GPU", "0");
    const { isGpuDisabled } = await load();
    expect(isGpuDisabled()).toBe(false);
  });

  it("a crash under a force-on preference relaunches with the sentinel but persists no flag", async () => {
    writePref("on");
    const { installGpuCrashGuard } = await load();
    installGpuCrashGuard();
    fireGpuCrash();
    expect(existsSync(flagFile())).toBe(false);
    expect(h.state.relaunchArgs).toContain(SENTINEL);
    expect(h.state.exited).toBe(true);
  });

  it("setGpuPreference round-trips and a malformed file falls back to auto", async () => {
    const { setGpuPreference, getGpuPreference } = await load();
    expect(getGpuPreference()).toBe("auto");
    expect(setGpuPreference("off")).toBe(true);
    expect(getGpuPreference()).toBe("off");
    writeFileSync(prefFile(), "{corrupt");
    expect(getGpuPreference()).toBe("auto");
  });

  it("getGpuStatus reports a pending preference change against the boot value", async () => {
    const { applyGpuPreferences, setGpuPreference, getGpuStatus } =
      await load();
    applyGpuPreferences(); // captures bootPreference = "auto"
    setGpuPreference("off");
    const status = getGpuStatus();
    expect(status.preference).toBe("off");
    expect(status.bootPreference).toBe("auto");
  });
});
