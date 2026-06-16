import { useEffect, useMemo, useState } from "react";
import {
  calculateBmLike,
  canStartContentRun,
  buildContentWriterPrompt,
  CONTENT_STUDIO_FOLDERS,
  evaluateDraftQuality,
  parseDraftVariants,
  scoreContentIdea,
  type AnalyticsSnapshot,
  type ContentIdea,
  type ContentRun,
  type ContentStudioRubric,
  type DraftClaim,
} from "../../../../../shared/content-studio";
import { ASSISTANT_RECIPE_TEMPLATES } from "../../../../../shared/assistant-recipes";
import { blk } from "../lib/ids";
import { useStore } from "../store";
import type { PageMeta, TreeNode } from "../types";
import {
  saveAnalyticsSnapshot,
  saveContentRun,
  saveDraftVariant,
  savePublishedPost,
} from "./contentStudioStorage";

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

const RUBRIC_LABELS: Array<[keyof ContentStudioRubric, string]> = [
  ["bookmarkability", "Bookmarkable"],
  ["proof", "Hard proof"],
  ["immediateUse", "Useful now"],
  ["audienceClarity", "Audience clear"],
  ["reproducibility", "Can follow it"],
  ["hookStrength", "Strong hook"],
  ["originality", "Original value"],
];

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

