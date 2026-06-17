import { parse, stringify } from "yaml";

export type ContentIdeaStatus =
  | "captured"
  | "scored"
  | "running"
  | "drafting"
  | "approved"
  | "published"
  | "learned";

export interface ContentStudioRubric {
  bookmarkability: number;
  proof: number;
  immediateUse: number;
  audienceClarity: number;
  reproducibility: number;
  hookStrength: number;
  originality: number;
}

export interface ContentIdea {
  id: string;
  title: string;
  sourceUrls: string[];
  audience: string;
  angle: string;
  createdAt: string;
  updatedAt: string;
  status: ContentIdeaStatus;
  rubric: ContentStudioRubric;
  overrideLowScore?: boolean;
  capturedFrom?: string;
}

export interface ContentIdeaSourceRecord {
  url: string;
  title?: string;
  excerpt?: string;
}

export interface BuildContentIdeaFromSourcesInput {
  id?: string;
  title?: string;
  sources: ContentIdeaSourceRecord[];
  audience?: string;
  angle?: string;
  capturedFrom?: string;
  createdAt?: string;
  rubric?: Partial<ContentStudioRubric>;
}

export interface ContentRun {
  id: string;
  ideaId: string;
  title: string;
  platform: string;
  hookRoute: string;
  state: "drafting" | "verification" | "review" | "approved" | "published";
  createdAt: string;
  sourceUrls: string[];
}

export interface DraftVariant {
  id: string;
  runId: string;
  title: string;
  text: string;
  hookRoute: string;
  approved: boolean;
  status?: "draft" | "needs-review" | "approved" | "rejected";
  sourceNotes?: string;
  assetBrief?: string;
  disclosureNotes?: string;
  approvedAt?: string;
  qualityStatus?: "unchecked" | "blocked" | "ready";
  claimCount?: number;
  unsupportedClaimCount?: number;
}

export interface AssetBrief {
  id: string;
  runId: string;
  prompt: string;
  disclosureRequired: boolean;
  attachedAssetPath?: string;
}

export interface PublishedPost {
  id: string;
  runId: string;
  slug: string;
  url?: string;
  status?: "ready" | "published" | "needs-fix";
  publishedAt?: string;
  platform?: string;
  finalCopy?: string;
  linkComment?: string;
  sourceNotes?: string;
  disclosureText?: string;
  assetChecklist?: string[];
  plannedPublishedAt?: string;
  manualPublishUrl?: string;
}

export interface AnalyticsSnapshot {
  slug?: string;
  platform?: string;
  publishedPostId?: string;
  snapshotWindow?: "24h" | "72h" | "7d" | "manual";
  bookmarks: number;
  likes: number;
  views?: number;
  comments?: number;
  reposts?: number;
  bmLike?: number | null;
  commentRate?: number | null;
  bookmarkRate?: number | null;
  notes?: string;
  capturedAt?: string;
}

export interface ContentEvidence {
  id: string;
  claimId: string;
  runId: string;
  draftId: string;
  sourceUrl: string;
  sourceTitle: string;
  snippet: string;
  note: string;
  createdAt: string;
}

export interface ContentScore {
  total: number;
  max: 14;
  recommendation: "write" | "refine" | "skip";
}

export interface DraftQualityInput {
  text: string;
  sourceUrls: string[];
  evidence?: ContentEvidence[];
  draftId?: string;
  runId?: string;
  hasMaterialConnection: boolean;
  disclosureText: string;
  includesRealisticSyntheticMedia: boolean;
  syntheticMediaDisclosure: boolean;
}

export interface DraftQualityResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  claims: DraftClaim[];
}

export interface DraftClaim {
  claimId: string;
  text: string;
  kind: "numeric" | "absolute";
  status: "sourced" | "needs source" | "unsupported";
  evidenceIds: string[];
}

export type ContentStudioRowKind =
  | "content-idea"
  | "content-run"
  | "draft-variant"
  | "asset-brief"
  | "published-post"
  | "analytics-snapshot"
  | "content-evidence";

export interface ContentStudioRow {
  folder: string;
  rowId: string;
  props: Record<string, unknown>;
  body: string;
}

export interface ParsedDraftVariants {
  variants: DraftVariant[];
  fallback: boolean;
}

