import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  serializeRecord,
  parseUsageLines,
  aggregateUsage,
  dayKey,
  recordUsage,
  readUsageRecords,
  getUsageStats,
  type UsageRecord,
} from "../src/main/usage-store";

// ─── pure core: parse / serialize ───────────────────────

describe("parseUsageLines", () => {
  it("round-trips a serialized record", () => {
    const rec: UsageRecord = {
      ts: 1_700_000_000_000,
      sessionId: "s1",
      model: "anthropic/claude-opus-4.6",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.0023,
      cacheRead: 80,
      cacheWrite: 20,
    };
    const parsed = parseUsageLines(serializeRecord(rec));
    expect(parsed).toEqual([rec]);
  });

  it("skips blank lines and corrupt JSON", () => {
    const text = [
      JSON.stringify({
        ts: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      }),
      "",
      "not-json{",
      "   ",
      JSON.stringify({
        ts: 2,
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      }),
    ].join("\n");
    const parsed = parseUsageLines(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].ts).toBe(1);
    expect(parsed[1].totalTokens).toBe(7);
  });

  it("drops records missing required numeric fields", () => {
    const text = [
      JSON.stringify({ ts: "nope", promptTokens: 1 }),
      JSON.stringify({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }), // no ts
      JSON.stringify({ ts: 5, completionTokens: 1, totalTokens: 1 }), // no promptTokens
      42, // not an object
    ]
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n");
    expect(parseUsageLines(text)).toEqual([]);
  });

  it("normalizes optional fields to undefined when invalid", () => {
    const text = JSON.stringify({
      ts: 1,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      cost: "free",
      sessionId: 99,
    });
    const [rec] = parseUsageLines(text);
    expect(rec.cost).toBeUndefined();
    expect(rec.sessionId).toBeUndefined();
  });
});

// ─── pure core: aggregation ─────────────────────────────

describe("aggregateUsage", () => {
  const recs: UsageRecord[] = [
    {
      ts: Date.parse("2026-06-01T08:00:00Z"),
      sessionId: "a",
      model: "opus",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.01,
    },
    {
      ts: Date.parse("2026-06-01T20:00:00Z"),
      sessionId: "a",
      model: "opus",
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
      cost: 0.02,
    },
    {
      ts: Date.parse("2026-06-02T09:00:00Z"),
      sessionId: "b",
      model: "sonnet",
      promptTokens: 40,
      completionTokens: 10,
      totalTokens: 50,
      cost: 0.001,
    },
  ];

  it("computes overall totals", () => {
    const { totals } = aggregateUsage(recs);
    expect(totals.turns).toBe(3);
    expect(totals.promptTokens).toBe(340);
    expect(totals.completionTokens).toBe(160);
    expect(totals.totalTokens).toBe(500);
    expect(totals.cost).toBeCloseTo(0.031, 6);
  });

  it("breaks down by model", () => {
    const { byModel } = aggregateUsage(recs);
    expect(byModel.opus.turns).toBe(2);
    expect(byModel.opus.totalTokens).toBe(450);
    expect(byModel.sonnet.turns).toBe(1);
  });

  it("breaks down by UTC day", () => {
    const { byDay } = aggregateUsage(recs);
    expect(Object.keys(byDay).sort()).toEqual(["2026-06-01", "2026-06-02"]);
    expect(byDay["2026-06-01"].turns).toBe(2);
  });

  it("breaks down by session", () => {
    const { bySession } = aggregateUsage(recs);
    expect(bySession.a.turns).toBe(2);
    expect(bySession.b.turns).toBe(1);
  });

  it("buckets records with no model under 'unknown'", () => {
    const { byModel } = aggregateUsage([
      { ts: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    ]);
    expect(byModel.unknown.turns).toBe(1);
  });

  it("reports cacheHitRatio only when cache data is present", () => {
    expect(aggregateUsage(recs).cacheHitRatio).toBeUndefined();
    const withCache: UsageRecord[] = [
      {
        ts: 1,
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        cacheRead: 300,
      },
    ];
    expect(aggregateUsage(withCache).cacheHitRatio).toBeCloseTo(300 / 400, 6);
  });

  it("handles an empty dataset", () => {
    const agg = aggregateUsage([]);
    expect(agg.totals.turns).toBe(0);
    expect(agg.byModel).toEqual({});
    expect(agg.cacheHitRatio).toBeUndefined();
  });
});

describe("dayKey", () => {
  it("formats a UTC date", () => {
    expect(dayKey(Date.parse("2026-06-03T23:59:59Z"))).toBe("2026-06-03");
  });
});

// ─── IO layer (temp file) ───────────────────────────────

describe("usage store IO", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "usage-store-"));
    file = join(dir, "nested", "usage.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends records and reads them back (creating parent dirs)", () => {
    recordUsage(
      {
        sessionId: "s",
        model: "m",
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        ts: 10,
      },
      { filePath: file },
    );
    recordUsage(
      {
        sessionId: "s",
        model: "m",
        promptTokens: 4,
        completionTokens: 5,
        totalTokens: 9,
        ts: 20,
      },
      { filePath: file },
    );
    const records = readUsageRecords({ filePath: file });
    expect(records).toHaveLength(2);
    expect(records[1].totalTokens).toBe(9);
  });

  it("getUsageStats aggregates the file", () => {
    recordUsage(
      {
        model: "m",
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cost: 0.5,
        ts: 1,
      },
      { filePath: file },
    );
    const stats = getUsageStats({ filePath: file });
    expect(stats.totals.turns).toBe(1);
    expect(stats.totals.cost).toBeCloseTo(0.5, 6);
  });

  it("returns [] for a missing file", () => {
    expect(readUsageRecords({ filePath: join(dir, "absent.jsonl") })).toEqual(
      [],
    );
  });

  it("tolerates a corrupt file on read", () => {
    writeFileSync(file.replace("nested/", ""), "garbage\n{bad");
    expect(readUsageRecords({ filePath: file.replace("nested/", "") })).toEqual(
      [],
    );
  });

  it("defaults ts to now when omitted", () => {
    const before = Date.now();
    recordUsage(
      { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      { filePath: file },
    );
    const [rec] = readUsageRecords({ filePath: file });
    expect(rec.ts).toBeGreaterThanOrEqual(before);
    // sanity: the line is valid JSONL
    const raw = readFileSync(file, "utf-8").trim();
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
