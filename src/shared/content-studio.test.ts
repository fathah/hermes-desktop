import { describe, expect, it } from "vitest";
import {
  calculateBmLike,
  buildContentStudioDashboard,
  buildContentIdeaFromSources,
  buildWeeklyReviewProposals,
  canStartContentRun,
  CONTENT_STUDIO_FOLDERS,
  CONTENT_STUDIO_PLAYBOOKS,
  contentEvidenceToRow,
  contentIdeaToRow,
  contentRowId,
  contentRunToRow,
  evaluateDraftQuality,
  findHighBookmarkLowLikePosts,
  findWeakPosts,
  findWinningHookRoutes,
  getNextContentActions,
  parseDraftVariants,
  parseContentSourceUrls,
  parseContentIdeaMarkdown,
  rowToAnalyticsSnapshot,
  rowToContentEvidence,
  rowToContentIdea,
  scoreContentIdea,
  serializeContentIdeaMarkdown,
  summarizeContentAnalytics,
  type AnalyticsSnapshot,
  type ContentEvidence,
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

  it("requires claim-specific evidence even when a source URL is present", () => {
    const draftId = "draft-1";
    const withoutEvidence = evaluateDraftQuality({
      text: "This workflow always saves 30 minutes.",
      sourceUrls: ["https://example.com/proof"],
      evidence: [],
      draftId,
      hasMaterialConnection: false,
      disclosureText: "",
      includesRealisticSyntheticMedia: false,
      syntheticMediaDisclosure: false,
    });

    expect(withoutEvidence.ok).toBe(false);
    expect(withoutEvidence.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: "claim-draft-1-0",
          status: "needs source",
          evidenceIds: [],
        }),
      ]),
    );

    const evidence: ContentEvidence = {
      id: "ev-1",
      claimId: "claim-draft-1-0",
      runId: "run-1",
      draftId,
      sourceUrl: "https://example.com/proof",
      sourceTitle: "Proof",
      snippet: "The measured workflow saved 30 minutes.",
      note: "Supports the numeric time claim.",
      createdAt: "2026-06-17T00:00:00Z",
    };
    const withEvidence = evaluateDraftQuality({
      text: "This workflow always saves 30 minutes.",
      sourceUrls: ["https://example.com/proof"],
      evidence: [evidence],
      draftId,
      hasMaterialConnection: false,
      disclosureText: "",
      includesRealisticSyntheticMedia: false,
      syntheticMediaDisclosure: false,
    });

    expect(withEvidence.ok).toBe(true);
    expect(withEvidence.claims[0]).toMatchObject({
      claimId: "claim-draft-1-0",
      status: "sourced",
      evidenceIds: ["ev-1"],
    });
  });
});

describe("content studio row contracts", () => {
  it("parses and dedupes source URLs from loose source text", () => {
    expect(
      parseContentSourceUrls(
        " https://one.example/a, https://two.example/b\nhttps://one.example/a\nNotes (https://three.example/c).",
      ),
    ).toEqual([
      "https://one.example/a",
      "https://two.example/b",
      "https://three.example/c",
    ]);
  });

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

  it("serializes evidence rows for claim-level review", () => {
    const evidence: ContentEvidence = {
      id: "evidence-1",
      claimId: "claim-draft-1-0",
      runId: "run-1",
      draftId: "draft-1",
      sourceUrl: "https://example.com/proof",
      sourceTitle: "Proof source",
      snippet: "The source supports this claim.",
      note: "Use in final post.",
      createdAt: "2026-06-17T00:00:00Z",
    };

    const row = contentEvidenceToRow(evidence);

    expect(CONTENT_STUDIO_FOLDERS.evidence).toBe("content-evidence");
    expect(row.folder).toBe("content-evidence");
    expect(row.props).toMatchObject({
      type: "content-evidence",
      claimId: "claim-draft-1-0",
      sourceUrl: "https://example.com/proof",
    });
    expect(rowToContentEvidence(row.props, row.body)).toMatchObject(evidence);
  });

  it("builds one Content Studio idea from multiple source records", () => {
    const idea = buildContentIdeaFromSources({
      id: "idea-multi",
      title: "Multi-source angle",
      sources: [
        {
          url: "https://one.example/a",
          title: "One",
          excerpt: "First source note.",
        },
        {
          url: "https://two.example/b",
          title: "Two",
          excerpt: "Second source note.",
        },
        {
          url: "https://one.example/a",
          title: "Duplicate",
          excerpt: "Duplicate source note.",
        },
      ],
      capturedFrom: "source-preview",
      createdAt: "2026-06-17",
    });

    const row = contentIdeaToRow(idea);

    expect(idea).toMatchObject({
      id: "idea-multi",
      title: "Multi-source angle",
      sourceUrls: ["https://one.example/a", "https://two.example/b"],
      capturedFrom: "source-preview",
      status: "captured",
    });
    expect(row.props.sourceUrls).toEqual([
      "https://one.example/a",
      "https://two.example/b",
    ]);
    expect(row.body).toContain("First source note.");
    expect(row.body).toContain("Second source note.");
    expect(row.body).not.toContain("Duplicate source note.");
  });
});

