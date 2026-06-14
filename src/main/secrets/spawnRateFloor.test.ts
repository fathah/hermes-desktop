import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// S1 regression — providerListSafe spawn-rate floor.
// A renderer-callable `invalidate-secrets-cache` IPC with no throttle must
// NOT translate into unbounded helper spawns: each command-provider list()
// is a SYNCHRONOUS spawn of up to 3s on the Electron main process, so
// alternating invalidate + status-check from a compromised renderer would
// wedge the UI. The fix: a TTL cache plus a hard MIN_SPAWN_INTERVAL floor
// that survives invalidation (invalidation marks data stale; a re-spawn is
// still refused inside the floor, serving stale data instead).

vi.mock("../config", () => ({
  getConfigValue: vi.fn(),
  readEnv: vi.fn(() => ({})),
}));

let listCalls = 0;
// Controls which keys the mocked vault currently exposes, so a test can
// simulate a HARD DELETION (key removed from the vault) for the AIR-006
// deletion-visibility-window test. Default: the single VAULT_KEY.
let vaultHasKey = true;
vi.mock("./commandProvider", () => ({
  CommandSecretsProvider: class {
    readonly id = "command";
    get(): string | null {
      return null;
    }
    list(): Record<string, string> {
      listCalls++;
      return vaultHasKey ? { VAULT_KEY: `v${listCalls}` } : {};
    }
  },
}));

import { getConfigValue } from "../config";
import {
  providerListSafe,
  invalidateProviderListCache,
  resolvedSecrets,
} from "./index";

const mockedGetConfigValue = vi.mocked(getConfigValue);

