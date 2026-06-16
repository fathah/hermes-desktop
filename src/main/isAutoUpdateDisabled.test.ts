import { describe, it, expect } from "vitest";
import { isAutoUpdateDisabled } from "./config";

/**
 * Auto-updater opt-out gate (desktop.auto_update). The contract that MUST hold
 * for the community: auto-update is ENABLED BY DEFAULT. Only an explicit falsey
 * config value disables it; null/unset/empty/garbage all keep it ON so the
 * upstream behavior is unchanged for anyone who never sets the key. The opt-out
 * exists only so a user running a locally-built/patched /opt artifact can stop
 * electron-updater from overwriting their build on quit. setupUpdater() consumes
 * this decision; these pin its contract without the Electron/IPC coupling.
 */
describe("isAutoUpdateDisabled — auto-update opt-out gate (default ON)", () => {
  it("stays ENABLED by default: null / unset keeps auto-update on", () => {
    expect(isAutoUpdateDisabled(null)).toBe(false);
  });

  it("stays ENABLED for empty / whitespace-only settings", () => {
    for (const v of ["", "   ", "\t", "\n"]) {
      expect(isAutoUpdateDisabled(v)).toBe(false);
    }
  });

  it("is DISABLED only by an explicit falsey value", () => {
    for (const v of ["false", "0"]) {
      expect(isAutoUpdateDisabled(v)).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive for the disable values", () => {
    for (const v of ["False", "FALSE", "  false  ", " 0 ", "fAlSe\n"]) {
      expect(isAutoUpdateDisabled(v)).toBe(true);
    }
  });

  it("treats any truthy / unrecognized value as ENABLED (fail-safe to upstream default)", () => {
    // Anything that isn't an explicit disable keeps updates ON — a typo in the
    // config must never silently disable updates for a community user.
    for (const v of [
      "true",
      "1",
      "yes",
      "on",
      "enabled",
      "no",
      "off",
      "disable",
      "  random  ",
    ]) {
      expect(isAutoUpdateDisabled(v)).toBe(false);
    }
  });
});
