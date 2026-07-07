// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useStore } from "../src/renderer/src/screens/SpsAgent/store";

// The SPS main area switches between the doc editor and full-area surfaces
// (Cockpit / Insights / Memory / Ask / Agent) via the ui-slice `surface` field.
// App.tsx renders by this value; here we lock the state machine.

afterEach(() => useStore.getState().setSurface("cockpit"));

describe("SPS surface navigation (ui slice)", () => {
  it("defaults to the cockpit surface", () => {
    expect(useStore.getState().surface).toBe("cockpit");
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

  it("opens Content Studio with a pending captured idea", () => {
    const idea = {
      id: "idea-source",
      title: "Captured source idea",
      sourceUrls: ["https://example.com/source"],
      audience: "operators",
      angle: "A source-backed angle",
      createdAt: "2026-06-17",
      updatedAt: "2026-06-17",
      status: "captured" as const,
      capturedFrom: "source-preview",
      rubric: {
        bookmarkability: 1,
        proof: 1,
        immediateUse: 0,
        audienceClarity: 1,
        reproducibility: 0,
        hookStrength: 0,
        originality: 1,
      },
    };

    useStore.getState().openContentStudioIdea(idea);

    expect(useStore.getState().surface).toBe("contentStudio");
    expect(useStore.getState().pendingContentStudioIdea).toEqual(idea);

    useStore.getState().clearPendingContentStudioIdea();
    expect(useStore.getState().pendingContentStudioIdea).toBeNull();
  });
});
