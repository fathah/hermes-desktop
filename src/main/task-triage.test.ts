import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the gateway wrapper so the real ./hermes (Electron) module never loads
// under vitest. extractJson is a faithful-enough JSON.parse for these tests.
vi.mock("./gateway-chat", () => ({
  gatewayChat: vi.fn(),
  extractJson: (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  },
}));

import { gatewayChat } from "./gateway-chat";
import { classifyTaskCandidate, parseTriageResult } from "./task-triage";
import { SELF_PERSON_ID } from "../shared/contacts";

const KNOWN = new Set(["you", "p-wife", "p-secretary"]);

describe("parseTriageResult", () => {
  it("defaults an unknown route to the human lane", () => {
    const r = parseTriageResult({ route: "banana" }, KNOWN);
    expect(r.route).toBe("human");
  });

  it("never nags an AI-lane task, even if the model suggests a cadence", () => {
    const r = parseTriageResult({ route: "ai", nagCadence: "daily" }, KNOWN);
    expect(r.nagCadence).toBe("none");
  });

  it("keeps a known assignee but falls back to self otherwise", () => {
    expect(parseTriageResult({ assigneeId: "p-wife" }, KNOWN).assigneeId).toBe(
      "p-wife",
    );
    expect(parseTriageResult({ assigneeId: "p-ghost" }, KNOWN).assigneeId).toBe(
      SELF_PERSON_ID,
    );
  });

  it("accepts a valid ISO due date and drops a malformed one", () => {
    expect(parseTriageResult({ due: "2026-07-01" }, KNOWN).due).toBe(
      "2026-07-01",
    );
    expect(
      parseTriageResult({ due: "next tuesday" }, KNOWN).due,
    ).toBeUndefined();
  });

  it("clamps confidence into [0,1] and coerces risky", () => {
    const r = parseTriageResult({ confidence: 5, risky: "yes" }, KNOWN);
    expect(r.confidence).toBe(1);
    expect(r.risky).toBe(false); // only literal `true` counts as risky
    expect(parseTriageResult({ risky: true }, KNOWN).risky).toBe(true);
  });
});

describe("classifyTaskCandidate", () => {
  beforeEach(() => vi.mocked(gatewayChat).mockReset());

  it("returns the fallback for empty text without calling the gateway", async () => {
    const r = await classifyTaskCandidate("   ");
    expect(r.route).toBe("human");
    expect(r.assigneeId).toBe(SELF_PERSON_ID);
    expect(gatewayChat).not.toHaveBeenCalled();
  });

  it("parses a well-formed gateway response", async () => {
    vi.mocked(gatewayChat).mockResolvedValue(
      JSON.stringify({
        route: "human",
        risky: false,
        due: "2026-07-04",
        nagCadence: "weekly",
        assigneeId: "p-secretary",
        confidence: 0.8,
      }),
    );
    const r = await classifyTaskCandidate("ask secretary for the lease scan", {
      persons: [{ id: "p-secretary", name: "Asha" }],
    });
    expect(r.route).toBe("human");
    expect(r.assigneeId).toBe("p-secretary");
    expect(r.due).toBe("2026-07-04");
    expect(r.nagCadence).toBe("weekly");
  });

  // The gateway-throws / network-down path lives in task-triage-network.test.ts:
  // a synchronously-throwing vi.fn and a mockResolvedValue sibling can't coexist
  // in one file (a vitest spy-state quirk surfaces the throw as uncaught), so it
  // is isolated there.

  it("degrades to the human lane when the gateway returns garbage", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("sorry, I can't help with that");
    const r = await classifyTaskCandidate("do the thing");
    expect(r.route).toBe("human");
    expect(r.assigneeId).toBe(SELF_PERSON_ID);
  });
});
