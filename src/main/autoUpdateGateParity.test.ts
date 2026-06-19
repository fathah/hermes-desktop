import { describe, it, expect } from "vitest";
import { isAutoUpdateDisabled as mainReexport } from "./config";
import { isAutoUpdateDisabled as sharedGate } from "../shared/auto-update-gate";

/**
 * Family 2 (sibling-asymmetry / drift guard): the main-process auto-update gate
 * in setupUpdater() and the renderer's "Automatic updates" toggle in
 * Settings.tsx MUST resolve identically for every input. They both consume the
 * SINGLE shared helper (src/shared/auto-update-gate.ts) — config.ts re-exports
 * it for the main side. This pins that they remain the SAME function, so any
 * future divergence (someone reintroducing an inline `=== "false"` copy on
 * either side) reds this test instead of silently shipping a UI/updater
 * disagreement.
 *
 * Lives in src/main (not src/shared) on purpose: importing ./config from a
 * src/shared test would drag the entire node-typed main-process graph into the
 * renderer's web tsconfig (which includes src/shared/**), flipping DOM-vs-Node
 * lib resolution and surfacing unrelated typecheck errors.
 */
describe("auto-update gate — main re-export does not drift from shared helper", () => {
  it("is the exact same function reference (re-export, not a copy)", () => {
    expect(mainReexport).toBe(sharedGate);
  });

  it("agrees with the shared helper across the full input matrix", () => {
    const matrix: unknown[] = [
      null,
      undefined,
      "",
      "   ",
      "false",
      "0",
      "FALSE",
      "  false  ",
      "true",
      "1",
      "random",
      0,
      1,
      false,
      true,
    ];
    for (const v of matrix) {
      expect(mainReexport(v as never)).toBe(sharedGate(v as never));
    }
  });
});
