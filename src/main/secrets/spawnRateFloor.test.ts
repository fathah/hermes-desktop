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
vi.mock("./commandProvider", () => ({
  CommandSecretsProvider: class {
    readonly id = "command";
    get(): string | null {
      return null;
    }
    list(): Record<string, string> {
      listCalls++;
      return { VAULT_KEY: `v${listCalls}` };
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
});
