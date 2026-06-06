import { describe, it, expect } from "vitest";
import { BridgeResearch } from "../src/renderer/src/screens/SpsAgent/research/BridgeResearch";
import { MockResearch } from "../src/renderer/src/screens/SpsAgent/research/MockResearch";

// With no window.hermesAPI in jsdom, the bridge calls fail and must fall back to
// MockResearch — exactly like BridgeUnfurl → MockUnfurl. Keeps the UI usable
// offline and lets the smoke harness drive the flow with no network.

describe("MockResearch", () => {
  it("returns sample summaries and filters by query", async () => {
    const mock = new MockResearch();
    const all = await mock.searchWorks("");
    expect(all.length).toBeGreaterThan(0);
    const oa = await mock.searchWorks("open access");
    expect(oa[0].title.toLowerCase()).toContain("open access");
    // summaries carry no abstract field
    expect("abstract" in oa[0]).toBe(false);
  });

  it("getWork returns a full detail with an abstract", async () => {
    const detail = await new MockResearch().getWork("W2741809807");
    expect(detail.id).toBe("W2741809807");
    expect(detail.abstract.length).toBeGreaterThan(0);
  });
});

describe("BridgeResearch fallback", () => {
  it("falls back to Mock when the bridge is unavailable", async () => {
    const bridge = new BridgeResearch();
    const results = await bridge.searchWorks("open access");
    expect(results.length).toBeGreaterThan(0); // came from MockResearch
  });

  it("getWork falls back to Mock when the bridge is unavailable", async () => {
    const detail = await new BridgeResearch().getWork("W2741809807");
    expect(detail.abstract.length).toBeGreaterThan(0);
  });
});
