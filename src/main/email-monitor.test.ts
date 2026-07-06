import { beforeEach, describe, expect, it, vi } from "vitest";

// email-monitor now routes borderline mail through ./email-triage → ./gateway-chat.
// Mock the gateway wrapper so the real ./hermes (Electron) module never loads
// under vitest, and so the borderline tests below can script the LLM verdict.
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
  DEFAULT_EMAIL_MONITOR_ACCOUNT,
  handleParsedEmailMessage,
} from "./email-monitor";

describe("handleParsedEmailMessage", () => {
  beforeEach(() => vi.mocked(gatewayChat).mockReset());

  it("counts skipped bulk mail without writing an inbox capture", async () => {
    const writeCapture = vi.fn();
    const writeAsset = vi.fn();

    const result = await handleParsedEmailMessage(
      {
        account: {
          ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
          id: "ops",
          label: "Ops inbox",
          emailAddress: "ops@example.com",
        },
        folder: "INBOX",
        uid: 12,
        message: {
          from: "newsletter@example.com",
          to: "ops@example.com",
          subject: "Weekly deals",
          messageId: "<bulk@example.com>",
          date: new Date("2026-06-25T09:00:00Z"),
          text: "Marketing content",
          headers: {
            "list-unsubscribe": "<mailto:unsubscribe@example.com>",
          },
          attachments: [],
        },
      },
      { vaultDir: "/tmp/vault", writeCapture, writeAsset },
    );

    if (result.status !== "skipped") throw new Error("Expected skipped mail.");
    expect(result.reason).toContain("bulk");
    expect(writeCapture).not.toHaveBeenCalled();
    expect(writeAsset).not.toHaveBeenCalled();
  });

  it("writes relevant mail with triage metadata and bounded attachments", async () => {
    const writeCapture = vi
      .fn()
      .mockResolvedValue({ success: true, id: "cap1" });
    const writeAsset = vi.fn().mockResolvedValue("a".repeat(64) + ".pdf");

    const result = await handleParsedEmailMessage(
      {
        account: {
          ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
          id: "ops",
          label: "Ops inbox",
          emailAddress: "ops@example.com",
          allowSenders: ["client@bluebay.example"],
          importanceKeywords: ["roster"],
        },
        folder: "INBOX",
        uid: 42,
        message: {
          from: "Client <client@bluebay.example>",
          to: "ops@example.com",
          subject: "Bluebay roster change",
          messageId: "<msg-1@example.com>",
          date: new Date("2026-06-25T10:00:00Z"),
          text: "Please update tonight's roster.",
          headers: {},
          attachments: [
            {
              filename: "roster.pdf",
              contentType: "application/pdf",
              size: 1200,
              content: Buffer.from("pdf"),
            },
          ],
        },
      },
      { vaultDir: "/tmp/vault", writeCapture, writeAsset },
    );

    expect(result).toEqual({
      status: "captured",
      captureId: "cap1",
      triageLabel: "action",
    });
    expect(writeAsset).toHaveBeenCalledWith(
      "/tmp/vault",
      Buffer.from("pdf"),
      "pdf",
    );
    expect(writeCapture).toHaveBeenCalledWith(
      "/tmp/vault",
      expect.objectContaining({
        source: "email",
        title: "Bluebay roster change",
        triageLabel: "action",
        emailAccount: "Ops inbox",
        messageId: "<msg-1@example.com>",
        folder: "INBOX",
        uid: 42,
        attachments: [
          {
            assetPath: "a".repeat(64) + ".pdf",
            originalName: "roster.pdf",
            mime: "application/pdf",
            size: 1200,
          },
        ],
      }),
    );
    // A decisive rule verdict never consults the gateway.
    expect(gatewayChat).not.toHaveBeenCalled();
  });

  it("routes borderline mail through the LLM and captures the resolved label", async () => {
    const writeCapture = vi
      .fn()
      .mockResolvedValue({ success: true, id: "cap2" });
    vi.mocked(gatewayChat).mockResolvedValue(
      JSON.stringify({
        capture: true,
        label: "action",
        reason: "A personal request that needs a reply.",
        confidence: 0.82,
      }),
    );

    const result = await handleParsedEmailMessage(
      {
        account: {
          ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
          id: "ops",
          label: "Ops inbox",
          emailAddress: "ops@example.com",
          // Non-matching keywords so the message stays borderline (archive).
          importanceKeywords: ["zzz-no-match"],
        },
        folder: "INBOX",
        uid: 7,
        message: {
          from: "Ravi Menon <ravi@example.net>",
          subject: "Are you free next week?",
          date: new Date("2026-06-25T10:00:00Z"),
          text: "Wanted to grab a coffee and catch up sometime next week.",
          headers: {},
          attachments: [],
        },
      },
      { vaultDir: "/tmp/vault", writeCapture },
    );

    expect(gatewayChat).toHaveBeenCalledTimes(1);
    if (result.status !== "captured") throw new Error("Expected capture.");
    expect(result.triageLabel).toBe("action");
    expect(writeCapture).toHaveBeenCalledWith(
      "/tmp/vault",
      expect.objectContaining({
        triageLabel: "action",
        triageReason: "A personal request that needs a reply.",
        triageConfidence: 0.82,
      }),
    );
  });

  it("drops borderline mail below the account captureThreshold", async () => {
    const writeCapture = vi.fn();
    vi.mocked(gatewayChat).mockResolvedValue(
      JSON.stringify({ capture: true, label: "archive", confidence: 0.3 }),
    );

    const result = await handleParsedEmailMessage(
      {
        account: {
          ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
          id: "ops",
          label: "Ops inbox",
          emailAddress: "ops@example.com",
          importanceKeywords: ["zzz-no-match"],
          captureThreshold: 0.45,
        },
        folder: "INBOX",
        uid: 8,
        message: {
          from: "Ravi Menon <ravi@example.net>",
          subject: "Are you free next week?",
          date: new Date("2026-06-25T10:00:00Z"),
          text: "Wanted to grab a coffee and catch up sometime next week.",
          headers: {},
          attachments: [],
        },
      },
      { vaultDir: "/tmp/vault", writeCapture },
    );

    if (result.status !== "skipped") throw new Error("Expected skip.");
    expect(result.reason).toContain("threshold");
    expect(writeCapture).not.toHaveBeenCalled();
  });
});
