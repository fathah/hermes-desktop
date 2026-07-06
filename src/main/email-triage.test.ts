import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the gateway wrapper so the real ./hermes (Electron) module never loads
// under vitest, mirroring task-triage.test.ts. extractJson is a faithful-enough
// JSON.parse for these tests.
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
import {
  applyCaptureThreshold,
  isBorderlineRuleVerdict,
  parseEmailTriageResult,
  triageEmailCandidate,
} from "./email-triage";
import {
  DEFAULT_EMAIL_MONITOR_ACCOUNT,
  type EmailMonitorAccount,
  type EmailMonitorCandidate,
  type EmailTriageResult,
} from "../shared/email-monitor";

const RULE: EmailTriageResult = {
  capture: true,
  label: "archive",
  reason: "No strong junk or importance signal; capture for review.",
  confidence: 0.45,
};

// A message with no allow/block/importance/ignore/bulk signal → the rule
// pre-filter lands on the neutral "archive" verdict (the borderline lane).
function borderlineCandidate(): EmailMonitorCandidate {
  return {
    from: "Ravi Menon <ravi@example.net>",
    subject: "Are you free next week?",
    headers: {},
    bodyPreview: "Wanted to grab a coffee and catch up sometime next week.",
  };
}

function account(
  overrides: Partial<EmailMonitorAccount> = {},
): EmailMonitorAccount {
  return {
    ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
    id: "ops",
    label: "Ops inbox",
    emailAddress: "ops@example.com",
    // Force a keyword set that cannot match the borderline fixtures, so the
    // default operational keywords ("site"/"client"/…) don't accidentally make
    // the candidate "important" (decisive) instead of borderline.
    importanceKeywords: ["zzz-no-match"],
    ...overrides,
  };
}

describe("isBorderlineRuleVerdict", () => {
  it("treats a captured archive verdict as borderline", () => {
    expect(isBorderlineRuleVerdict(RULE)).toBe(true);
  });

  it("treats decisive verdicts (allow/important/ignore) as authoritative", () => {
    expect(
      isBorderlineRuleVerdict({ ...RULE, label: "action", confidence: 0.9 }),
    ).toBe(false);
    expect(
      isBorderlineRuleVerdict({
        capture: false,
        label: "ignore",
        reason: "bulk",
        confidence: 0.92,
      }),
    ).toBe(false);
  });
});

describe("parseEmailTriageResult", () => {
  it("keeps a valid gateway verdict", () => {
    const parsed = parseEmailTriageResult(
      {
        capture: true,
        label: "action",
        reason: "Needs a reply.",
        confidence: 0.8,
      },
      RULE,
    );
    expect(parsed).toEqual({
      capture: true,
      label: "action",
      reason: "Needs a reply.",
      confidence: 0.8,
    });
  });

  it("falls back to the rule verdict's fields when the model omits them", () => {
    const parsed = parseEmailTriageResult({ label: "banana" }, RULE);
    expect(parsed.label).toBe(RULE.label);
    expect(parsed.reason).toBe(RULE.reason);
    expect(parsed.confidence).toBe(RULE.confidence);
  });

  it("infers capture from the label when capture is not a boolean", () => {
    expect(parseEmailTriageResult({ label: "ignore" }, RULE).capture).toBe(
      false,
    );
    expect(parseEmailTriageResult({ label: "action" }, RULE).capture).toBe(
      true,
    );
  });

  it("clamps confidence into [0,1]", () => {
    expect(parseEmailTriageResult({ confidence: 5 }, RULE).confidence).toBe(1);
    expect(parseEmailTriageResult({ confidence: -2 }, RULE).confidence).toBe(0);
  });
});

describe("applyCaptureThreshold", () => {
  it("drops a borderline capture below the threshold", () => {
    const dropped = applyCaptureThreshold({ ...RULE, confidence: 0.3 }, 0.45);
    expect(dropped.capture).toBe(false);
    expect(dropped.reason).toContain("threshold");
  });

  it("keeps a capture at or above the threshold", () => {
    expect(
      applyCaptureThreshold({ ...RULE, confidence: 0.6 }, 0.45).capture,
    ).toBe(true);
    expect(applyCaptureThreshold(RULE, 0.45).capture).toBe(true);
  });

  it("never resurrects a skipped verdict", () => {
    const skip: EmailTriageResult = {
      capture: false,
      label: "ignore",
      reason: "bulk",
      confidence: 0.1,
    };
    expect(applyCaptureThreshold(skip, 0.45).capture).toBe(false);
  });
});

describe("triageEmailCandidate", () => {
  beforeEach(() => vi.mocked(gatewayChat).mockReset());

  it("returns a decisive rule verdict without calling the gateway", async () => {
    const result = await triageEmailCandidate(
      {
        from: "client@bluebay.example",
        subject: "Bluebay roster change",
        headers: {},
        bodyPreview: "Please update tonight's roster.",
      },
      account({
        allowSenders: ["client@bluebay.example"],
        importanceKeywords: ["roster"],
      }),
    );
    expect(result.capture).toBe(true);
    expect(result.label).toBe("action");
    expect(gatewayChat).not.toHaveBeenCalled();
  });

  it("resolves a borderline message with the gateway verdict", async () => {
    vi.mocked(gatewayChat).mockResolvedValue(
      JSON.stringify({
        capture: true,
        label: "action",
        reason: "A personal request that needs a reply.",
        confidence: 0.82,
      }),
    );
    const result = await triageEmailCandidate(borderlineCandidate(), account());
    expect(gatewayChat).toHaveBeenCalledTimes(1);
    expect(result.label).toBe("action");
    expect(result.capture).toBe(true);
    expect(result.confidence).toBe(0.82);
  });

  it("applies captureThreshold to the gateway verdict on the borderline lane", async () => {
    vi.mocked(gatewayChat).mockResolvedValue(
      JSON.stringify({ capture: true, label: "archive", confidence: 0.3 }),
    );
    const result = await triageEmailCandidate(
      borderlineCandidate(),
      account({ captureThreshold: 0.45 }),
    );
    expect(result.capture).toBe(false);
    expect(result.reason).toContain("threshold");
  });

  it("degrades to the rule verdict when the gateway returns garbage", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("sorry, I cannot do that");
    const result = await triageEmailCandidate(borderlineCandidate(), account());
    expect(result.capture).toBe(true);
    expect(result.label).toBe("archive");
    expect(result.confidence).toBe(0.45);
  });

  it("wires captureThreshold even in the gateway-garbage fallback", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("nope");
    const result = await triageEmailCandidate(
      borderlineCandidate(),
      account({ captureThreshold: 0.6 }),
    );
    // Rule confidence for the borderline lane is 0.45 < 0.6 → dropped.
    expect(result.capture).toBe(false);
    expect(result.reason).toContain("threshold");
  });
});
