import { describe, it, expect } from "vitest";
import { isAutoUpdateDisabled } from "./auto-update-gate";

/**
 * Auto-updater opt-out gate (desktop.auto_update). The contract that MUST hold
 * for the community: auto-update is ENABLED BY DEFAULT. Only an explicit falsey
 * config value disables it; null/unset/empty/garbage all keep it ON so the
 * upstream behavior is unchanged for anyone who never sets the key. The opt-out
 * exists only so a user running a locally-built/patched /opt artifact can stop
 * electron-updater from overwriting their build on quit.
 *
 * This is the SINGLE SOURCE OF TRUTH consumed by both the main-process gate in
 * setupUpdater() (via config.ts re-export) and the renderer's "Automatic
 * updates" toggle in Settings.tsx — so the two CANNOT drift.
 */
describe("isAutoUpdateDisabled — auto-update opt-out gate (default ON)", () => {
  it("stays ENABLED by default: null / undefined / unset keeps auto-update on", () => {
    expect(isAutoUpdateDisabled(null)).toBe(false);
    expect(isAutoUpdateDisabled(undefined)).toBe(false);
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

  // Family 3 (adversarial input) + non-string coercion: the renderer passes the
  // raw `unknown` from getConfig() straight in, so a non-string value must not
  // throw and must fail safe to ENABLED.
  it("coerces non-string inputs safely and never throws (fails to ENABLED)", () => {
    for (const v of [0, 1, true, false, {}, [], 123, () => "false"]) {
      // The contract is keyed on the STRING config representation; arbitrary
      // runtime types must not disable updates or crash the read.
      expect(() => isAutoUpdateDisabled(v as unknown)).not.toThrow();
    }
    // The two values whose String() coercion equals an explicit disable token
    // are the only non-string inputs that legitimately disable:
    expect(isAutoUpdateDisabled(0 as unknown)).toBe(true); // String(0) === "0"
    expect(isAutoUpdateDisabled(false as unknown)).toBe(true); // String(false) === "false"
    // Everything else stays ON.
    expect(isAutoUpdateDisabled(1 as unknown)).toBe(false);
    expect(isAutoUpdateDisabled(true as unknown)).toBe(false);
    expect(isAutoUpdateDisabled({} as unknown)).toBe(false);
  });

  // Family 8 (state / round-trip idempotency): the renderer toggle WRITES
  // `enabled ? "true" : "false"` to config.yaml (Settings.tsx), then on the
  // next load READS it back through this gate. Pin that write vocabulary
  // against the read vocabulary so a future change to the toggle's written
  // values (e.g. "1"/"0", "on"/"off") can't silently desync the displayed
  // state from the updater's actual behavior.
  it("round-trips the renderer's write vocabulary ('true'/'false') correctly", () => {
    // enabled=true  => writes "true"  => reads back as NOT disabled (ON)
    expect(isAutoUpdateDisabled("true")).toBe(false);
    // enabled=false => writes "false" => reads back as disabled (OFF)
    expect(isAutoUpdateDisabled("false")).toBe(true);
  });
});
