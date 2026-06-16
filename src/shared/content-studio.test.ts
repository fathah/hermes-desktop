import { describe, expect, it } from "vitest";
import {
  calculateBmLike,
  canStartContentRun,
  CONTENT_STUDIO_FOLDERS,
  contentIdeaToRow,
  contentRowId,
  contentRunToRow,
  evaluateDraftQuality,
  parseDraftVariants,
  parseContentIdeaMarkdown,
  rowToAnalyticsSnapshot,
  rowToContentIdea,
  scoreContentIdea,
  serializeContentIdeaMarkdown,
  type AnalyticsSnapshot,
  type ContentIdea,
  type ContentRun,
} from "./content-studio";

const baseIdea: ContentIdea = {
  id: "idea-1",
  title: "Agent Reach setup",
  sourceUrls: ["https://example.com/source"],
  audience: "AI builders who publish tool walkthroughs",
  angle: "Show what changed and what still needs setup",
  createdAt: "2026-06-16",
  updatedAt: "2026-06-16",
  status: "captured",
  rubric: {
    bookmarkability: 2,
    proof: 2,
    immediateUse: 2,
    audienceClarity: 1,
    reproducibility: 1,
    hookStrength: 2,
    originality: 2,
  },
};

describe("scoreContentIdea", () => {
  it("scores the seven Content Studio rubric fields and recommends runs at 10+", () => {
    const score = scoreContentIdea(baseIdea.rubric);

    expect(score.total).toBe(12);
    expect(score.max).toBe(14);
    expect(score.recommendation).toBe("write");
  });

  it("blocks low-scoring ideas unless explicitly overridden", () => {
    const lowScore = {
      ...baseIdea,
      rubric: {
        bookmarkability: 1,
        proof: 0,
        immediateUse: 1,
        audienceClarity: 1,
        reproducibility: 1,
        hookStrength: 1,
        originality: 1,
      },
    };

    expect(canStartContentRun(lowScore).ok).toBe(false);
    expect(canStartContentRun({ ...lowScore, overrideLowScore: true }).ok).toBe(
      true,
    );
  });
});

describe("evaluateDraftQuality", () => {
  it("blocks final approval when sources, proof, or disclosures are missing", () => {
    const result = evaluateDraftQuality({
      text: "This free tool replaces every paid API and gets 300K views.",
      sourceUrls: [],
      hasMaterialConnection: true,
      disclosureText: "",
      includesRealisticSyntheticMedia: true,
      syntheticMediaDisclosure: false,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Add at least one source link before approval.",
        "Add a clear sponsorship/free-product disclosure.",
        "Disclose realistic AI-generated or meaningfully altered media.",
        "Support numeric or performance claims with a source.",
      ]),
    );
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "300K views",
          status: "unsupported",
        }),
        expect.objectContaining({
          text: expect.stringContaining("replaces"),
          status: "unsupported",
        }),
      ]),
    );
  });

  it("allows sourced review-first copy with clear disclosures", () => {
    const result = evaluateDraftQuality({
      text: "This workflow is useful for creators who need a repeatable review loop.",
      sourceUrls: ["https://example.com/source"],
      hasMaterialConnection: true,
      disclosureText: "Thanks to Example for the free account.",
      includesRealisticSyntheticMedia: false,
      syntheticMediaDisclosure: false,
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.claims.every((claim) => claim.status === "sourced")).toBe(
      true,
    );
  });
});

