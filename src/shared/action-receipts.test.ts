import { describe, expect, it } from "vitest";
import {
  normalizeActionReceipt,
  serializeActionReceipt,
} from "./action-receipts";

describe("action receipts", () => {
  it("keeps only redacted receipt fields", () => {
    const receipt = normalizeActionReceipt(
      {
        ts: 1,
        source: "assistant",
        action: "approval",
        outcome: "auto-approved",
        profile: "default",
        summary:
          "Opened https://example.com/private?q=secret with apiKey=sk-proj-abcdefghijklmnop",
        counts: {
          files: 2,
          query: 99,
          bad: Number.NaN,
        },
        refs: [
          {
            kind: "run",
            id: "run-1",
            url: "https://example.com/private",
          },
        ],
        command: "rm -rf /tmp/x",
        url: "https://example.com/private",
        query: "top secret",
        snippet: "raw excerpt",
        content: "payload",
        token: "secret-token",
      },
      () => 123,
    );

    expect(receipt).toEqual({
      ts: 1,
      source: "assistant",
      action: "approval",
      outcome: "auto-approved",
      profile: "default",
      summary: "Opened [redacted-url] with apiKey=[redacted]",
      counts: { files: 2 },
      refs: [{ kind: "run", id: "run-1" }],
    });

    const json = serializeActionReceipt(receipt);
    expect(json).not.toContain("rm -rf");
    expect(json).not.toContain("https://example.com");
    expect(json).not.toContain("top secret");
    expect(json).not.toContain("raw excerpt");
    expect(json).not.toContain("payload");
    expect(json).not.toContain("secret-token");
    expect(json).not.toContain("sk-proj");
  });

  it("fills a timestamp and defaults an empty summary without leaking input text", () => {
    const receipt = normalizeActionReceipt(
      {
        source: "tool",
        action: "progress",
        outcome: "progress",
        summary: "",
        content: "do not persist this",
      },
      () => 42,
    );

    expect(receipt.ts).toBe(42);
    expect(receipt.summary).toBe("(no summary)");
    expect(serializeActionReceipt(receipt)).not.toContain("do not persist");
  });
});
