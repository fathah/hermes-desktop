import { describe, expect, it, vi } from "vitest";

// Isolated on purpose (see task-triage-network.test.ts): this file's gateway
// mock THROWS. In vitest a synchronously-throwing vi.fn cannot coexist with a
// mockResolvedValue sibling in the same file, so the gateway-down branch of
// triageEmailCandidate is proven here alone.
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

import { triageEmailCandidate } from "./email-triage";
import {
  DEFAULT_EMAIL_MONITOR_ACCOUNT,
  type EmailMonitorCandidate,
} from "../shared/email-monitor";

const CANDIDATE: EmailMonitorCandidate = {
  from: "Ravi Menon <ravi@example.net>",
  subject: "Are you free next week?",
  headers: {},
  bodyPreview: "Wanted to grab a coffee and catch up sometime next week.",
};

describe("triageEmailCandidate (gateway down)", () => {
  it("degrades to the rule verdict, never throwing", async () => {
    const result = await triageEmailCandidate(CANDIDATE, {
      ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
      id: "ops",
      emailAddress: "ops@example.com",
      importanceKeywords: ["zzz-no-match"],
    });
    expect(result.capture).toBe(true);
    expect(result.label).toBe("archive");
    expect(result.confidence).toBe(0.45);
  });
});
