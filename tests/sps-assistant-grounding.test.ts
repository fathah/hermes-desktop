import { describe, it, expect, vi } from "vitest";

// Mock the heavy main-process deps so importing sps-agent is side-effect free.
vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
  isRemoteMode: () => false,
  buildRetrievalSystemMessage: vi.fn(),
}));
vi.mock("../src/main/utils", () => ({
  profileHome: () => "/tmp/profile",
  getActiveProfileNameSync: () => "default",
}));

import { buildSpsAssistantMessages } from "../src/main/sps-agent";

const ctx = {
  pageTitle: "Guard SOP",
  blocks: [{ type: "p", text: "Rest periods are 20 minutes." }],
};

describe("buildSpsAssistantMessages", () => {
  it("is [system, user] with no grounding; user carries the page + request", () => {
    const msgs = buildSpsAssistantMessages(
      "What is the rest period?",
      ctx,
      null,
    );
    expect(msgs.map((m) => m.role)).toEqual(["system", "user"]);
    expect(msgs[1].content).toContain("Guard SOP");
    expect(msgs[1].content).toContain("Rest periods are 20 minutes.");
    expect(msgs[1].content).toContain("What is the rest period?");
  });

  it("inserts grounding AFTER system and BEFORE user (JSON contract stays first)", () => {
    const grounding = {
      role: "system" as const,
      content: "[Handbook · handbook.md] Rest periods are 20 minutes.",
    };
    const msgs = buildSpsAssistantMessages("x", ctx, grounding);
    expect(msgs.map((m) => m.role)).toEqual(["system", "system", "user"]);
    expect(msgs[1]).toBe(grounding);
    // The user turn remains last so the request is the final instruction.
    expect(msgs[2].role).toBe("user");
  });
});