describe("content studio row contracts", () => {
  it("uses deterministic folder-backed row ids and row props", () => {
    expect(CONTENT_STUDIO_FOLDERS.ideas).toBe("content-ideas");
    expect(contentRowId("content-idea", "Agent Reach setup!!")).toBe(
      "content-idea-agent-reach-setup",
    );

    const row = contentIdeaToRow(baseIdea);

    expect(row.rowId).toBe("content-idea-agent-reach-setup");
    expect(row.folder).toBe("content-ideas");
    expect(row.props).toMatchObject({
      type: "content-idea",
      title: "Agent Reach setup",
      status: "captured",
      score: 12,
      sourceUrls: ["https://example.com/source"],
    });
    expect(rowToContentIdea(row.props, row.body)).toMatchObject(baseIdea);
  });

  it("serializes run and analytics rows for queryable Bases", () => {
    const run: ContentRun = {
      id: "run-1",
      ideaId: "idea-1",
      title: "Run - Agent Reach setup",
      platform: "x",
      hookRoute: "proof-led",
      state: "drafting",
      createdAt: "2026-06-16",
      sourceUrls: ["https://example.com/source"],
    };
    const runRow = contentRunToRow(run);
    expect(runRow.folder).toBe("content-runs");
    expect(runRow.props).toMatchObject({
      type: "content-run",
      ideaId: "idea-1",
      platform: "x",
      hookRoute: "proof-led",
    });

    const snapshot: AnalyticsSnapshot = {
      slug: "agent-reach-setup",
      platform: "x",
      snapshotWindow: "24h",
      bookmarks: 45,
      likes: 30,
      views: 1000,
      comments: 4,
      reposts: 2,
      capturedAt: "2026-06-16T00:00:00Z",
    };
    const analytics = rowToAnalyticsSnapshot(
      {
        ...snapshot,
        type: "analytics-snapshot",
        title: "agent-reach-setup 24h",
        bmLike: 1.5,
      },
      "Notes",
    );

    expect(analytics).toMatchObject({
      slug: "agent-reach-setup",
      bmLike: 1.5,
      notes: "Notes",
    });
  });
});

describe("parseDraftVariants", () => {
  it("parses three assistant variants and falls back to a raw review draft", () => {
    const parsed = parseDraftVariants(
      `Variant A
hookRoute: proof-led
draftText: First sourced draft.
sourceNotes: Uses the source.
assetBrief: Screenshot of workflow.
disclosureNotes: None.

Variant B
hookRoute: checklist
draftText: Second sourced draft.
sourceNotes: Uses the same source.
assetBrief: Checklist visual.
disclosureNotes: None.

Variant C
hookRoute: contrarian
draftText: Third sourced draft.
sourceNotes: Uses source.
assetBrief: Diagram.
disclosureNotes: None.`,
      "run-1",
    );

    expect(parsed.fallback).toBe(false);
    expect(parsed.variants).toHaveLength(3);
    expect(parsed.variants[0]).toMatchObject({
      runId: "run-1",
      title: "Variant A",
      hookRoute: "proof-led",
      text: "First sourced draft.",
    });

    const fallback = parseDraftVariants("not structured", "run-1");
    expect(fallback.fallback).toBe(true);
    expect(fallback.variants).toHaveLength(1);
    expect(fallback.variants[0]).toMatchObject({
      runId: "run-1",
      title: "Raw assistant result",
      status: "needs-review",
    });
  });
});

describe("content idea markdown", () => {
  it("round-trips idea frontmatter and body without a database", () => {
    const markdown = serializeContentIdeaMarkdown(baseIdea);

    expect(markdown).toContain("type: content-idea");
    expect(markdown).toContain("sourceUrls:");
    expect(markdown).toContain("# Agent Reach setup");

    expect(parseContentIdeaMarkdown(markdown)).toMatchObject({
      id: "idea-1",
      title: "Agent Reach setup",
      status: "captured",
      sourceUrls: ["https://example.com/source"],
      rubric: baseIdea.rubric,
    });
  });
});

describe("calculateBmLike", () => {
  it("calculates bookmark-to-like ratio for analytics snapshots", () => {
    expect(calculateBmLike({ bookmarks: 45, likes: 30 })).toBe(1.5);
    expect(calculateBmLike({ bookmarks: 5, likes: 0 })).toBe(null);
  });
});
