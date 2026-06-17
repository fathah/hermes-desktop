import { useEffect, useMemo, useState } from "react";
import {
  buildContentStudioDashboard,
  buildWeeklyReviewProposals,
  calculateBmLike,
  calculateRate,
  canStartContentRun,
  CONTENT_STUDIO_PLAYBOOKS,
  buildContentWriterPrompt,
  CONTENT_STUDIO_FOLDERS,
  evaluateDraftQuality,
  parseContentSourceUrls,
  parseDraftVariants,
  scoreContentIdea,
  type AnalyticsSnapshot,
  type ContentEvidence,
  type ContentIdea,
  type ContentRun,
  type ContentStudioDashboardSummary,
  type ContentStudioPanel,
  type ContentStudioRubric,
  type DraftClaim,
  type DraftVariant,
} from "../../../../../shared/content-studio";
import { ASSISTANT_RECIPE_TEMPLATES } from "../../../../../shared/assistant-recipes";
import { blk } from "../lib/ids";
import { useStore } from "../store";
import type { PageMeta, TreeNode } from "../types";
import {
  saveAnalyticsSnapshot,
  saveContentEvidence,
  saveContentRun,
  saveDraftVariant,
  savePublishedPost,
  readContentStudioDashboardRows,
} from "./contentStudioStorage";
import { AnalyticsLoop } from "./AnalyticsLoop";
import { ContentIdeaPanel } from "./ContentIdeaPanel";
import { ContentStudioDashboard } from "./ContentStudioDashboard";
import { DraftWorkbench } from "./DraftWorkbench";
import { EvidenceLedger, buildLocalEvidence } from "./EvidenceLedger";
import { PublishQueue } from "./PublishQueue";
import { WeeklyReviewPanel } from "./WeeklyReviewPanel";

const PACK_PAGES = [
  "Ideas",
  "Runs",
  "Drafts",
  "Assets",
  "Published",
  "Post Log",
  "Weekly Review",
];

const PACK_DATABASES: Partial<Record<(typeof PACK_PAGES)[number], string>> = {
  Ideas: CONTENT_STUDIO_FOLDERS.ideas,
  Runs: CONTENT_STUDIO_FOLDERS.runs,
  Drafts: CONTENT_STUDIO_FOLDERS.drafts,
  Assets: CONTENT_STUDIO_FOLDERS.assets,
  Published: CONTENT_STUDIO_FOLDERS.published,
  "Post Log": CONTENT_STUDIO_FOLDERS.analytics,
};

const EMPTY_RUBRIC: ContentStudioRubric = {
  bookmarkability: 0,
  proof: 0,
  immediateUse: 0,
  audienceClarity: 0,
  reproducibility: 0,
  hookStrength: 0,
  originality: 0,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function slug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "content-idea"
  );
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function childTitlesFor(
  rootId: string,
  tree: TreeNode[],
  meta: Record<string, PageMeta>,
): Set<string> {
  const root = tree.find((node) => node.id === rootId);
  return new Set(
    (root?.children ?? [])
      .map((child) => meta[child.id]?.title)
      .filter((title): title is string => Boolean(title)),
  );
}

function packBlocks(title: string) {
  const source = PACK_DATABASES[title as keyof typeof PACK_DATABASES];
  if (!source) {
    return [
      blk(
        "p",
        "Review recent analytics and queue hook, voice, source, and template learnings through Learn This.",
      ),
    ];
  }
  return [
    blk("p", `${title} for Content Studio.`),
    blk("database", "", {
      source,
      view: title === "Runs" || title === "Drafts" ? "board" : "table",
      cols: [
        { id: "status", name: "Status" },
        { id: "score", name: "Score" },
        { id: "platform", name: "Platform" },
        { id: "hookRoute", name: "Hook" },
        { id: "bmLike", name: "BM/Like" },
      ],
    }),
  ];
}

function emptyDashboardSummary(): ContentStudioDashboardSummary {
  return {
    capturedIdeasNeedingScore: 0,
    highScoreIdeasReadyForRun: 0,
    activeRunsNeedingVariants: 0,
    draftsNeedingEvidence: 0,
    publishPacketsReady: 0,
    analyticsDue: 0,
    weeklyReviewDue: false,
  };
}

