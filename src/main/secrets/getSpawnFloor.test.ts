import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// S1 (get() side) regression — getSecret()/getSecretSafe spawn-rate floor.
//
// Greptile #644: the list() path is protected by providerListSafe()'s TTL
// cache + MIN_SPAWN_INTERVAL floor, but the single-key get() path called
// `provider.get()` directly. The consumer-wiring PR resolves keys PER KEY at
// gateway-spawn time, so a caller loop (or a buggy/compromised renderer) could
// spawn the command helper once per call — each a SYNCHRONOUS `/bin/sh -c` of
// up to 3s on the Electron main process, wedging the UI.
//
// The fix: route getSecret() through getSecretSafe(), a per-(profile,key) hard
// spawn floor. Unlike list() it caches NO value (no new at-rest secret surface)
// — inside the floor window it DEGRADES to null rather than spawning.

vi.mock("../config", () => ({
  getConfigValue: vi.fn(),
  readEnv: vi.fn(() => ({})),
}));

let getCalls = 0;
// Per-key spawn counter so we can assert independent floors across keys.
const getCallsByKey = new Map<string, number>();
vi.mock("./commandProvider", () => ({
  CommandSecretsProvider: class {
    readonly id = "command";
    get(key: string): string | null {
      getCalls++;
      getCallsByKey.set(key, (getCallsByKey.get(key) ?? 0) + 1);
      // Echo a unique, spawn-counted value so a test can prove it got a FRESH
      // resolution (not a replayed/cached one — there is no cache).
      return `${key}:v${getCalls}`;
    }
    list(): Record<string, string> {
      return {};
    }
  },
}));

// envProvider is the real one — used to prove the env path is a pass-through
// (no floor). Its get() reads readEnv(), which we mock per-test below.
import { getConfigValue, readEnv } from "../config";
import { getSecret, invalidateProviderListCache } from "./index";

const mockedGetConfigValue = vi.mocked(getConfigValue);
const mockedReadEnv = vi.mocked(readEnv);

describe("S1 (get side): getSecret command-provider spawn-rate floor", () => {
  // Monotonic per-test epoch — same rationale as spawnRateFloor.test.ts: the
  // module-level getSpawnFloor map persists across tests, and
  // vi.useFakeTimers() resets the mock clock to real time each test. Jump far
  // forward each test so a timestamp written by a prior test is always past the
  // floor (otherwise time would appear to go backwards and the floor would
  // wrongly bite on the first call of the next test).
  let epoch = 20_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    epoch += 20_000_000;
    vi.setSystemTime(epoch);
    // Default: command provider, no real env keys.
    mockedGetConfigValue.mockImplementation((key: string) =>
      key === "secrets.provider" ? "command" : null,
    );
    mockedReadEnv.mockReturnValue({});
    // process.env must NOT short-circuit getSecret (it checks process.env
    // first). Use key names that won't collide with the real environment.
    delete process.env.S1G_KEY_A;
    delete process.env.S1G_KEY_B;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("repeated get() for one key inside the floor spawns once; rest degrade to null", () => {
    const before = getCalls;
    const first = getSecret("S1G_KEY_A");
    const second = getSecret("S1G_KEY_A");
    const third = getSecret("S1G_KEY_A");
    // Exactly one spawn — the helper ran once.
    expect(getCalls - before).toBe(1);
    // First call resolved the real value; subsequent in-window calls degrade.
    expect(first).toMatch(/^S1G_KEY_A:v\d+$/);
    expect(second).toBeNull();
    expect(third).toBeNull();
  });

  it("does NOT replay a cached value inside the floor (degrade, not stale)", () => {
    const v = getSecret("S1G_KEY_A");
    expect(v).toMatch(/^S1G_KEY_A:v\d+$/);
    // A value cache would return `v` again; this path holds no value, so null.
    expect(getSecret("S1G_KEY_A")).toBeNull();
  });

  it("re-spawns and returns a FRESH value once the floor has elapsed", () => {
    const before = getCalls;
    const first = getSecret("S1G_KEY_A"); // spawn 1
    vi.advanceTimersByTime(1_001); // past MIN_SPAWN_INTERVAL_MS
    const second = getSecret("S1G_KEY_A"); // spawn 2
    expect(getCalls - before).toBe(2);
    expect(first).toMatch(/^S1G_KEY_A:v\d+$/);
    expect(second).toMatch(/^S1G_KEY_A:v\d+$/);
    // Distinct spawns → distinct counted values: proves it's a fresh resolve.
    expect(second).not.toBe(first);
  });

  it("keeps per-key floors independent — one key's floor does not block another", () => {
    const before = getCalls;
    const a = getSecret("S1G_KEY_A"); // spawn for A
    const b = getSecret("S1G_KEY_B"); // spawn for B (different key, own floor)
    expect(getCalls - before).toBe(2);
    expect(a).toMatch(/^S1G_KEY_A:v\d+$/);
    expect(b).toMatch(/^S1G_KEY_B:v\d+$/);
    // A second A inside the floor still degrades; B is unaffected.
    expect(getSecret("S1G_KEY_A")).toBeNull();
  });

  it("invalidateProviderListCache() clears the get floor — next get() spawns now", () => {
    const before = getCalls;
    getSecret("S1G_KEY_A"); // spawn 1, opens floor
    expect(getSecret("S1G_KEY_A")).toBeNull(); // inside floor → degrade
    invalidateProviderListCache(); // "Refresh from vault" clears the floor
    const refreshed = getSecret("S1G_KEY_A"); // floor cleared → spawn 2
    expect(getCalls - before).toBe(2);
    expect(refreshed).toMatch(/^S1G_KEY_A:v\d+$/);
  });

  it("env provider is a pure pass-through — no floor, every get() resolves", () => {
    mockedGetConfigValue.mockImplementation((key: string) =>
      key === "secrets.provider" ? "env" : null,
    );
    mockedReadEnv.mockReturnValue({ S1G_KEY_A: "env-value" });
    const before = getCalls;
    // Repeated reads all return the value; command helper never spawns.
    expect(getSecret("S1G_KEY_A")).toBe("env-value");
    expect(getSecret("S1G_KEY_A")).toBe("env-value");
    expect(getSecret("S1G_KEY_A")).toBe("env-value");
    expect(getCalls - before).toBe(0);
  });

  it("process.env still wins and never spawns the helper (precedence intact)", () => {
    process.env.S1G_KEY_A = "from-process-env";
    const before = getCalls;
    expect(getSecret("S1G_KEY_A")).toBe("from-process-env");
    expect(getCalls - before).toBe(0);
    delete process.env.S1G_KEY_A;
  });

  it("never throws: a throwing getConfigValue degrades to null (Greptile P1)", () => {
    // getSecret() documents "Never throws". getSecretSafe() reaches config via
    // getSecretsProvider() -> getConfigValue(), which can throw on a malformed
    // config.yaml or a first-read I/O error. Without a top-level catch (matching
    // providerListSafe), that exception would propagate out of getSecret() and —
    // once the wiring PR calls it per-key during gateway spawn — abort the whole
    // spawn instead of degrading that one key. Assert it returns null, not throws.
    mockedGetConfigValue.mockImplementation(() => {
      throw new Error("malformed config.yaml");
    });
    expect(() => getSecret("S1G_KEY_A")).not.toThrow();
    expect(getSecret("S1G_KEY_A")).toBeNull();
  });
});
