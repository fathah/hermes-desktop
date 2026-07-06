import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_MONITOR_CONFIG,
  applyEmailMonitorFeedback,
  classifyEmailCandidate,
  normalizeEmailMonitorConfig,
  shouldMonitorFolder,
} from "./email-monitor";

describe("email monitor triage", () => {
  it("excludes junk-style folders by default", () => {
    expect(shouldMonitorFolder("INBOX")).toBe(true);
    expect(shouldMonitorFolder("Clients/Bluebay")).toBe(true);
    expect(shouldMonitorFolder("Spam")).toBe(false);
    expect(shouldMonitorFolder("Junk Email")).toBe(false);
    expect(shouldMonitorFolder("Promotions")).toBe(false);
    expect(shouldMonitorFolder("Trash")).toBe(false);
  });

  it("skips obvious bulk mail when no important rule matches", () => {
    const result = classifyEmailCandidate(
      {
        from: "newsletter@example.com",
        subject: "Weekly deals",
        headers: {
          "list-unsubscribe": "<mailto:unsubscribe@example.com>",
          precedence: "bulk",
        },
      },
      DEFAULT_EMAIL_MONITOR_CONFIG.accounts[0],
    );

    expect(result.capture).toBe(false);
    expect(result.label).toBe("ignore");
    expect(result.reason).toContain("bulk");
  });

  it("lets allowlisted business senders override bulk-like headers", () => {
    const account = {
      ...DEFAULT_EMAIL_MONITOR_CONFIG.accounts[0],
      allowSenders: ["client@bluebay.example"],
      importanceKeywords: ["roster", "incident"],
    };

    const result = classifyEmailCandidate(
      {
        from: "Client <client@bluebay.example>",
        subject: "Bluebay roster change",
        headers: { "list-unsubscribe": "<mailto:unsubscribe@example.com>" },
      },
      account,
    );

    expect(result.capture).toBe(true);
    expect(result.label).toBe("action");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.reason).toContain("allowlisted sender");
  });

  it("does not fire an importance keyword on a substring (whole-word match)", () => {
    // "coincidentally" contains the substring "incident" but is not the word.
    const result = classifyEmailCandidate(
      {
        from: "sam@example.com",
        subject: "Coincidentally, I'll be traveling next week",
        headers: {},
      },
      DEFAULT_EMAIL_MONITOR_CONFIG.accounts[0],
    );

    expect(result.label).not.toBe("urgent");
    expect(result.reason).not.toContain("important keyword");
  });

  it("captures a genuine incident alert even when it carries bulk headers", () => {
    // Monitoring/alerting systems commonly set Auto-Submitted; importance must
    // win over the bulk-mail gate rather than being silently dropped.
    const result = classifyEmailCandidate(
      {
        from: "alerts@monitoring.example",
        subject: "Incident: site alarm triggered",
        headers: { "auto-submitted": "auto-generated" },
      },
      DEFAULT_EMAIL_MONITOR_CONFIG.accounts[0],
    );

    expect(result.capture).toBe(true);
    expect(result.label).toBe("urgent");
    expect(result.reason).toContain("important keyword");
  });

  it("captures uncertain mail for review with a low confidence reason", () => {
    const result = classifyEmailCandidate(
      {
        from: "sam@example.com",
        subject: "Can you check this?",
        headers: {},
      },
      DEFAULT_EMAIL_MONITOR_CONFIG.accounts[0],
    );

    expect(result.capture).toBe(true);
    expect(result.label).toBe("archive");
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.reason).toContain("review");
  });

  it("normalizes account defaults and clamps capture threshold", () => {
    const config = normalizeEmailMonitorConfig({
      accounts: [
        {
          id: "ops",
          label: "Ops",
          emailAddress: "ops@example.com",
          imapHost: "imap.example.com",
          folders: ["INBOX", "Spam", ""],
          captureThreshold: 3,
        },
      ],
    });

    expect(config.accounts[0]).toMatchObject({
      id: "ops",
      label: "Ops",
      enabled: false,
      folders: ["INBOX"],
      captureThreshold: 1,
      maxMessageBytes: DEFAULT_EMAIL_MONITOR_CONFIG.accounts[0].maxMessageBytes,
    });
  });

  it("turns feedback actions into account-level rules", () => {
    const config = normalizeEmailMonitorConfig({
      accounts: [
        {
          id: "ops",
          label: "Ops",
          emailAddress: "ops@example.com",
          imapHost: "imap.example.com",
        },
      ],
    });

    const ignored = applyEmailMonitorFeedback(config, {
      accountId: "ops",
      action: "ignore-sender",
      sender: "Noisy <noise@example.com>",
    });
    expect(ignored.accounts[0].blockSenders).toContain("noise@example.com");

    const captured = applyEmailMonitorFeedback(ignored, {
      accountId: "ops",
      action: "always-capture-sender",
      sender: "Client <client@example.com>",
    });
    expect(captured.accounts[0].allowSenders).toContain("client@example.com");
  });
});