describe("S1: providerListSafe helper-spawn rate floor", () => {
  // Monotonic per-test epoch: vi.useFakeTimers() resets the mock clock to
  // real time each test, which would make time go BACKWARDS relative to
  // cache entries written in a previous test (module-level cache persists
  // across tests). Jump far forward each test so stale entries from prior
  // tests are always past the TTL and the spawn floor.
  let epoch = 10_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    epoch += 10_000_000;
    vi.setSystemTime(epoch);
    vaultHasKey = true; // reset deletion-simulation state between tests
    mockedGetConfigValue.mockImplementation((key: string) =>
      key === "secrets.provider" ? "command" : null,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches list() within the TTL — repeated reads spawn the helper once", () => {
    const before = listCalls;
    providerListSafe();
    providerListSafe();
    providerListSafe();
    expect(listCalls - before).toBe(1);
  });

  it("invalidation spam cannot force spawn spam (hard floor holds)", () => {
    const before = listCalls;
    providerListSafe(); // prime: spawn 1
    // Hostile renderer loop: invalidate + read, many times, within the floor.
    for (let i = 0; i < 50; i++) {
      invalidateProviderListCache();
      providerListSafe();
      vi.advanceTimersByTime(10); // 50 × 10ms = 500ms < 1s floor
    }
    // Only the priming spawn happened; stale data was served instead.
    expect(listCalls - before).toBe(1);
  });

  it("invalidation DOES take effect once the spawn floor has elapsed", () => {
    const before = listCalls;
    providerListSafe(); // spawn 1
    invalidateProviderListCache();
    vi.advanceTimersByTime(1_001); // past MIN_SPAWN_INTERVAL_MS
    const refreshed = providerListSafe(); // spawn 2 — stale entry re-resolved
    expect(listCalls - before).toBe(2);
    expect(refreshed.VAULT_KEY).toBe(`v${listCalls}`);
  });

  it("TTL expiry re-spawns without explicit invalidation", () => {
    const before = listCalls;
    providerListSafe(); // spawn 1
    vi.advanceTimersByTime(5_001); // past LIST_CACHE_TTL_MS
    providerListSafe(); // spawn 2
    expect(listCalls - before).toBe(2);
  });

  it("resolvedSecrets() is also covered by the spawn floor (Greptile #644)", () => {
    // Regression: resolvedSecrets() called provider.list() DIRECTLY, bypassing
    // the TTL cache + spawn floor that protect the main process — so a caller
    // polling resolvedSecrets() could re-spawn the helper on every call. It now
    // routes through providerListSafe(), so repeated calls spawn the helper once.
    const before = listCalls;
    resolvedSecrets();
    resolvedSecrets();
    resolvedSecrets();
    expect(listCalls - before).toBe(1);
  });

  // ── AIR-005: exact boundary operators on the list() TTL + spawn floor ──
  // index.ts uses TWO comparisons with DIFFERENT operators on the same
  // thresholds, and the get() floor uses a THIRD. Pin each so a refactor that
  // flips an operator reds a test:
  //   fresh        = now - ts <= LIST_CACHE_TTL_MS      (<=, inclusive at 5000)
  //   spawnAllowed = now - ts >= MIN_SPAWN_INTERVAL_MS  (>=, inclusive at 1000)
  // Catalog: ai-reviewer-findings-catalog.md AIR-005.
  it("AIR-005: list() TTL is inclusive — still fresh at EXACTLY 5000ms (`<=`)", () => {
    const before = listCalls;
    providerListSafe(); // spawn 1, ts = t0
    vi.advanceTimersByTime(5_000); // now - ts == 5000; 5000 <= 5000 -> fresh
    providerListSafe(); // served from cache, no spawn
    expect(listCalls - before).toBe(1);
  });

  it("AIR-005: list() re-spawns one tick past TTL — at 5001ms (boundary is 5000 inclusive)", () => {
    const before = listCalls;
    providerListSafe(); // spawn 1, ts = t0
    vi.advanceTimersByTime(5_001); // now - ts == 5001; not fresh AND spawnAllowed -> spawn
    providerListSafe(); // spawn 2
    expect(listCalls - before).toBe(2);
  });

  it("AIR-005: invalidate + read at EXACTLY 1000ms re-spawns — spawnAllowed `>=` is inclusive", () => {
    const before = listCalls;
    providerListSafe(); // spawn 1, ts = t0
    invalidateProviderListCache(); // marks stale, does NOT reset ts
    vi.advanceTimersByTime(1_000); // now - ts == 1000; 1000 >= 1000 -> spawnAllowed
    providerListSafe(); // stale + spawnAllowed -> spawn 2 (re-resolve)
    expect(listCalls - before).toBe(2);
  });

  it("AIR-005: invalidate + read at 999ms serves stale — one tick INSIDE the floor", () => {
    const before = listCalls;
    const primed = providerListSafe(); // spawn 1, ts = t0
    invalidateProviderListCache();
    vi.advanceTimersByTime(999); // now - ts == 999; 999 >= 1000 is FALSE -> refuse spawn
    const served = providerListSafe(); // stale + !spawnAllowed -> serve stale, no spawn
    expect(listCalls - before).toBe(1);
    // Same stale object served (anti-spam: stale beats wedged).
    expect(served.VAULT_KEY).toBe(primed.VAULT_KEY);
  });

  // ── AIR-006: deletion-visibility window after an explicit "Refresh" ────
  // invalidateProviderListCache() sets stale=true but does NOT reset `ts`, and
  // providerListSafe() serves cached data while !spawnAllowed. So a key that is
  // HARD-DELETED from the vault stays visible to a freshly-spawned gateway for
  // up to MIN_SPAWN_INTERVAL_MS after a "Refresh from vault". This is a
  // DELIBERATE "stale beats wedged" tradeoff (documented in-code) — these tests
  // pin the window to exactly MIN_SPAWN_INTERVAL_MS so a regression widening it
  // reds. Catalog: ai-reviewer-findings-catalog.md AIR-006.
  it("AIR-006: a hard-deleted key stays visible INSIDE the floor after refresh", () => {
    const primed = providerListSafe(); // spawn 1: VAULT_KEY present
    expect(primed.VAULT_KEY).toBeDefined();
    // Operator deletes the key from the vault and hits "Refresh from vault".
    vaultHasKey = false;
    invalidateProviderListCache(); // stale=true, ts unchanged
    vi.advanceTimersByTime(999); // inside MIN_SPAWN_INTERVAL_MS -> refuse re-spawn
    const served = providerListSafe(); // serves STALE data — deleted key still shows
    expect(served.VAULT_KEY).toBeDefined(); // documents the visibility window
  });

  it("AIR-006: the deleted key is gone once the floor elapses (window closes at 1000ms)", () => {
    providerListSafe(); // spawn 1: VAULT_KEY present
    vaultHasKey = false;
    invalidateProviderListCache();
    vi.advanceTimersByTime(1_000); // floor elapsed -> spawnAllowed -> re-resolve
    const refreshed = providerListSafe(); // spawn 2: vault now empty
    expect(refreshed.VAULT_KEY).toBeUndefined(); // deletion now visible
  });

  it("AIR-006: rotation (not deletion) has no data-loss window — value just refreshes", () => {
    // Distinct from deletion: a ROTATED key is present in both old and new
    // vault states, so the only effect of the window is briefly serving the
    // OLD value, never a missing key. Prove the key never disappears.
    const before = providerListSafe(); // spawn 1: v_old
    invalidateProviderListCache(); // rotation: vaultHasKey stays true
    vi.advanceTimersByTime(999);
    const during = providerListSafe(); // inside floor: still the old value
    expect(during.VAULT_KEY).toBe(before.VAULT_KEY);
    vi.advanceTimersByTime(2); // cross the 1000ms floor (999 + 2 = 1001)
    const after = providerListSafe(); // re-resolved: new value, key still present
    expect(after.VAULT_KEY).toBeDefined();
    expect(after.VAULT_KEY).not.toBe(before.VAULT_KEY);
  });
});
