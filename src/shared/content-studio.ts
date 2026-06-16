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
  status?: "draft" | "needs-review" | "approved";
  sourceNotes?: string;
  assetBrief?: string;
  disclosureNotes?: string;
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
  publishedAt?: string;
  platform?: string;
  finalCopy?: string;
  linkComment?: string;
  sourceNotes?: string;
  disclosureText?: string;
  assetChecklist?: string[];
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
  notes?: string;
  capturedAt?: string;
}

export interface ContentScore {
  total: number;
  max: 14;
  recommendation: "write" | "refine" | "skip";
}

export interface DraftQualityInput {
  text: string;
  sourceUrls: string[];
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
  text: string;
  kind: "numeric" | "absolute";
  status: "sourced" | "needs source" | "unsupported";
}

export type ContentStudioRowKind =
  | "content-idea"
  | "content-run"
  | "draft-variant"
  | "asset-brief"
  | "published-post"
  | "analytics-snapshot";

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

export const CONTENT_STUDIO_FOLDERS = {
  ideas: "content-ideas",
  runs: "content-runs",
  drafts: "content-drafts",
  assets: "content-assets",
  published: "content-published",
  analytics: "content-analytics",
} as const;

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

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2, Math.round(value)));
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
  const claims = extractDraftClaims(text, input.sourceUrls);

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
  if (
    claims.some((claim) => claim.status === "unsupported") &&
    input.sourceUrls.length === 0
  ) {
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
      publishedAt: post.publishedAt,
      disclosureText: post.disclosureText,
      assetChecklist: post.assetChecklist ?? [],
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

function extractDraftClaims(text: string, sourceUrls: string[]): DraftClaim[] {
  const status: DraftClaim["status"] =
    sourceUrls.length > 0 ? "sourced" : "unsupported";
  const claims: DraftClaim[] = [];
  for (const match of text.matchAll(NUMERIC_CLAIM_GLOBAL_RE)) {
    claims.push({ text: match[0], kind: "numeric", status });
  }
  for (const match of text.matchAll(ABSOLUTE_CLAIM_RE)) {
    claims.push({
      text: match[0].trim(),
      kind: "absolute",
      status: sourceUrls.length > 0 ? "sourced" : "unsupported",
    });
  }
  return claims;
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