export interface ContentStudioVaultRow {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

export interface ContentStudioDashboardRows {
  ideas: ContentStudioVaultRow[];
  runs: ContentStudioVaultRow[];
  drafts: ContentStudioVaultRow[];
  published: ContentStudioVaultRow[];
  analytics: ContentStudioVaultRow[];
}

export type ContentStudioPanel =
  | "ideas"
  | "runs"
  | "drafts"
  | "evidence"
  | "publish"
  | "analytics"
  | "review";

export interface ContentStudioDashboardSummary {
  capturedIdeasNeedingScore: number;
  highScoreIdeasReadyForRun: number;
  activeRunsNeedingVariants: number;
  draftsNeedingEvidence: number;
  publishPacketsReady: number;
  analyticsDue: number;
  weeklyReviewDue: boolean;
}

export interface ContentStudioNextAction {
  panel: ContentStudioPanel;
  label: string;
  count: number;
  priority: number;
}

export interface ContentAnalyticsPost {
  slug: string;
  hookRoute: string;
  bmLike: number | null;
  bookmarks: number;
  likes: number;
  comments: number;
  views: number;
  bookmarkRate: number | null;
  commentRate: number | null;
}

export interface ContentAnalyticsSummary {
  topPosts: ContentAnalyticsPost[];
  weakPosts: ContentAnalyticsPost[];
  highBookmarkLowLikePosts: ContentAnalyticsPost[];
}

export interface WeeklyReviewProposals {
  memoryRules: string[];
  vaultTitle: string;
  vaultMarkdown: string;
}

export interface ContentStudioPlaybook {
  id: string;
  title: string;
  defaultPlatform: string;
  rubric: ContentStudioRubric;
  suggestedHookRoutes: string[];
  evidenceRequirements: string[];
  assetBriefPrompt: string;
  publishChecklist: string[];
  bypassesQualityGate: false;
}

export const CONTENT_STUDIO_FOLDERS = {
  ideas: "content-ideas",
  runs: "content-runs",
  drafts: "content-drafts",
  assets: "content-assets",
  published: "content-published",
  analytics: "content-analytics",
  evidence: "content-evidence",
} as const;

export const CONTENT_STUDIO_PLAYBOOKS: ContentStudioPlaybook[] = [
  {
    id: "ai-tool-teardown",
    title: "AI tool teardown",
    defaultPlatform: "x",
    rubric: {
      bookmarkability: 2,
      proof: 2,
      immediateUse: 2,
      audienceClarity: 2,
      reproducibility: 1,
      hookStrength: 2,
      originality: 1,
    },
    suggestedHookRoutes: ["proof-led", "checklist", "contrarian"],
    evidenceRequirements: ["pricing/source page", "tested workflow", "limits"],
    assetBriefPrompt:
      "Show the tool, the workflow, and the result side by side.",
    publishChecklist: ["source link", "tested limitation", "manual publish"],
    bypassesQualityGate: false,
  },
  {
    id: "workflow-before-after",
    title: "Workflow before/after",
    defaultPlatform: "x",
    rubric: {
      bookmarkability: 2,
      proof: 1,
      immediateUse: 2,
      audienceClarity: 2,
      reproducibility: 2,
      hookStrength: 1,
      originality: 2,
    },
    suggestedHookRoutes: ["before-after", "checklist"],
    evidenceRequirements: ["before state", "after state", "steps"],
    assetBriefPrompt: "Show the old flow, the new flow, and the saved step.",
    publishChecklist: [
      "steps included",
      "before/after clear",
      "manual publish",
    ],
    bypassesQualityGate: false,
  },
  {
    id: "research-backed-short-post",
    title: "Research-backed short post",
    defaultPlatform: "x",
    rubric: {
      bookmarkability: 2,
      proof: 2,
      immediateUse: 1,
      audienceClarity: 2,
      reproducibility: 1,
      hookStrength: 2,
      originality: 2,
    },
    suggestedHookRoutes: ["proof-led", "surprising-stat"],
    evidenceRequirements: ["primary source", "numeric claim", "context"],
    assetBriefPrompt: "Make a small source-backed chart or annotated excerpt.",
    publishChecklist: ["claim evidence", "source note", "manual publish"],
    bypassesQualityGate: false,
  },
  {
    id: "product-launch-post",
    title: "Product launch post",
    defaultPlatform: "x",
    rubric: {
      bookmarkability: 1,
      proof: 1,
      immediateUse: 2,
      audienceClarity: 2,
      reproducibility: 1,
      hookStrength: 2,
      originality: 2,
    },
    suggestedHookRoutes: ["problem-solution", "demo"],
    evidenceRequirements: ["live product", "claim support", "availability"],
    assetBriefPrompt: "Show the product in use, with one concrete result.",
    publishChecklist: [
      "availability clear",
      "asset attached",
      "manual publish",
    ],
    bypassesQualityGate: false,
  },
  {
    id: "case-study",
    title: "Case study",
    defaultPlatform: "x",
    rubric: {
      bookmarkability: 2,
      proof: 2,
      immediateUse: 1,
      audienceClarity: 2,
      reproducibility: 1,
      hookStrength: 2,
      originality: 2,
    },
    suggestedHookRoutes: ["proof-led", "before-after"],
    evidenceRequirements: ["baseline", "outcome", "method"],
    assetBriefPrompt:
      "Show the starting point, intervention, and measurable result.",
    publishChecklist: ["baseline sourced", "outcome sourced", "manual publish"],
    bypassesQualityGate: false,
  },
];

const RUBRIC_FIELDS: Array<keyof ContentStudioRubric> = [
  "bookmarkability",
  "proof",
  "immediateUse",
  "audienceClarity",
  "reproducibility",
  "hookStrength",
  "originality",
];

const NUMERIC_CLAIM_RE =
  /\b\d[\d,.]*(?:\s?(?:k|m|b))?(?:\s?(?:%|views?|likes?|bookmarks?|runs?|minutes?|hours?|\$))?\b/i;
const NUMERIC_CLAIM_GLOBAL_RE =
  /\b\d[\d,.]*(?:\s?(?:k|m|b))?(?:\s?(?:%|views?|likes?|bookmarks?|runs?|minutes?|hours?|\$))?\b/gi;
const ABSOLUTE_CLAIM_RE =
  /\b(always|never|guaranteed|guarantees|replaces|free|best)\b[^.!?\n]*/gi;
const SLOP_PATTERNS = [
  /\bgame[- ]changing\b/i,
  /\brevolutionary\b/i,
  /\bgroundbreaking\b/i,
  /\bAI slop\b/i,
  /\bzero API keys\b/i,
  /\bguaranteed free\b/i,
  /\breplaces every\b/i,
];

const SOURCE_URL_RE = /https?:\/\/[^\s<>"'`,\]]+/gi;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2, Math.round(value)));
}

function trimSourceUrl(url: string): string {
  return url.trim().replace(/[).;:!?]+$/g, "");
}

