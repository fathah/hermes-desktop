import { describe, it, expect } from "vitest";
import {
  entryQuery,
  pickProvenance,
  type ProvenanceCandidate,
} from "../src/shared/memoryTimeline";

describe("entryQuery", () => {
  it("keeps the most distinctive (long, deduped) words", () => {
    const q = entryQuery(
      "User prefers TypeScript and dislikes verbose configuration files",
      4,
    );
    const words = q.split(" ");
    expect(words.length).toBeLessThanOrEqual(4);
    // longest words should win; all are >= 4 chars and lowercased
    expect(words.every((w) => w.length >= 4)).toBe(true);
    expect(q).toBe(q.toLowerCase());
    expect(words).toContain("configuration");
  });

  it("drops short/common words and punctuation", () => {
    const q = entryQuery("He is on a big API.");
    // "API" is 3 chars → dropped; "big"/"He"/"is"/"on"/"a" too short
    expect(q).toBe("");
  });

  it("dedupes repeated words", () => {
    const q = entryQuery("budget budget budget planning", 6);
    expect(q.split(" ").filter((w) => w === "budget").length).toBe(1);
  });
});

describe("pickProvenance", () => {
  const candidates: ProvenanceCandidate[] = [
    { sessionId: "late", title: "Later chat", startedAt: 3000 },
    { sessionId: "early", title: "First chat", startedAt: 1000 },
    { sessionId: "mid", title: null, startedAt: 2000 },
  ];

  it("picks the earliest session (closest to when the fact appeared)", () => {
    const p = pickProvenance(candidates);
    expect(p).toEqual({
      sessionId: "early",
      title: "First chat",
      startedAt: 1000,
    });
  });

  it("returns undefined with no candidates", () => {
    expect(pickProvenance([])).toBeUndefined();
  });

  it("handles a single candidate", () => {
    expect(pickProvenance([candidates[0]])?.sessionId).toBe("late");
  });
});
