import { describe, expect, it, vi } from "vitest";

// Isolated on purpose: this file's gateway mock THROWS. In vitest v4 a
// synchronously-throwing vi.fn cannot coexist with a mockResolvedValue sibling
// in the same file without the throw being surfaced as an uncaught error, so
// the network-down branch of classifyTaskCandidate is proven here alone. The
// resolve/parse cases live in task-triage.test.ts.
vi.mock("./gateway-chat", () => ({
  gatewayChat: vi.fn((): never => {
    throw new Error("gateway unreachable");
  }),
  extractJson: (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  },
}));

import { classifyTaskCandidate } from "./task-triage";
import { SELF_PERSON_ID } from "../shared/contacts";

describe("classifyTaskCandidate (gateway down)", () => {
  it("degrades to the human lane assigned to self, never throwing", async () => {
    const r = await classifyTaskCandidate("do the thing");
    expect(r.route).toBe("human");
    expect(r.assigneeId).toBe(SELF_PERSON_ID);
    expect(r.confidence).toBe(0);
  });
});
