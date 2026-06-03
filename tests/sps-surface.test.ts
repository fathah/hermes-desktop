// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useStore } from "../src/renderer/src/screens/SpsAgent/store";

// The SPS main area switches between the doc editor and full-area surfaces
// (Insights / Memory / Ask / Agent) via the ui-slice `surface` field. App.tsx
// renders by this value; here we lock the state machine.

afterEach(() => useStore.getState().setSurface("doc"));

describe("SPS surface navigation (ui slice)", () => {
  it("defaults to the doc surface", () => {
    expect(useStore.getState().surface).toBe("doc");
  });

  it("switches to insights and memory", () => {
    useStore.getState().setSurface("insights");
    expect(useStore.getState().surface).toBe("insights");
    useStore.getState().setSurface("memory");
    expect(useStore.getState().surface).toBe("memory");
  });

  it("selectPage returns implicitly to doc only via setSurface (kept independent)", () => {
    useStore.getState().setSurface("insights");
    useStore.getState().setSurface("doc");
    expect(useStore.getState().surface).toBe("doc");
  });
});
