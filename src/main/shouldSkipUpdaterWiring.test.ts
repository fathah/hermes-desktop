import { describe, it, expect } from "vitest";
import { shouldSkipUpdaterWiring, isAutoUpdateDisabled } from "./config";

/**
 * The updater WIRING gate. isAutoUpdateDisabled() decides whether the user
 * opted out; shouldSkipUpdaterWiring() decides whether setupUpdater() must take
 * the early-return path that registers no-op IPC handlers and NEVER reaches
 * `autoUpdater.autoDownload = true` / `autoInstallOnAppQuit = true`. That early
 * return is the actual protection the opt-out exists for — so it gets its own
 * adversarial truth-table test, not just the decision function's.
 *
 * Contract: skip wiring (return true) iff NOT packaged OR portable OR the
 * user disabled auto-update. Only a packaged, non-portable, NOT-disabled build
 * wires the real updater (return false).
 */
describe("shouldSkipUpdaterWiring — the updater wiring gate", () => {
  // The ONLY input combination that wires the real electron-updater.
  it("wires the updater ONLY for a packaged, non-portable, enabled build", () => {
    expect(
      shouldSkipUpdaterWiring({
        isPackaged: true,
        isPortableBuild: false,
        autoUpdateDisabled: false,
      }),
    ).toBe(false);
  });

  // Full truth table over the three booleans (2^3 = 8 rows). Every row EXCEPT
  // the one above must skip. This pins the exact gate — a regression that drops
  // any of the three skip conditions reds here.
  it("skips wiring for every other combination (full truth table)", () => {
    const rows: Array<[boolean, boolean, boolean, boolean]> = [
      // isPackaged, isPortable, disabled  => expected skip?
      [false, false, false, true], // dev mode
      [false, false, true, true], // dev + disabled
      [false, true, false, true], // dev + portable
      [false, true, true, true], // dev + portable + disabled
      [true, false, true, true], // packaged, disabled  <-- the opt-out path
      [true, true, false, true], // packaged portable
      [true, true, true, true], // packaged portable disabled
    ];
    for (const [isPackaged, isPortableBuild, autoUpdateDisabled, skip] of rows) {
      expect(
        shouldSkipUpdaterWiring({ isPackaged, isPortableBuild, autoUpdateDisabled }),
      ).toBe(skip);
    }
  });

  // The safety-critical case stated explicitly: a packaged production build
  // whose user set desktop.auto_update:false MUST skip wiring (so the updater
  // can never overwrite their patched /opt artifact on quit).
  it("a packaged build with the opt-out set SKIPS wiring (the whole point)", () => {
    expect(
      shouldSkipUpdaterWiring({
        isPackaged: true,
        isPortableBuild: false,
        autoUpdateDisabled: true,
      }),
    ).toBe(true);
  });

  // End-to-end with the real decision function: the config value flows through
  // isAutoUpdateDisabled into the wiring gate, on a packaged non-portable build.
  // "false"/"0" => skip; anything else => wire. Pins that the two gates compose
  // the way setupUpdater() composes them.
  it("composes with isAutoUpdateDisabled on a packaged build", () => {
    const gate = (raw: string | null) =>
      shouldSkipUpdaterWiring({
        isPackaged: true,
        isPortableBuild: false,
        autoUpdateDisabled: isAutoUpdateDisabled(raw),
      });
    // Opt-out values skip wiring.
    expect(gate("false")).toBe(true);
    expect(gate("0")).toBe(true);
    expect(gate("  FALSE  ")).toBe(true);
    // Default / unset / garbage keep auto-update ON => wire the updater (fail
    // safe to upstream behavior; a config typo never silently disables updates).
    expect(gate(null)).toBe(false);
    expect(gate("")).toBe(false);
    expect(gate("true")).toBe(false);
    expect(gate("yes")).toBe(false);
    expect(gate("garbage")).toBe(false);
  });
});
