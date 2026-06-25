import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMAIL_MONITOR_ACCOUNT,
  handleParsedEmailMessage,
} from "./email-monitor";

describe("handleParsedEmailMessage", () => {
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
  });
});
