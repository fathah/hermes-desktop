import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Robustness / "unimagined community environment" suite for the command secrets
// provider. These cover two confirmed lock-up / lock-out classes a stranger's
// setup hits that the happy-path suite did not:
//   - T1.1 ORPHAN REAP: a helper that backgrounds a child (locked-vault unlock
//     agent, a `( … ) & wait` pipeline) must not leak that child when the 3s
//     timeout fires. A bare execFileSync SIGTERMs only /bin/sh; the grandchild
//     survives. Reproduced with a real spawn against the live shell.
//   - T1.2 WINDOWS DEAD-END: /bin/sh does not exist on win32, so a configured
//     command provider would silently resolve EVERY key to null. The provider
//     must short-circuit and expose an actionable reason for the UI.

vi.mock("../config", () => ({
  getConfigValue: vi.fn(),
}));
import { getConfigValue } from "../config";
import { CommandSecretsProvider, runHelper } from "./commandProvider";

const mockedGetConfigValue = vi.mocked(getConfigValue);

describe("T1.1 orphan reap: timed-out helper leaves no orphaned grandchild", () => {
  beforeEach(() => {
    mockedGetConfigValue.mockReset();
  });

  it("reaps a backgrounded grandchild when the helper times out (no process leak)", () => {
    // POSIX-only behavior; skip on win32 where the provider short-circuits.
    if (process.platform === "win32") return;
    const marker = join(
      tmpdir(),
      `orphan-reap-${process.pid}-${Date.now()}.txt`,
    );
    if (existsSync(marker)) rmSync(marker);

    // Helper backgrounds a grandchild that, AFTER the 3s timeout, would write
    // a marker — then blocks on `wait` (simulating a locked-vault unlock that
    // never returns). If the grandchild is orphaned, the marker appears.
    const helper = `( sleep 6; echo leaked > ${marker} ) & wait`;
    const r = runHelper(helper, "K");
    // The helper timed out / was killed — it never produced a usable value.
    expect(r.ok).toBe(false);

    // Block synchronously past the grandchild's 6s sleep using a real-time
    // busy wait (these tests run without fake timers). 7s total from helper
    // start: the timeout fired at ~3s, so ~4s more covers the sleep.
    const until = Date.now() + 5000;
    // eslint-disable-next-line no-empty
    while (Date.now() < until) {}

    const leaked = existsSync(marker);
    if (leaked) rmSync(marker);
    expect(leaked).toBe(false); // grandchild was reaped via process-group kill
  }, 15000);
});

describe("T1.2 windows platform gate: no silent dead-end for the command provider", () => {
  const ORIGINAL_PLATFORM = process.platform;

  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", {
      value: p,
      configurable: true,
    });
  }

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    vi.resetModules();
  });

  it("commandProviderUnsupportedReason() returns an actionable string on win32, null elsewhere", async () => {
    // The function reads IS_WINDOWS captured at module load, so re-import the
    // module after stubbing the platform.
    setPlatform("win32");
    vi.resetModules();
    const mod = await import("./commandProvider");
    const reason = mod.commandProviderUnsupportedReason();
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/windows/i);
    // Actionable: it names the safe alternative so the UI can steer the user.
    expect(reason).toMatch(/env provider|\.env/i);

    setPlatform("linux");
    vi.resetModules();
    const modLinux = await import("./commandProvider");
    expect(modLinux.commandProviderUnsupportedReason()).toBeNull();
  });

  it("runHelper short-circuits on win32 without spawning /bin/sh", async () => {
    setPlatform("win32");
    vi.resetModules();
    const mod = await import("./commandProvider");
    const r = mod.runHelper("echo SHOULD_NOT_RUN", "K");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EUNSUPPORTED_PLATFORM");
  });

  it("provider.get()/list() degrade to null/{} on win32 (no throw, no hang)", async () => {
    setPlatform("win32");
    vi.resetModules();
    const mod = await import("./commandProvider");
    const { getConfigValue: gcv } = await import("../config");
    vi.mocked(gcv).mockReturnValue("echo SECRET=value");
    const provider = new mod.CommandSecretsProvider();
    // Configured command, but win32 → resolves nothing rather than wedging.
    expect(() => provider.get("ANY_KEY")).not.toThrow();
    expect(provider.get("ANY_KEY")).toBeNull();
    expect(provider.list()).toEqual({});
  });
});

describe("sanity: the live POSIX path still resolves (guards against over-gating)", () => {
  beforeEach(() => mockedGetConfigValue.mockReset());

  it("on POSIX, a real helper still resolves a value through runHelper", () => {
    if (process.platform === "win32") return;
    mockedGetConfigValue.mockReturnValue('printf "hunter2"');
    const provider = new CommandSecretsProvider();
    expect(provider.get("K")).toBe("hunter2");
  });
});
