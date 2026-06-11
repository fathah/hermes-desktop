// federated-search.test.ts — the PURE merge/rank logic (no sqlite, synthetic input).
import { describe, expect, it } from "vitest";
import {
  rankFederatedHits,
  stripSnippetMarkers,
  type FederatedCandidate,
} from "../shared/federated-search";

function note(path: string, ts: number | null): FederatedCandidate {
  return {
    kind: "note",
    title: path,
    snippet: "s",
    ts,
    ref: { path },
  };
}
function session(id: string, ts: number): FederatedCandidate {
  return {
    kind: "session",
    title: id,
    snippet: "s",
    ts,
    ref: { sessionId: id },
  };
}
function transcript(convId: string, ts: number | null): FederatedCandidate {
  return {
    kind: "transcript",
    title: convId,
    snippet: "s",
    ts,
    source: "claude-code",
    ref: { convId, seq: 0, projectPath: null, gitBranch: null },
  };
}

describe("stripSnippetMarkers", () => {
  it("removes note ⟦⟧ and session <<>> markers", () => {
    expect(stripSnippetMarkers("a ⟦hit⟧ b")).toBe("a hit b");
    expect(stripSnippetMarkers("a <<hit>> b")).toBe("a hit b");
  });
  it("leaves marker-free external snippets untouched", () => {
    expect(stripSnippetMarkers("plain … text")).toBe("plain … text");
  });
});

describe("rankFederatedHits", () => {
  it("returns all three kinds merged into one list", () => {
    const out = rankFederatedHits({
      notes: [note("a.md", 100)],
      sessions: [session("s1", 100)],
      transcripts: [transcript("t1", 100)],
    });
    expect(out.map((h) => h.kind).sort()).toEqual([
      "note",
      "session",
      "transcript",
    ]);
    // Every hit gets a numeric score.
    expect(out.every((h) => typeof h.score === "number")).toBe(true);
  });

  it("ranks the top-of-list hit of each source above its lower hits", () => {
    const out = rankFederatedHits(
      {
        notes: [note("first.md", 100), note("second.md", 100)],
        sessions: [],
        transcripts: [],
      },
      { recencyWeight: 0 }, // isolate relevance
    );
    expect(out[0].ref).toEqual({ path: "first.md" });
    expect(out[1].ref).toEqual({ path: "second.md" });
  });

  it("applies a recency boost: a newer same-rank hit outranks an older one", () => {
    const out = rankFederatedHits({
      notes: [note("old.md", 1000)],
      sessions: [session("new", 9999)],
      transcripts: [],
    });
    // Both are rank-0 in their source (equal relevance); recency breaks it.
    expect(out[0].kind).toBe("session");
  });

  it("enforces the per-source cap so one chatty source can't drown others", () => {
    const manyNotes = Array.from({ length: 25 }, (_, i) =>
      note(`n${i}.md`, 100),
    );
    const out = rankFederatedHits(
      { notes: manyNotes, sessions: [session("s1", 100)], transcripts: [] },
      { perSourceCap: 5 },
    );
    const noteCount = out.filter((h) => h.kind === "note").length;
    expect(noteCount).toBe(5);
    expect(out.filter((h) => h.kind === "session").length).toBe(1);
  });

  it("enforces the total cap", () => {
    const manyNotes = Array.from({ length: 20 }, (_, i) =>
      note(`n${i}.md`, 100),
    );
    const manySessions = Array.from({ length: 20 }, (_, i) =>
      session(`s${i}`, 100),
    );
    const out = rankFederatedHits(
      { notes: manyNotes, sessions: manySessions, transcripts: [] },
      { perSourceCap: 15, limit: 10 },
    );
    expect(out).toHaveLength(10);
  });

  it("treats null timestamps as least-recent (recency 0)", () => {
    const out = rankFederatedHits({
      notes: [note("dated.md", 5000)],
      sessions: [],
      transcripts: [transcript("undated", null)],
    });
    // Equal relevance (each rank-0); the dated note wins on recency.
    expect(out[0].kind).toBe("note");
  });

  it("returns an empty list for all-empty sources", () => {
    expect(
      rankFederatedHits({ notes: [], sessions: [], transcripts: [] }),
    ).toEqual([]);
  });

  it("handles a single source with no timestamps (span 0) without NaN", () => {
    const out = rankFederatedHits({
      notes: [note("a.md", null), note("b.md", null)],
      sessions: [],
      transcripts: [],
    });
    expect(out).toHaveLength(2);
    expect(out.every((h) => Number.isFinite(h.score))).toBe(true);
  });
});