describe("content studio dashboard and analytics helpers", () => {
  const rows = {
    ideas: [
      {
        path: "content-ideas/a.md",
        title: "Captured",
        props: { status: "captured", score: 0 },
        mtime: 1,
      },
      {
        path: "content-ideas/b.md",
        title: "Ready",
        props: { status: "scored", score: 12 },
        mtime: 1,
      },
    ],
    runs: [
      {
        path: "content-runs/r.md",
        title: "Run",
        props: { id: "run-1", status: "drafting", state: "drafting" },
        mtime: 1,
      },
    ],
    drafts: [
      {
        path: "content-drafts/d.md",
        title: "Draft",
        props: {
          runId: "run-2",
          status: "needs-review",
          unsupportedClaimCount: 2,
        },
        mtime: 1,
      },
    ],
    published: [
      {
        path: "content-published/p.md",
        title: "Ready packet",
        props: { slug: "ready", status: "ready" },
        mtime: 1,
      },
      {
        path: "content-published/pub.md",
        title: "Published packet",
        props: { slug: "live", status: "published" },
        mtime: 1,
      },
    ],
    analytics: [
      {
        path: "content-analytics/a.md",
        title: "live 24h",
        props: {
          slug: "live",
          snapshotWindow: "24h",
          hookRoute: "proof-led",
          bmLike: 2.4,
          bookmarks: 24,
          likes: 10,
          comments: 1,
          views: 1000,
        },
        mtime: 1,
      },
      {
        path: "content-analytics/b.md",
        title: "weak 24h",
        props: {
          slug: "weak",
          snapshotWindow: "24h",
          hookRoute: "checklist",
          bmLike: 0.1,
          bookmarks: 1,
          likes: 10,
          comments: 0,
          views: 500,
        },
        mtime: 1,
      },
    ],
  };

  it("builds dashboard counts and next actions from row-backed data", () => {
    const summary = buildContentStudioDashboard(rows);

    expect(summary.capturedIdeasNeedingScore).toBe(1);
    expect(summary.highScoreIdeasReadyForRun).toBe(1);
    expect(summary.activeRunsNeedingVariants).toBe(1);
    expect(summary.draftsNeedingEvidence).toBe(1);
    expect(summary.publishPacketsReady).toBe(1);
    expect(summary.analyticsDue).toBe(1);
    expect(summary.weeklyReviewDue).toBe(true);
    expect(getNextContentActions(summary)[0]).toMatchObject({
      panel: "evidence",
      count: 1,
    });
  });

  it("summarizes analytics winners, weak posts, and weekly proposals", () => {
    const summary = summarizeContentAnalytics(rows.analytics);

    expect(summary.topPosts[0].slug).toBe("live");
    expect(findWinningHookRoutes(rows.analytics)[0]).toMatchObject({
      hookRoute: "proof-led",
      count: 1,
    });
    expect(findHighBookmarkLowLikePosts(rows.analytics)[0].slug).toBe("live");
    expect(findWeakPosts(rows.analytics)[0].slug).toBe("weak");
    expect(buildWeeklyReviewProposals(summary)).toMatchObject({
      memoryRules: expect.arrayContaining([
        expect.stringContaining("proof-led"),
      ]),
      vaultTitle: "Content Studio Weekly Review",
    });
  });
});

describe("creator playbooks", () => {
  it("ships concrete playbook defaults without bypassing gates", () => {
    const teardown = CONTENT_STUDIO_PLAYBOOKS.find(
      (playbook) => playbook.id === "ai-tool-teardown",
    );

    expect(CONTENT_STUDIO_PLAYBOOKS).toHaveLength(5);
    expect(teardown).toMatchObject({
      defaultPlatform: "x",
      suggestedHookRoutes: expect.arrayContaining(["proof-led"]),
      bypassesQualityGate: false,
    });
    expect(teardown?.rubric.bookmarkability).toBe(2);
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