export function ContentStudioSurface({
  profile = "default",
}: {
  profile?: string;
}): React.JSX.Element {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const makePage = useStore((s) => s.makePage);
  const flash = useStore((s) => s.flash);
  const pendingContentStudioIdea = useStore((s) => s.pendingContentStudioIdea);
  const clearPendingContentStudioIdea = useStore(
    (s) => s.clearPendingContentStudioIdea,
  );
  const [contentRootId, setContentRootId] = useState("");
  const [activePanel, setActivePanel] = useState<ContentStudioPanel>("ideas");
  const [dashboardSummary, setDashboardSummary] =
    useState<ContentStudioDashboardSummary>(emptyDashboardSummary);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [sourceUrlsText, setSourceUrlsText] = useState("");
  const [audience, setAudience] = useState("");
  const [angle, setAngle] = useState("");
  const [rubric, setRubric] = useState<ContentStudioRubric>(EMPTY_RUBRIC);
  const [overrideLowScore, setOverrideLowScore] = useState(false);
  const [currentIdea, setCurrentIdea] = useState<ContentIdea | null>(null);
  const [currentRun, setCurrentRun] = useState<ContentRun | null>(null);
  const [runMessage, setRunMessage] = useState("");
  const [variantMessage, setVariantMessage] = useState("");
  const [lastAssistantRunId, setLastAssistantRunId] = useState("");
  const [draftVariants, setDraftVariants] = useState<DraftVariant[]>([]);
  const [draftText, setDraftText] = useState("");
  const [draftId, setDraftId] = useState("draft-manual");
  const [hasMaterialConnection, setHasMaterialConnection] = useState(false);
  const [disclosureText, setDisclosureText] = useState("");
  const [syntheticMedia, setSyntheticMedia] = useState(false);
  const [syntheticDisclosure, setSyntheticDisclosure] = useState(false);
  const [qualityMessage, setQualityMessage] = useState("");
  const [qualityClaims, setQualityClaims] = useState<DraftClaim[]>([]);
  const [evidence, setEvidence] = useState<ContentEvidence[]>([]);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceSnippet, setEvidenceSnippet] = useState("");
  const [manualPublishUrl, setManualPublishUrl] = useState("");
  const [plannedPublishedAt, setPlannedPublishedAt] = useState("");
  const [analyticsSlug, setAnalyticsSlug] = useState("");
  const [views, setViews] = useState("");
  const [bookmarks, setBookmarks] = useState("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");
  const [analytics, setAnalytics] = useState<
    (AnalyticsSnapshot & {
      slug: string;
      bmLike: number | null;
      bookmarkRate?: number | null;
    })[]
  >([]);

  useEffect(() => {
    const existing = tree.find(
      (node) => meta[node.id]?.title === "Content Studio",
    );
    if (existing) {
      setContentRootId(existing.id);
      const existingChildTitles = childTitlesFor(existing.id, tree, meta);
      for (const title of PACK_PAGES) {
        if (existingChildTitles.has(title)) continue;
        makePage({ icon: "CS", title }, packBlocks(title), existing.id);
      }
      return;
    }
    const root = makePage(
      { icon: "CS", title: "Content Studio" },
      [
        blk(
          "p",
          "A review-first content operating system for sourced ideas, draft variants, visual briefs, publish packets, analytics, and weekly learning.",
        ),
      ],
      null,
    );
    for (const title of PACK_PAGES) {
      makePage({ icon: "CS", title }, packBlocks(title), root);
    }
    setContentRootId(root);
  }, [makePage, meta, tree]);

  useEffect(() => {
    let cancelled = false;
    readContentStudioDashboardRows(profile)
      .then((rows) => {
        if (cancelled) return;
        setDashboardSummary(buildContentStudioDashboard(rows));
        if (rows.analytics.length > 0) {
          setAnalytics(
            rows.analytics.map((row) => {
              const snapshot: AnalyticsSnapshot & {
                slug: string;
                bmLike: number | null;
                bookmarkRate?: number | null;
              } = {
                slug: String(row.props.slug || row.title || "untitled-post"),
                platform:
                  typeof row.props.platform === "string"
                    ? row.props.platform
                    : "x",
                snapshotWindow:
                  row.props.snapshotWindow === "24h" ||
                  row.props.snapshotWindow === "72h" ||
                  row.props.snapshotWindow === "7d" ||
                  row.props.snapshotWindow === "manual"
                    ? row.props.snapshotWindow
                    : "manual",
                views: numberValue(String(row.props.views ?? 0)),
                likes: numberValue(String(row.props.likes ?? 0)),
                bookmarks: numberValue(String(row.props.bookmarks ?? 0)),
                comments: numberValue(String(row.props.comments ?? 0)),
                bmLike:
                  typeof row.props.bmLike === "number"
                    ? row.props.bmLike
                    : calculateBmLike({
                        bookmarks: numberValue(
                          String(row.props.bookmarks ?? 0),
                        ),
                        likes: numberValue(String(row.props.likes ?? 0)),
                      }),
                bookmarkRate:
                  typeof row.props.bookmarkRate === "number"
                    ? row.props.bookmarkRate
                    : calculateRate(
                        numberValue(String(row.props.bookmarks ?? 0)),
                        numberValue(String(row.props.views ?? 0)),
                      ),
                capturedAt:
                  typeof row.props.capturedAt === "string"
                    ? row.props.capturedAt
                    : undefined,
              };
              return snapshot;
            }),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setDashboardSummary(emptyDashboardSummary());
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!pendingContentStudioIdea) return;
    setIdeaTitle(pendingContentStudioIdea.title);
    setSourceUrlsText(pendingContentStudioIdea.sourceUrls.join("\n"));
    setAudience(pendingContentStudioIdea.audience);
    setAngle(pendingContentStudioIdea.angle);
    setRubric(pendingContentStudioIdea.rubric);
    setOverrideLowScore(Boolean(pendingContentStudioIdea.overrideLowScore));
    setCurrentIdea(pendingContentStudioIdea);
    setCurrentRun(null);
    setRunMessage("");
    setVariantMessage("");
    setLastAssistantRunId("");
    setDraftVariants([]);
    setActivePanel("ideas");
    clearPendingContentStudioIdea();
  }, [clearPendingContentStudioIdea, pendingContentStudioIdea]);

  const score = useMemo(() => scoreContentIdea(rubric), [rubric]);

  function buildIdea(): ContentIdea {
    const date = today();
    return {
      id: `idea-${slug(ideaTitle || "untitled")}`,
      title: ideaTitle.trim() || "Untitled content idea",
      sourceUrls: parseContentSourceUrls(sourceUrlsText),
      audience: audience.trim(),
      angle: angle.trim(),
      createdAt: date,
      updatedAt: date,
      status: "scored",
      rubric,
      overrideLowScore,
    };
  }

  function scoreIdea(): void {
    const idea = buildIdea();
    setCurrentIdea(idea);
    setRunMessage("");
  }

  async function startRun(): Promise<void> {
    const idea = buildIdea();
    setCurrentIdea(idea);
    const decision = canStartContentRun(idea);
    if (!decision.ok) {
      setRunMessage(decision.reason || "Idea is not ready for a run.");
      return;
    }
    const parent = contentRootId || null;
    const runTitle = `Run - ${idea.title}`;
    const run: ContentRun = {
      id: `run-${slug(idea.title)}`,
      ideaId: idea.id,
      title: runTitle,
      platform: "x",
      hookRoute: "manual",
      state: "drafting",
      createdAt: new Date().toISOString(),
      sourceUrls: idea.sourceUrls,
    };
    await saveContentRun(run, profile);
    setCurrentRun(run);
    makePage(
      {
        icon: "CS",
        title: runTitle,
        source: idea.sourceUrls[0],
        ingestedAt: Date.now(),
      },
      [
        blk("h2", "Content Run"),
        blk("p", `Idea score: ${scoreContentIdea(idea.rubric).total}/14`),
        blk("p", `Audience: ${idea.audience || "Unspecified"}`),
        blk("p", `Angle: ${idea.angle || "Unspecified"}`),
        blk("h3", "Source Links"),
        blk("p", idea.sourceUrls.join("\n")),
        blk("h3", "Review Checklist"),
        blk("todo", "Every factual claim has a source."),
        blk("todo", "Material relationships are disclosed."),
        blk("todo", "No auto-posting or bulk posting."),
        blk("todo", "Final copy has an asset brief and publish packet."),
      ],
      parent,
    );
    setRunMessage(`Created ${runTitle}.`);
    flash(`Content run created: ${idea.title}`);
  }

  async function generateVariants(): Promise<void> {
    const run = currentRun;
    const idea = currentIdea || buildIdea();
    if (!run) {
      setVariantMessage("Start a content run before generating variants.");
      return;
    }
    const api = window.hermesAPI;
    const recipes = (await api.spsListAssistantRecipes?.(profile)) ?? [];
    let recipe = recipes.find(
      (item) => item.kind === "content-writer" && item.enabled,
    );
    if (!recipe) {
      const template = ASSISTANT_RECIPE_TEMPLATES.find(
        (item) => item.kind === "content-writer",
      );
      const created = await api.spsCreateAssistantRecipe?.(
        {
          name: template?.title || "Content post writer",
          kind: "content-writer",
          description:
            template?.description ||
            "Turn a sourced idea into review-first post variants.",
          job:
            template?.defaultJob ||
            "Write three sourced draft variants for review.",
          inputs:
            template?.defaultInputs ||
            "A scored idea, source links, audience, platform, and hook route.",
          output:
            template?.defaultOutput ||
            "Three draft variants with source notes and asset briefs.",
          allowedActions: template?.defaultActions || [
            "read_workspace",
            "search_web",
            "draft_content",
            "propose_changes",
          ],
          reviewMode: "review-first",
        },
        profile,
      );
      recipe = created?.recipe;
    }
    if (!recipe?.id) {
      setVariantMessage("Could not prepare the Content post writer.");
      return;
    }
    const prompt = buildContentWriterPrompt({
      title: idea.title,
      sourceUrls: idea.sourceUrls,
      audience: idea.audience,
      angle: idea.angle,
      platform: run.platform,
      hookRoute: run.hookRoute,
    });
    const result = await api.spsRunAssistantRecipe?.(
      recipe.id,
      prompt,
      profile,
    );
    const resultText = result?.run?.resultText || "";
    setLastAssistantRunId(result?.run?.id || "");
    const parsed = parseDraftVariants(resultText, run.id);
    for (const variant of parsed.variants) {
      await saveDraftVariant(variant, profile);
    }
    setDraftVariants(parsed.variants);
    setVariantMessage(
      parsed.fallback
        ? "Saved raw assistant result for review."
        : `Saved ${parsed.variants.length} draft variants.`,
    );
  }

  async function saveAssistantResult(): Promise<void> {
    if (!lastAssistantRunId) return;
    const saved = await window.hermesAPI.spsSaveAssistantRecipeRun?.(
      lastAssistantRunId,
      profile,
    );
    setVariantMessage(
      saved?.ok
        ? "Queued assistant result for review."
        : "Could not queue result.",
    );
  }

  async function runQualityGate(): Promise<void> {
    const result = evaluateDraftQuality({
      text: draftText,
      sourceUrls:
        currentIdea?.sourceUrls ?? parseContentSourceUrls(sourceUrlsText),
      evidence,
      draftId,
      runId: currentRun?.id,
      hasMaterialConnection,
      disclosureText,
      includesRealisticSyntheticMedia: syntheticMedia,
      syntheticMediaDisclosure: syntheticDisclosure,
    });
    setQualityClaims(result.claims);
    setQualityMessage(
      result.ok
        ? "Draft approved for manual publish packet."
        : result.blockers.join(" "),
    );
    if (!result.ok) return;
    await savePublishedPost(
      {
        id: `published-${Date.now().toString(36)}`,
        runId: currentRun?.id || "manual",
        slug: slug(currentRun?.title || currentIdea?.title || "manual-post"),
        status: "ready",
        platform: currentRun?.platform || "x",
        finalCopy: draftText,
        linkComment: parseContentSourceUrls(sourceUrlsText)[0] || "",
        sourceNotes: (
          currentIdea?.sourceUrls ?? parseContentSourceUrls(sourceUrlsText)
        )
          .filter(Boolean)
          .join("\n"),
        disclosureText,
        assetChecklist: [
          syntheticMedia
            ? "Synthetic media disclosure checked"
            : "No synthetic media",
        ],
      },
      profile,
    );
  }

  async function attachEvidence(): Promise<void> {
    const result = evaluateDraftQuality({
      text: draftText,
      sourceUrls:
        currentIdea?.sourceUrls ?? parseContentSourceUrls(sourceUrlsText),
      evidence,
      draftId,
      runId: currentRun?.id,
      hasMaterialConnection,
      disclosureText,
      includesRealisticSyntheticMedia: syntheticMedia,
      syntheticMediaDisclosure: syntheticDisclosure,
    });
    const claims = result.claims.filter((item) => item.status !== "sourced");
    setQualityClaims(result.claims);
    if (claims.length === 0 || !evidenceUrl.trim() || !evidenceSnippet.trim()) {
      setQualityMessage("Add a detected claim, source URL, and snippet first.");
      return;
    }
    const items = claims.map((claim) =>
      buildLocalEvidence({
        claim,
        runId: currentRun?.id || "manual",
        draftId,
        sourceUrl: evidenceUrl.trim(),
        snippet: evidenceSnippet.trim(),
      }),
    );
    await Promise.all(items.map((item) => saveContentEvidence(item, profile)));
    const nextEvidence = [...evidence, ...items];
    setEvidence(nextEvidence);
    const next = evaluateDraftQuality({
      text: draftText,
      sourceUrls:
        currentIdea?.sourceUrls ?? parseContentSourceUrls(sourceUrlsText),
      evidence: nextEvidence,
      draftId,
      runId: currentRun?.id,
      hasMaterialConnection,
      disclosureText,
      includesRealisticSyntheticMedia: syntheticMedia,
      syntheticMediaDisclosure: syntheticDisclosure,
    });
    setQualityClaims(next.claims);
    setQualityMessage("Evidence attached. Re-run approval when ready.");
  }

  function approveVariant(variant: DraftVariant): void {
    setDraftText(variant.text);
    setDraftId(variant.id);
    void saveDraftVariant(
      {
        ...variant,
        approved: true,
        status: "approved",
        approvedAt: new Date().toISOString(),
      },
      profile,
    );
  }

  async function markPublished(): Promise<void> {
    const slugValue = slug(
      currentRun?.title || currentIdea?.title || "manual-post",
    );
    await savePublishedPost(
      {
        id: `published-${Date.now().toString(36)}`,
        runId: currentRun?.id || "manual",
        slug: slugValue,
        status: "published",
        platform: currentRun?.platform || "x",
        finalCopy: draftText,
        linkComment: parseContentSourceUrls(sourceUrlsText)[0] || "",
        sourceNotes: (
          currentIdea?.sourceUrls ?? parseContentSourceUrls(sourceUrlsText)
        )
          .filter(Boolean)
          .join("\n"),
        disclosureText,
        assetChecklist: ["Manual publish URL captured"],
        manualPublishUrl: manualPublishUrl.trim(),
        plannedPublishedAt: plannedPublishedAt.trim(),
        publishedAt: new Date().toISOString(),
      },
      profile,
    );
    for (const snapshotWindow of ["24h", "72h", "7d"] as const) {
      await saveAnalyticsSnapshot(
        {
          slug: slugValue,
          platform: currentRun?.platform || "x",
          snapshotWindow,
          bookmarks: 0,
          likes: 0,
          views: 0,
          comments: 0,
          reposts: 0,
          notes: "Analytics due.",
          capturedAt: new Date().toISOString(),
        },
        profile,
      );
    }
    flash("Publish packet marked published. Analytics prompts created.");
  }

  function logAnalytics(): void {
    const snapshot = {
      slug: analyticsSlug.trim() || "untitled-post",
      platform: "x",
      snapshotWindow: "24h" as const,
      views: numberValue(views),
      bookmarks: numberValue(bookmarks),
      likes: numberValue(likes),
      comments: numberValue(comments),
      capturedAt: new Date().toISOString(),
    };
    void saveAnalyticsSnapshot(snapshot, profile);
    setAnalytics((items) => [
      ...items,
      {
        ...snapshot,
        bmLike: calculateBmLike(snapshot),
        bookmarkRate: calculateRate(snapshot.bookmarks, snapshot.views),
      },
    ]);
  }

  async function runWeeklyReview(): Promise<void> {
    const api = window.hermesAPI;
    const analyticsRows =
      (await api.spsIndexQuery?.(
        { scope: CONTENT_STUDIO_FOLDERS.analytics },
        profile,
      )) ?? [];
    await api.spsIndexQuery?.(
      { scope: CONTENT_STUDIO_FOLDERS.published },
      profile,
    );
    await api.spsIndexQuery?.(
      { scope: CONTENT_STUDIO_FOLDERS.drafts },
      profile,
    );
    const proposals = buildWeeklyReviewProposals({
      topPosts: [...analyticsRows]
        .map((row) => ({
          slug: String(row.props?.slug || row.title || "untitled-post"),
          hookRoute: String(row.props?.hookRoute || "manual"),
          bmLike:
            typeof row.props?.bmLike === "number" ? row.props.bmLike : null,
          bookmarks: Number(row.props?.bookmarks ?? 0),
          likes: Number(row.props?.likes ?? 0),
          comments: Number(row.props?.comments ?? 0),
          views: Number(row.props?.views ?? 0),
          bookmarkRate: calculateRate(
            Number(row.props?.bookmarks ?? 0),
            Number(row.props?.views ?? 0),
          ),
          commentRate: calculateRate(
            Number(row.props?.comments ?? 0),
            Number(row.props?.views ?? 0),
          ),
        }))
        .sort((a, b) => Number(b.bmLike ?? 0) - Number(a.bmLike ?? 0)),
      weakPosts: [],
      highBookmarkLowLikePosts: [],
    });
    for (const body of proposals.memoryRules) {
      await api.createLearningProposal?.(
        { kind: "memory", body, source: { type: "manual" } },
        profile,
      );
    }
    await api.spsCreateVaultProposal?.({
      source: "manual",
      title: proposals.vaultTitle,
      summary:
        "Review Content Studio winners and update hook, voice, source, and template rules.",
      operations: [
        {
          id: `content-weekly-${Date.now()}`,
          kind: "upsert-page",
          pageId: "content-studio-weekly-review",
          title: proposals.vaultTitle,
          markdown: proposals.vaultMarkdown,
        },
      ],
    });
    flash("Weekly review queued for Learn This and Review Queue.");
  }

  function updateRubric(key: keyof ContentStudioRubric, value: string): void {
    setRubric((current) => ({ ...current, [key]: numberValue(value) }));
  }

  function selectPlaybook(id: string): void {
    setSelectedPlaybookId(id);
    const playbook = CONTENT_STUDIO_PLAYBOOKS.find((item) => item.id === id);
    if (!playbook) return;
    setRubric(playbook.rubric);
    setAngle((current) => current || playbook.assetBriefPrompt);
  }

  function selectPanel(panel: ContentStudioPanel): void {
    setActivePanel(panel);
  }

  return (
    <div className="content-studio-surface">
      <div className="active-work-head">
        <div>
          <h1>Content Studio</h1>
          <p>
            Capture signal, score ideas, draft variants, review claims, prepare
            assets, publish manually, and learn from analytics.
          </p>
        </div>
        <div className="content-studio-pill">
          {contentRootId ? "Workspace pack ready" : "Creating workspace pack"}
        </div>
      </div>

      <ContentStudioDashboard
        summary={dashboardSummary}
        onSelectPanel={selectPanel}
      />

      <div className="content-studio-pill">Selected: {activePanel}</div>

      <ContentIdeaPanel
        playbooks={CONTENT_STUDIO_PLAYBOOKS}
        selectedPlaybookId={selectedPlaybookId}
        onSelectPlaybook={selectPlaybook}
        ideaTitle={ideaTitle}
        sourceUrlsText={sourceUrlsText}
        audience={audience}
        angle={angle}
        rubric={rubric}
        overrideLowScore={overrideLowScore}
        scoreText={`Score: ${score.total}/${score.max} - ${score.recommendation}`}
        runMessage={runMessage}
        variantMessage={variantMessage}
        lastAssistantRunId={lastAssistantRunId}
        onIdeaTitleChange={setIdeaTitle}
        onSourceUrlsChange={setSourceUrlsText}
        onAudienceChange={setAudience}
        onAngleChange={setAngle}
        onRubricChange={updateRubric}
        onOverrideChange={setOverrideLowScore}
        onScoreIdea={scoreIdea}
        onStartRun={() => void startRun()}
        onGenerateVariants={() => void generateVariants()}
        onSaveAssistantResult={() => void saveAssistantResult()}
      />

      <DraftWorkbench
        draftText={draftText}
        variants={draftVariants}
        qualityMessage={qualityMessage}
        onDraftTextChange={setDraftText}
        onApproveDraft={() => void runQualityGate()}
        onApproveVariant={approveVariant}
      >
        <div className="you-rules-list learning-surface-list-mt">
          <label className="memory-entry-card">
            <input
              type="checkbox"
              checked={hasMaterialConnection}
              onChange={(event) =>
                setHasMaterialConnection(event.target.checked)
              }
            />
            <span className="memory-entry-content">
              Material connection exists
            </span>
          </label>
          <label className="memory-entry-card">
            <input
              type="checkbox"
              checked={syntheticMedia}
              onChange={(event) => setSyntheticMedia(event.target.checked)}
            />
            <span className="memory-entry-content">
              Realistic synthetic media used
            </span>
          </label>
          <label className="memory-entry-card">
            <input
              type="checkbox"
              checked={syntheticDisclosure}
              onChange={(event) => setSyntheticDisclosure(event.target.checked)}
            />
            <span className="memory-entry-content">
              Synthetic media disclosed
            </span>
          </label>
        </div>
        <input
          className="inbox-input"
          aria-label="Disclosure text"
          value={disclosureText}
          onChange={(event) => setDisclosureText(event.target.value)}
          placeholder="Visible disclosure text, when needed"
        />
        <EvidenceLedger
          claims={qualityClaims}
          evidenceUrl={evidenceUrl}
          evidenceSnippet={evidenceSnippet}
          onEvidenceUrlChange={setEvidenceUrl}
          onEvidenceSnippetChange={setEvidenceSnippet}
          onAttachEvidence={() => void attachEvidence()}
        />
      </DraftWorkbench>

      <PublishQueue
        manualPublishUrl={manualPublishUrl}
        plannedPublishedAt={plannedPublishedAt}
        onManualPublishUrlChange={setManualPublishUrl}
        onPlannedPublishedAtChange={setPlannedPublishedAt}
        onMarkPublished={() => void markPublished()}
        onRunWeeklyReview={() => void runWeeklyReview()}
      />

      <AnalyticsLoop
        analyticsSlug={analyticsSlug}
        views={views}
        bookmarks={bookmarks}
        likes={likes}
        comments={comments}
        analytics={analytics}
        onSlugChange={setAnalyticsSlug}
        onViewsChange={setViews}
        onBookmarksChange={setBookmarks}
        onLikesChange={setLikes}
        onCommentsChange={setComments}
        onLogAnalytics={logAnalytics}
      />

      <WeeklyReviewPanel onRunWeeklyReview={() => void runWeeklyReview()} />
    </div>
  );
}