export function ContentStudioSurface({
  profile = "default",
}: {
  profile?: string;
}): React.JSX.Element {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const makePage = useStore((s) => s.makePage);
  const flash = useStore((s) => s.flash);
  const [contentRootId, setContentRootId] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [audience, setAudience] = useState("");
  const [angle, setAngle] = useState("");
  const [rubric, setRubric] = useState<ContentStudioRubric>(EMPTY_RUBRIC);
  const [overrideLowScore, setOverrideLowScore] = useState(false);
  const [currentIdea, setCurrentIdea] = useState<ContentIdea | null>(null);
  const [currentRun, setCurrentRun] = useState<ContentRun | null>(null);
  const [runMessage, setRunMessage] = useState("");
  const [variantMessage, setVariantMessage] = useState("");
  const [lastAssistantRunId, setLastAssistantRunId] = useState("");
  const [draftText, setDraftText] = useState("");
  const [hasMaterialConnection, setHasMaterialConnection] = useState(false);
  const [disclosureText, setDisclosureText] = useState("");
  const [syntheticMedia, setSyntheticMedia] = useState(false);
  const [syntheticDisclosure, setSyntheticDisclosure] = useState(false);
  const [qualityMessage, setQualityMessage] = useState("");
  const [qualityClaims, setQualityClaims] = useState<DraftClaim[]>([]);
  const [analyticsSlug, setAnalyticsSlug] = useState("");
  const [bookmarks, setBookmarks] = useState("");
  const [likes, setLikes] = useState("");
  const [analytics, setAnalytics] = useState<
    (AnalyticsSnapshot & { slug: string; bmLike: number | null })[]
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

  const score = useMemo(() => scoreContentIdea(rubric), [rubric]);

  function buildIdea(): ContentIdea {
    const date = today();
    return {
      id: `idea-${slug(ideaTitle || "untitled")}`,
      title: ideaTitle.trim() || "Untitled content idea",
      sourceUrls: sourceUrl.trim() ? [sourceUrl.trim()] : [],
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
      sourceUrls: currentIdea?.sourceUrls ?? (sourceUrl ? [sourceUrl] : []),
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
        platform: currentRun?.platform || "x",
        finalCopy: draftText,
        linkComment: sourceUrl,
        sourceNotes: (currentIdea?.sourceUrls ?? [sourceUrl])
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

  function logAnalytics(): void {
    const snapshot = {
      slug: analyticsSlug.trim() || "untitled-post",
      platform: "x",
      snapshotWindow: "manual" as const,
      bookmarks: numberValue(bookmarks),
      likes: numberValue(likes),
      capturedAt: new Date().toISOString(),
    };
    void saveAnalyticsSnapshot(snapshot, profile);
    setAnalytics((items) => [
      ...items,
      { ...snapshot, bmLike: calculateBmLike(snapshot) },
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
    const winner = [...analyticsRows].sort(
      (a, b) => Number(b.props?.bmLike ?? 0) - Number(a.props?.bmLike ?? 0),
    )[0];
    const hookRoute =
      typeof winner?.props?.hookRoute === "string"
        ? winner.props.hookRoute
        : "proof-led";
    const body = `Content Studio hook rule: prefer ${hookRoute} when BM/Like is strong.`;
    await api.createLearningProposal?.(
      { kind: "memory", body, source: { type: "manual" } },
      profile,
    );
    await api.spsCreateVaultProposal?.({
      source: "manual",
      title: "Content Studio weekly review",
      summary:
        "Review Content Studio winners and update hook, voice, source, and template rules.",
      operations: [
        {
          id: `content-weekly-${Date.now()}`,
          kind: "upsert-page",
          pageId: "content-studio-weekly-review",
          title: "Content Studio Weekly Review",
          markdown: `# Content Studio Weekly Review\n\n${body}\n`,
        },
      ],
    });
    flash("Weekly review queued for Learn This and Review Queue.");
  }

  function updateRubric(key: keyof ContentStudioRubric, value: string): void {
    setRubric((current) => ({ ...current, [key]: numberValue(value) }));
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

      <section className="active-work-section">
        <h2>Score Idea</h2>
        <div className="content-studio-grid">
          <label>
            <span>Idea title</span>
            <input
              aria-label="Idea title"
              className="inbox-input"
              value={ideaTitle}
              onChange={(event) => setIdeaTitle(event.target.value)}
              placeholder="Agent-Reach setup without API-key hype"
            />
          </label>
          <label>
            <span>Source URL</span>
            <input
              aria-label="Source URL"
              className="inbox-input"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com/source"
            />
          </label>
          <label>
            <span>Audience</span>
            <input
              aria-label="Audience"
              className="inbox-input"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="Who should save this?"
            />
          </label>
          <label>
            <span>Angle</span>
            <input
              aria-label="Angle"
              className="inbox-input"
              value={angle}
              onChange={(event) => setAngle(event.target.value)}
              placeholder="What original value does this add?"
            />
          </label>
        </div>
        <div className="content-studio-rubric">
          {RUBRIC_LABELS.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                aria-label={label}
                type="number"
                min={0}
                max={2}
                className="inbox-input"
                value={rubric[key]}
                onChange={(event) => updateRubric(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="memory-entry-card">
          <input
            type="checkbox"
            aria-label="Override low score"
            checked={overrideLowScore}
            onChange={(event) => setOverrideLowScore(event.target.checked)}
          />
          <span className="memory-entry-content">
            Override low score
            <small className="learning-surface-small-block">
              Use only when a strategic reason beats the rubric.
            </small>
          </span>
        </label>
        <div className="memory-entry-form-actions">
          <button className="btn btn-secondary btn-sm" onClick={scoreIdea}>
            Score idea
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void startRun()}
          >
            Start content run
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void generateVariants()}
          >
            Generate variants
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={!lastAssistantRunId}
            onClick={() => void saveAssistantResult()}
          >
            Save assistant result to Review Queue
          </button>
        </div>
        <div className="content-studio-score">
          Score: {score.total}/{score.max} - {score.recommendation}
        </div>
        {runMessage && <div className="active-work-error">{runMessage}</div>}
        {variantMessage && (
          <div className="content-studio-quality">{variantMessage}</div>
        )}
      </section>

      <section className="active-work-section">
        <h2>Draft Quality Gate</h2>
        <textarea
          className="memory-entry-textarea"
          aria-label="Final draft"
          rows={5}
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          placeholder="Paste the final approved draft here before publishing manually."
        />
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
        <button
          className="btn btn-primary btn-sm"
          onClick={() => void runQualityGate()}
        >
          Approve final draft
        </button>
        {qualityClaims.length > 0 && (
          <div className="content-studio-quality">
            {qualityClaims.map((claim) => (
              <div key={`${claim.kind}-${claim.text}`}>
                {claim.text} - {claim.status}
              </div>
            ))}
          </div>
        )}
        {qualityMessage && (
          <div className="content-studio-quality">{qualityMessage}</div>
        )}
      </section>

      <section className="active-work-section">
        <h2>Publish Packet</h2>
        <div className="content-studio-packet">
          <div>
            <strong>Asset brief</strong>
            <p>
              Create a concrete visual prompt, attach the final asset manually,
              and disclose realistic synthetic media where needed.
            </p>
          </div>
          <div>
            <strong>Manual publishing only</strong>
            <p>
              SPS prepares copy, source notes, and a link comment. It does not
              auto-post, bulk-post, import cookies, or bypass platform rules.
            </p>
          </div>
          <div>
            <strong>Weekly review</strong>
            <p>
              Compare winners by bookmark ratio and propose new hook, voice,
              source, and template learnings through Learn This.
            </p>
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void runWeeklyReview()}
        >
          Run weekly review
        </button>
      </section>

      <section className="active-work-section">
        <h2>Analytics</h2>
        <div className="content-studio-grid">
          <label>
            <span>Analytics slug</span>
            <input
              aria-label="Analytics slug"
              className="inbox-input"
              value={analyticsSlug}
              onChange={(event) => setAnalyticsSlug(event.target.value)}
              placeholder="agent-reach-setup"
            />
          </label>
          <label>
            <span>Bookmarks</span>
            <input
              aria-label="Bookmarks"
              className="inbox-input"
              type="number"
              min={0}
              value={bookmarks}
              onChange={(event) => setBookmarks(event.target.value)}
            />
          </label>
          <label>
            <span>Likes</span>
            <input
              aria-label="Likes"
              className="inbox-input"
              type="number"
              min={0}
              value={likes}
              onChange={(event) => setLikes(event.target.value)}
            />
          </label>
        </div>
        <button className="btn btn-primary btn-sm" onClick={logAnalytics}>
          Log analytics
        </button>
        <div className="content-studio-analytics">
          {analytics.map((item) => (
            <div key={`${item.slug}-${item.bookmarks}-${item.likes}`}>
              <strong>{item.slug}</strong>
              <span>
                BM/Like {item.bmLike === null ? "n/a" : item.bmLike.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