export function parseContentSourceUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(SOURCE_URL_RE)) {
    const url = trimSourceUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function normalizeContentSourceRecords(
  sources: ContentIdeaSourceRecord[],
): ContentIdeaSourceRecord[] {
  const seen = new Set<string>();
  const result: ContentIdeaSourceRecord[] = [];
  for (const source of sources) {
    const url = trimSourceUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({
      url,
      title: source.title?.trim() || undefined,
      excerpt: source.excerpt?.trim() || undefined,
    });
  }
  return result;
}

function contentIdeaSourceAngle(sources: ContentIdeaSourceRecord[]): string {
  return sources
    .map((source) =>
      [source.title || source.url, source.excerpt].filter(Boolean).join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

export function buildContentIdeaFromSources(
  input: BuildContentIdeaFromSourcesInput,
): ContentIdea {
  const date = input.createdAt || new Date().toISOString().slice(0, 10);
  const sources = normalizeContentSourceRecords(input.sources);
  const title =
    input.title?.trim() || sources[0]?.title || "Content idea from sources";
  return {
    id: input.id || contentRowId("content-idea", title),
    title,
    sourceUrls: sources.map((source) => source.url),
    audience: input.audience?.trim() || "",
    angle:
      input.angle?.trim() ||
      contentIdeaSourceAngle(sources) ||
      "Captured from Sources.",
    createdAt: date,
    updatedAt: date,
    status: "captured",
    capturedFrom: input.capturedFrom,
    rubric: {
      bookmarkability: clampScore(Number(input.rubric?.bookmarkability ?? 0)),
      proof: clampScore(
        Number(input.rubric?.proof ?? (sources.length ? 1 : 0)),
      ),
      immediateUse: clampScore(Number(input.rubric?.immediateUse ?? 0)),
      audienceClarity: clampScore(Number(input.rubric?.audienceClarity ?? 0)),
      reproducibility: clampScore(Number(input.rubric?.reproducibility ?? 0)),
      hookStrength: clampScore(Number(input.rubric?.hookStrength ?? 0)),
      originality: clampScore(Number(input.rubric?.originality ?? 0)),
    },
  };
}

export function scoreContentIdea(rubric: ContentStudioRubric): ContentScore {
  const total = RUBRIC_FIELDS.reduce(
    (sum, field) => sum + clampScore(rubric[field]),
    0,
  );
  return {
    total,
    max: 14,
    recommendation: total >= 10 ? "write" : total >= 7 ? "refine" : "skip",
  };
}

export function canStartContentRun(idea: ContentIdea): {
  ok: boolean;
  reason?: string;
} {
  const score = scoreContentIdea(idea.rubric);
  if (score.total < 10 && !idea.overrideLowScore) {
    return {
      ok: false,
      reason:
        "Score at least 10/14 or explicitly override before starting a run.",
    };
  }
  if (idea.sourceUrls.length === 0) {
    return {
      ok: false,
      reason: "Add at least one source link before starting a run.",
    };
  }
  return { ok: true };
}

export function evaluateDraftQuality(
  input: DraftQualityInput,
): DraftQualityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const text = input.text.trim();
  const claims = extractDraftClaims(
    text,
    input.sourceUrls,
    input.evidence ?? [],
    input.draftId,
  );

  if (input.sourceUrls.length === 0) {
    blockers.push("Add at least one source link before approval.");
  }
  if (input.hasMaterialConnection && !input.disclosureText.trim()) {
    blockers.push("Add a clear sponsorship/free-product disclosure.");
  }
  if (
    input.includesRealisticSyntheticMedia &&
    !input.syntheticMediaDisclosure
  ) {
    blockers.push(
      "Disclose realistic AI-generated or meaningfully altered media.",
    );
  }
  if (NUMERIC_CLAIM_RE.test(text) && input.sourceUrls.length === 0) {
    blockers.push("Support numeric or performance claims with a source.");
    blockers.push("Support claims with source links before approval.");
  }
  if (claims.some((claim) => claim.status !== "sourced")) {
    blockers.push("Support claims with source links before approval.");
  }

  for (const pattern of SLOP_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(
        "Review hype, automation, or platform-access claims for accuracy.",
      );
      break;
    }
  }

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings,
    claims,
  };
}

