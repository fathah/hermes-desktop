import { describe, expect, it } from "vitest";
import {
  formatSpsPulseLine,
  normalizeSpsPulse,
  parseSpsPulseLine,
} from "./sps-pulse";

describe("SPS pulses", () => {
  it("normalizes to a tiny content-free pulse shape", () => {
    const pulse = normalizeSpsPulse(
      {
        ts: "2026-06-26T00:00:00.000Z",
        source: "wiki",
        kind: "ingest",
        summary:
          "Filed 3 captures from https://example.com/private and token=abcdefghijklmnop",
        refs: [
          {
            kind: "page",
            id: "capture-1",
            url: "https://example.com/private",
          },
        ],
        content: "raw payload",
      },
      () => "2026-06-26T01:00:00.000Z",
    );

    expect(pulse).toEqual({
      ts: "2026-06-26T00:00:00.000Z",
      source: "wiki",
      kind: "ingest",
      summary: "Filed 3 captures from [redacted-url] and token=[redacted]",
      refs: [{ kind: "page", id: "capture-1" }],
    });
    expect(JSON.stringify(pulse)).not.toContain("raw payload");
    expect(JSON.stringify(pulse)).not.toContain("https://example.com");
  });

  it("round-trips markdown pulse lines", () => {
    const pulse = normalizeSpsPulse({
      ts: "2026-06-26T00:00:00.000Z",
      source: "wiki",
      kind: "lint",
      summary: "Checked links",
      refs: [{ kind: "page", id: "Log" }],
    });

    const line = formatSpsPulseLine(pulse);
    expect(line).toBe(
      "- 2026-06-26T00:00:00.000Z | wiki/lint | Checked links | refs: page:Log",
    );
    expect(parseSpsPulseLine(line)).toEqual(pulse);
  });
});