export function calculateBmLike(
  snapshot: Pick<AnalyticsSnapshot, "bookmarks" | "likes">,
): number | null {
  if (snapshot.likes <= 0) return null;
  return Number((snapshot.bookmarks / snapshot.likes).toFixed(2));
}

export function calculateRate(
  numerator: number,
  denominator?: number,
): number | null {
  if (!denominator || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function serializeContentIdeaMarkdown(idea: ContentIdea): string {
  const frontmatter = stringify({
    type: "content-idea",
    id: idea.id,
    status: idea.status,
    sourceUrls: idea.sourceUrls,
    audience: idea.audience,
    angle: idea.angle,
    createdAt: idea.createdAt,
    updatedAt: idea.updatedAt,
    rubric: idea.rubric,
    overrideLowScore: idea.overrideLowScore ?? false,
  }).trim();
  return `---\n${frontmatter}\n---\n\n# ${idea.title}\n\n## Angle\n${idea.angle}\n`;
}

export function contentRowId(
  kind: ContentStudioRowKind,
  titleOrSlug: string,
): string {
  const slug =
    titleOrSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled";
  return `${kind}-${slug}`;
}

export function contentIdeaToRow(idea: ContentIdea): ContentStudioRow {
  const score = scoreContentIdea(idea.rubric);
  return {
    folder: CONTENT_STUDIO_FOLDERS.ideas,
    rowId: contentRowId("content-idea", idea.title),
    props: {
      type: "content-idea",
      id: idea.id,
      title: idea.title,
      status: idea.status,
      sourceUrls: idea.sourceUrls,
      audience: idea.audience,
      angle: idea.angle,
      score: score.total,
      recommendation: score.recommendation,
      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
      capturedFrom: idea.capturedFrom,
      overrideLowScore: idea.overrideLowScore ?? false,
      rubric: idea.rubric,
    },
    body: idea.angle,
  };
}

export function contentRunToRow(run: ContentRun): ContentStudioRow {
  return {
    folder: CONTENT_STUDIO_FOLDERS.runs,
    rowId: contentRowId("content-run", run.title),
    props: {
      type: "content-run",
      id: run.id,
      ideaId: run.ideaId,
      title: run.title,
      platform: run.platform,
      hookRoute: run.hookRoute,
      state: run.state,
      createdAt: run.createdAt,
      sourceUrls: run.sourceUrls,
      status: run.state,
    },
    body: run.sourceUrls.map((url) => `- ${url}`).join("\n"),
  };
}

export function draftVariantToRow(variant: DraftVariant): ContentStudioRow {
  return {
    folder: CONTENT_STUDIO_FOLDERS.drafts,
    rowId: contentRowId("draft-variant", `${variant.runId}-${variant.title}`),
    props: {
      type: "draft-variant",
      id: variant.id,
      runId: variant.runId,
      title: variant.title,
      hookRoute: variant.hookRoute,
      status: variant.status ?? (variant.approved ? "approved" : "draft"),
      approved: variant.approved,
      sourceNotes: variant.sourceNotes,
      assetBrief: variant.assetBrief,
      disclosureNotes: variant.disclosureNotes,
      approvedAt: variant.approvedAt,
      qualityStatus: variant.qualityStatus,
      claimCount: variant.claimCount ?? 0,
      unsupportedClaimCount: variant.unsupportedClaimCount ?? 0,
    },
    body: variant.text,
  };
}

export function analyticsSnapshotToRow(
  snapshot: AnalyticsSnapshot,
): ContentStudioRow {
  const slug = snapshot.slug || "untitled-post";
  const window = snapshot.snapshotWindow || "manual";
  const bmLike = calculateBmLike(snapshot);
  const bookmarkRate =
    snapshot.bookmarkRate ?? calculateRate(snapshot.bookmarks, snapshot.views);
  const commentRate =
    snapshot.commentRate ??
    calculateRate(snapshot.comments ?? 0, snapshot.views);
  return {
    folder: CONTENT_STUDIO_FOLDERS.analytics,
    rowId: contentRowId("analytics-snapshot", `${slug}-${window}`),
    props: {
      type: "analytics-snapshot",
      title: `${slug} ${window}`,
      slug,
      platform: snapshot.platform || "x",
      publishedPostId: snapshot.publishedPostId,
      snapshotWindow: window,
      views: snapshot.views ?? 0,
      likes: snapshot.likes,
      bookmarks: snapshot.bookmarks,
      comments: snapshot.comments ?? 0,
      reposts: snapshot.reposts ?? 0,
      bmLike,
      bookmarkRate,
      commentRate,
      capturedAt: snapshot.capturedAt || new Date().toISOString(),
    },
    body: snapshot.notes || "",
  };
}

export function publishedPostToRow(post: PublishedPost): ContentStudioRow {
  return {
    folder: CONTENT_STUDIO_FOLDERS.published,
    rowId: contentRowId("published-post", post.slug || post.id),
    props: {
      type: "published-post",
      id: post.id,
      runId: post.runId,
      title: post.slug,
      slug: post.slug,
      platform: post.platform || "x",
      url: post.url,
      status: post.status || "ready",
      publishedAt: post.publishedAt,
      disclosureText: post.disclosureText,
      assetChecklist: post.assetChecklist ?? [],
      plannedPublishedAt: post.plannedPublishedAt,
      manualPublishUrl: post.manualPublishUrl,
    },
    body: [
      "## Final Copy",
      post.finalCopy || "",
      "",
      "## Link Comment",
      post.linkComment || "",
      "",
      "## Source Notes",
      post.sourceNotes || "",
    ].join("\n"),
  };
}

export function contentEvidenceToRow(
  evidence: ContentEvidence,
): ContentStudioRow {
  return {
    folder: CONTENT_STUDIO_FOLDERS.evidence,
    rowId: contentRowId(
      "content-evidence",
      `${evidence.claimId}-${evidence.id}`,
    ),
    props: {
      type: "content-evidence",
      id: evidence.id,
      claimId: evidence.claimId,
      runId: evidence.runId,
      draftId: evidence.draftId,
      sourceUrl: evidence.sourceUrl,
      sourceTitle: evidence.sourceTitle,
      createdAt: evidence.createdAt,
    },
    body: [evidence.snippet, evidence.note].join("\n\n"),
  };
}

export function rowToContentIdea(
  props: Record<string, unknown>,
  body: string,
): ContentIdea {
  return {
    id: String(props.id || contentRowId("content-idea", String(props.title))),
    title: String(props.title || "Untitled content idea"),
    sourceUrls: arrayOfStrings(props.sourceUrls),
    audience: String(props.audience || ""),
    angle: String(props.angle || body || ""),
    createdAt: String(props.createdAt || ""),
    updatedAt: String(props.updatedAt || ""),
    status: (props.status || "captured") as ContentIdeaStatus,
    rubric: normalizeRubric(props.rubric),
    overrideLowScore: Boolean(props.overrideLowScore),
    capturedFrom:
      typeof props.capturedFrom === "string" ? props.capturedFrom : undefined,
  };
}

export function rowToAnalyticsSnapshot(
  props: Record<string, unknown>,
  body: string,
): AnalyticsSnapshot {
  return {
    slug: String(props.slug || props.title || "untitled-post"),
    platform: typeof props.platform === "string" ? props.platform : "x",
    publishedPostId:
      typeof props.publishedPostId === "string"
        ? props.publishedPostId
        : undefined,
    snapshotWindow: isSnapshotWindow(props.snapshotWindow)
      ? props.snapshotWindow
      : "manual",
    views: numberFrom(props.views),
    likes: numberFrom(props.likes),
    bookmarks: numberFrom(props.bookmarks),
    comments: numberFrom(props.comments),
    reposts: numberFrom(props.reposts),
    bmLike:
      typeof props.bmLike === "number"
        ? props.bmLike
        : calculateBmLike({
            bookmarks: numberFrom(props.bookmarks),
            likes: numberFrom(props.likes),
          }),
    notes: body,
    capturedAt:
      typeof props.capturedAt === "string" ? props.capturedAt : undefined,
  };
}

export function rowToContentEvidence(
  props: Record<string, unknown>,
  body: string,
): ContentEvidence {
  const [snippet, ...noteParts] = body.split(/\n\n/);
  return {
    id: String(
      props.id || contentRowId("content-evidence", String(props.claimId)),
    ),
    claimId: String(props.claimId || ""),
    runId: String(props.runId || ""),
    draftId: String(props.draftId || ""),
    sourceUrl: String(props.sourceUrl || ""),
    sourceTitle: String(props.sourceTitle || ""),
    snippet: snippet || "",
    note: noteParts.join("\n\n"),
    createdAt: String(props.createdAt || ""),
  };
}

export function buildContentStudioDashboard(
  rows: ContentStudioDashboardRows,
): ContentStudioDashboardSummary {
  const draftRunIds = new Set(
    rows.drafts.map((row) => String(row.props.runId || "")).filter(Boolean),
  );
  const publishedWindows = new Map<string, Set<string>>();
  for (const row of rows.analytics) {
    const slug = String(row.props.slug || "");
    const window = String(row.props.snapshotWindow || "");
    if (!slug || !window) continue;
    const set = publishedWindows.get(slug) ?? new Set<string>();
    set.add(window);
    publishedWindows.set(slug, set);
  }

  return {
    capturedIdeasNeedingScore: rows.ideas.filter(
      (row) => String(row.props.status || "") === "captured",
    ).length,
    highScoreIdeasReadyForRun: rows.ideas.filter((row) => {
      const status = String(row.props.status || "");
      return (
        Number(row.props.score ?? 0) >= 10 &&
        (status === "captured" || status === "scored")
      );
    }).length,
    activeRunsNeedingVariants: rows.runs.filter((row) => {
      const id = String(row.props.id || "");
      const state = String(row.props.state || row.props.status || "");
      return state === "drafting" && !draftRunIds.has(id);
    }).length,
    draftsNeedingEvidence: rows.drafts.filter((row) => {
      const status = String(row.props.status || "");
      return (
        status === "needs-review" ||
        Number(row.props.unsupportedClaimCount ?? 0) > 0
      );
    }).length,
    publishPacketsReady: rows.published.filter(
      (row) => String(row.props.status || "ready") === "ready",
    ).length,
    analyticsDue: rows.published.filter((row) => {
      if (String(row.props.status || "") !== "published") return false;
      const slug = String(row.props.slug || "");
      const windows = publishedWindows.get(slug) ?? new Set<string>();
      return !["24h", "72h", "7d"].every((window) => windows.has(window));
    }).length,
    weeklyReviewDue: rows.analytics.length > 0,
  };
}

export function contentStudioAttentionScore(
  item: Pick<ContentStudioNextAction, "count" | "priority">,
): number {
  return item.count * 10 + item.priority;
}

export function getNextContentActions(
  summary: ContentStudioDashboardSummary,
): ContentStudioNextAction[] {
  const actions: ContentStudioNextAction[] = [
    {
      panel: "evidence",
      label: "Review draft evidence",
      count: summary.draftsNeedingEvidence,
      priority: 7,
    },
    {
      panel: "publish",
      label: "Publish ready packets",
      count: summary.publishPacketsReady,
      priority: 6,
    },
    {
      panel: "runs",
      label: "Generate variants",
      count: summary.activeRunsNeedingVariants,
      priority: 5,
    },
    {
      panel: "ideas",
      label: "Score captured ideas",
      count: summary.capturedIdeasNeedingScore,
      priority: 4,
    },
    {
      panel: "ideas",
      label: "Start high-score runs",
      count: summary.highScoreIdeasReadyForRun,
      priority: 3,
    },
    {
      panel: "analytics",
      label: "Log due analytics",
      count: summary.analyticsDue,
      priority: 2,
    },
    {
      panel: "review",
      label: "Run weekly review",
      count: summary.weeklyReviewDue ? 1 : 0,
      priority: 1,
    },
  ];
  return actions
    .filter((action) => action.count > 0)
    .sort(
      (a, b) => contentStudioAttentionScore(b) - contentStudioAttentionScore(a),
    );
}

export function summarizeContentAnalytics(
  rows: ContentStudioVaultRow[],
): ContentAnalyticsSummary {
  const posts = rows
    .map(rowToAnalyticsPost)
    .filter((post): post is ContentAnalyticsPost => Boolean(post));
  const topPosts = [...posts].sort(
    (a, b) => Number(b.bmLike ?? 0) - Number(a.bmLike ?? 0),
  );
  return {
    topPosts,
    weakPosts: findWeakPosts(rows),
    highBookmarkLowLikePosts: findHighBookmarkLowLikePosts(rows),
  };
}

export function findWinningHookRoutes(rows: ContentStudioVaultRow[]): Array<{
  hookRoute: string;
  count: number;
  averageBmLike: number;
}> {
  const groups = new Map<string, { count: number; total: number }>();
  for (const post of rows.map(rowToAnalyticsPost).filter(Boolean)) {
    if (!post || (post.bmLike ?? 0) < 1) continue;
    const current = groups.get(post.hookRoute) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += post.bmLike ?? 0;
    groups.set(post.hookRoute, current);
  }
  return [...groups.entries()]
    .map(([hookRoute, value]) => ({
      hookRoute,
      count: value.count,
      averageBmLike: Number((value.total / value.count).toFixed(2)),
    }))
    .sort((a, b) => b.averageBmLike - a.averageBmLike);
}

export function findHighBookmarkLowLikePosts(
  rows: ContentStudioVaultRow[],
): ContentAnalyticsPost[] {
  return rows
    .map(rowToAnalyticsPost)
    .filter((post): post is ContentAnalyticsPost =>
      Boolean(post && (post.bmLike ?? 0) >= 1.5),
    );
}

export function findWeakPosts(
  rows: ContentStudioVaultRow[],
): ContentAnalyticsPost[] {
  return rows
    .map(rowToAnalyticsPost)
    .filter((post): post is ContentAnalyticsPost =>
      Boolean(post && post.bookmarks <= 2 && post.comments <= 1),
    );
}

export function buildWeeklyReviewProposals(
  summary: ContentAnalyticsSummary,
): WeeklyReviewProposals {
  const winner = summary.topPosts[0];
  const hookRoute = winner?.hookRoute || "proof-led";
  const memoryRules = [
    `Content Studio hook rule: prefer ${hookRoute} when BM/Like is strong.`,
    "Content Studio voice rule: keep claims concrete, sourced, and manually reviewed.",
    "Content Studio source rule: favor posts with reusable proof and clear evidence snippets.",
  ];
  return {
    memoryRules,
    vaultTitle: "Content Studio Weekly Review",
    vaultMarkdown: [
      "# Content Studio Weekly Review",
      "",
      `Winning hook route: ${hookRoute}`,
      `Top post: ${winner?.slug || "No analytics yet"}`,
      "",
      "## Template improvements",
      "- Keep evidence snippets close to every claim.",
      "- Promote drafts with high bookmark intent.",
    ].join("\n"),
  };
}

export function parseDraftVariants(
  text: string,
  runId: string,
): ParsedDraftVariants {
  const chunks = text
    .split(/(?=^Variant\s+[ABC]\b)/gim)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const variants = chunks
    .map((chunk, index): DraftVariant | null => {
      const titleMatch = chunk.match(/^Variant\s+([ABC])/i);
      if (!titleMatch) return null;
      const title = `Variant ${titleMatch[1].toUpperCase()}`;
      const field = (name: string): string => {
        const match = chunk.match(
          new RegExp(`${name}:\\s*([\\s\\S]*?)(?=\\n[a-zA-Z]+:|$)`, "i"),
        );
        return match?.[1]?.trim() || "";
      };
      return {
        id: `${runId}-${titleMatch[1].toLowerCase()}`,
        runId,
        title,
        hookRoute: field("hookRoute") || `variant-${index + 1}`,
        text: field("draftText"),
        sourceNotes: field("sourceNotes"),
        assetBrief: field("assetBrief"),
        disclosureNotes: field("disclosureNotes"),
        approved: false,
        status: "draft",
      };
    })
    .filter((variant): variant is DraftVariant =>
      Boolean(variant && variant.text),
    );
  if (variants.length === 3) return { variants, fallback: false };
  return {
    fallback: true,
    variants: [
      {
        id: `${runId}-raw`,
        runId,
        title: "Raw assistant result",
        hookRoute: "needs-review",
        text,
        approved: false,
        status: "needs-review",
      },
    ],
  };
}

export function buildContentWriterPrompt(input: {
  title: string;
  sourceUrls: string[];
  audience: string;
  angle: string;
  platform: string;
  hookRoute: string;
}): string {
  return [
    "Create exactly three review-first short-form draft variants.",
    "Use this exact structure for parsing:",
    "Variant A",
    "hookRoute: ...",
    "draftText: ...",
    "sourceNotes: ...",
    "assetBrief: ...",
    "disclosureNotes: ...",
    "",
    "Variant B",
    "hookRoute: ...",
    "draftText: ...",
    "sourceNotes: ...",
    "assetBrief: ...",
    "disclosureNotes: ...",
    "",
    "Variant C",
    "hookRoute: ...",
    "draftText: ...",
    "sourceNotes: ...",
    "assetBrief: ...",
    "disclosureNotes: ...",
    "",
    `Idea: ${input.title}`,
    `Audience: ${input.audience || "Unspecified"}`,
    `Angle: ${input.angle || "Unspecified"}`,
    `Platform: ${input.platform}`,
    `Hook route: ${input.hookRoute}`,
    `Sources: ${input.sourceUrls.join(", ") || "none"}`,
    "Do not invent numbers. Flag missing proof in sourceNotes.",
  ].join("\n");
}

export function parseContentIdeaMarkdown(markdown: string): ContentIdea {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n# ([^\n]+)/);
  if (!match) {
    throw new Error("Content idea markdown is missing frontmatter or title.");
  }
  const data = parse(match[1]) as Partial<ContentIdea> & {
    type?: string;
  };
  if (data.type !== "content-idea") {
    throw new Error("Markdown is not a Content Studio idea.");
  }
  return {
    id: String(data.id || ""),
    title: match[2].trim(),
    sourceUrls: Array.isArray(data.sourceUrls)
      ? data.sourceUrls.map(String)
      : [],
    audience: String(data.audience || ""),
    angle: String(data.angle || ""),
    createdAt: String(data.createdAt || ""),
    updatedAt: String(data.updatedAt || ""),
    status: (data.status || "captured") as ContentIdeaStatus,
    rubric: normalizeRubric(data.rubric),
    overrideLowScore: Boolean(data.overrideLowScore),
  };
}

export function normalizeRubric(value: unknown): ContentStudioRubric {
  const record =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof ContentStudioRubric, number>>)
      : {};
  return {
    bookmarkability: clampScore(Number(record.bookmarkability ?? 0)),
    proof: clampScore(Number(record.proof ?? 0)),
    immediateUse: clampScore(Number(record.immediateUse ?? 0)),
    audienceClarity: clampScore(Number(record.audienceClarity ?? 0)),
    reproducibility: clampScore(Number(record.reproducibility ?? 0)),
    hookStrength: clampScore(Number(record.hookStrength ?? 0)),
    originality: clampScore(Number(record.originality ?? 0)),
  };
}

function extractDraftClaims(
  text: string,
  sourceUrls: string[],
  evidence: ContentEvidence[],
  draftId = "manual",
): DraftClaim[] {
  const claims: DraftClaim[] = [];
  const addClaim = (claimText: string, kind: DraftClaim["kind"]): void => {
    const claimId = `claim-${draftId}-${claims.length}`;
    const evidenceIds = evidence
      .filter(
        (item) =>
          item.claimId === claimId ||
          (item.draftId === draftId && Boolean(item.sourceUrl && item.snippet)),
      )
      .map((item) => item.id);
    const status: DraftClaim["status"] =
      evidenceIds.length > 0
        ? "sourced"
        : sourceUrls.length > 0
          ? "needs source"
          : "unsupported";
    claims.push({ claimId, text: claimText, kind, status, evidenceIds });
  };

  for (const match of text.matchAll(NUMERIC_CLAIM_GLOBAL_RE)) {
    addClaim(match[0], "numeric");
  }
  for (const match of text.matchAll(ABSOLUTE_CLAIM_RE)) {
    addClaim(match[0].trim(), "absolute");
  }
  return claims;
}

function rowToAnalyticsPost(
  row: ContentStudioVaultRow,
): ContentAnalyticsPost | null {
  const slug = String(row.props.slug || row.title || "");
  if (!slug) return null;
  const views = numberFrom(row.props.views);
  const bookmarks = numberFrom(row.props.bookmarks);
  const likes = numberFrom(row.props.likes);
  const comments = numberFrom(row.props.comments);
  return {
    slug,
    hookRoute: String(row.props.hookRoute || "manual"),
    bmLike:
      typeof row.props.bmLike === "number"
        ? row.props.bmLike
        : calculateBmLike({ bookmarks, likes }),
    bookmarks,
    likes,
    comments,
    views,
    bookmarkRate: calculateRate(bookmarks, views),
    commentRate: calculateRate(comments, views),
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function numberFrom(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSnapshotWindow(
  value: unknown,
): value is NonNullable<AnalyticsSnapshot["snapshotWindow"]> {
  return (
    value === "24h" || value === "72h" || value === "7d" || value === "manual"
  );
}
