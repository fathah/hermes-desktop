import { parse, stringify } from "yaml";
import type { ContentIdea, ContentRun } from "./content-studio";

export const DECK_STUDIO_FOLDER = "deck-studio";

export const DECK_SLIDE_KINDS = [
  "title",
  "section",
  "problem",
  "solution",
  "comparison",
  "timeline",
  "metric",
  "quote",
  "image",
  "chart",
  "evidence",
  "closing",
] as const;

export const DECK_THEME_IDS = [
  "investor",
  "research",
  "product",
  "lecture",
  "executive",
] as const;

export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number];
export type DeckThemeId = (typeof DECK_THEME_IDS)[number];
export type DeckStatus = "draft" | "outline" | "review" | "ready" | "exported";

export interface DeckSourceRef {
  id: string;
  label: string;
  kind: "page" | "content" | "research" | "pdf" | "paste";
  locator?: string;
  excerpt?: string;
}

export interface DeckTextBlock {
  id: string;
  kind: "paragraph" | "bullet" | "callout" | "caption";
  text: string;
}

export interface DeckVisualBlock {
  id: string;
  kind: "metric" | "quote" | "image" | "chart" | "evidence";
  label?: string;
  value?: string;
  caption?: string;
  src?: string;
  alt?: string;
}

export interface DeckSlide {
  id: string;
  kind: DeckSlideKind;
  title: string;
  subtitle?: string;
  body: DeckTextBlock[];
  visuals: DeckVisualBlock[];
  evidenceRefs: string[];
  speakerNotes?: string;
}

export interface DeckProject {
  id: string;
  title: string;
  audience: string;
  goal: string;
  theme: DeckThemeId;
  status: DeckStatus;
  sourceRefs: DeckSourceRef[];
  slides: DeckSlide[];
  createdAt: string;
  updatedAt: string;
}

export interface DeckGenerationInput {
  notes: string;
  audience: string;
  goal: string;
  theme: DeckThemeId;
  slideCount: number;
  style?: string;
  title?: string;
  sourceRefs?: DeckSourceRef[];
  createdAt?: string;
}

export interface DeckValidationIssue {
  code:
    | "deck_title"
    | "empty_deck"
    | "theme"
    | "slide_kind"
    | "title"
    | "density"
    | "contrast"
    | "body_text";
  path: string;
  message: string;
}

export interface DeckValidationResult {
  ok: boolean;
  issues: DeckValidationIssue[];
}

export interface DeckDensityResult {
  score: number;
  level: "ok" | "dense" | "crowded";
  textChars: number;
  bulletCount: number;
  issues: string[];
}

export interface DeckStudioVaultRow {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

export interface DeckStudioRow {
  folder: string;
  rowId: string;
  props: Record<string, unknown>;
  body: string;
}

export type DeckGenerationMode = "model" | "deterministic" | "fallback";

export interface DeckGenerationResult {
  ok: boolean;
  mode: DeckGenerationMode;
  project: DeckProject;
  issues: DeckQaIssue[];
  error?: string;
}

export interface DeckExportResult {
  ok: boolean;
  path?: string;
  notesPath?: string;
  error?: string;
}

export type DeckQaSeverity = "blocker" | "warning";

export interface DeckQaIssue {
  code: DeckValidationIssue["code"] | "missing_evidence" | "dense_slide";
  severity: DeckQaSeverity;
  path: string;
  message: string;
  slideId?: string;
}

export interface DeckQaResult {
  ok: boolean;
  blockers: number;
  warnings: number;
  issues: DeckQaIssue[];
}

export interface DeckTemplateRecipe {
  id: string;
  theme: DeckThemeId;
  slideKind: DeckSlideKind;
  layout:
    | "hero"
    | "split-proof"
    | "metric-wall"
    | "quote-focus"
    | "timeline"
    | "evidence-grid"
    | "decision-memo";
  maxBodyBlocks: number;
  visualBias: "none" | "metric" | "quote" | "evidence" | "image";
}

export interface DeckPageInput {
  pageId: string;
  title: string;
  blocks: Array<{ type?: string; text?: string }>;
}

export interface DeckResearchInput {
  title: string;
  markdown: string;
  locator?: string;
}

export interface DeckThemeTokens {
  id: DeckThemeId;
  name: string;
  background: string;
  foreground: string;
  accent: string;
  panel: string;
  muted: string;
}

export const DECK_THEME_TOKENS: Record<DeckThemeId, DeckThemeTokens> = {
  investor: {
    id: "investor",
    name: "Investor",
    background: "#f3f5df",
    foreground: "#171717",
    accent: "#ff3d12",
    panel: "#111111",
    muted: "#b9c900",
  },
  research: {
    id: "research",
    name: "Research",
    background: "#f6f7f1",
    foreground: "#17202a",
    accent: "#276ef1",
    panel: "#e4ecff",
    muted: "#6d7b8d",
  },
  product: {
    id: "product",
    name: "Product",
    background: "#f7f5ef",
    foreground: "#151515",
    accent: "#009b72",
    panel: "#dff1ea",
    muted: "#4f6f66",
  },
  lecture: {
    id: "lecture",
    name: "Lecture",
    background: "#fbf7ee",
    foreground: "#1e1b18",
    accent: "#c75000",
    panel: "#f1e0c7",
    muted: "#6d6254",
  },
  executive: {
    id: "executive",
    name: "Executive",
    background: "#f4f6f6",
    foreground: "#101517",
    accent: "#0f7c80",
    panel: "#d9e7e8",
    muted: "#536366",
  },
};

export const DECK_TEMPLATE_RECIPES: Record<
  DeckThemeId,
  Partial<Record<DeckSlideKind, DeckTemplateRecipe>>
> = {
  investor: {
    title: {
      id: "investor-title-hero",
      theme: "investor",
      slideKind: "title",
      layout: "hero",
      maxBodyBlocks: 0,
      visualBias: "none",
    },
    problem: {
      id: "investor-problem-proof",
      theme: "investor",
      slideKind: "problem",
      layout: "split-proof",
      maxBodyBlocks: 4,
      visualBias: "evidence",
    },
    solution: {
      id: "investor-solution-proof",
      theme: "investor",
      slideKind: "solution",
      layout: "split-proof",
      maxBodyBlocks: 4,
      visualBias: "metric",
    },
    metric: {
      id: "investor-metric-wall",
      theme: "investor",
      slideKind: "metric",
      layout: "metric-wall",
      maxBodyBlocks: 2,
      visualBias: "metric",
    },
    evidence: {
      id: "investor-evidence-grid",
      theme: "investor",
      slideKind: "evidence",
      layout: "evidence-grid",
      maxBodyBlocks: 3,
      visualBias: "evidence",
    },
    closing: {
      id: "investor-ask-hero",
      theme: "investor",
      slideKind: "closing",
      layout: "hero",
      maxBodyBlocks: 1,
      visualBias: "none",
    },
  },
  research: {
    title: {
      id: "research-title-hero",
      theme: "research",
      slideKind: "title",
      layout: "hero",
      maxBodyBlocks: 0,
      visualBias: "none",
    },
    evidence: {
      id: "research-evidence-grid",
      theme: "research",
      slideKind: "evidence",
      layout: "evidence-grid",
      maxBodyBlocks: 4,
      visualBias: "evidence",
    },
    quote: {
      id: "research-quote-focus",
      theme: "research",
      slideKind: "quote",
      layout: "quote-focus",
      maxBodyBlocks: 1,
      visualBias: "quote",
    },
  },
  product: {
    comparison: {
      id: "product-comparison-proof",
      theme: "product",
      slideKind: "comparison",
      layout: "split-proof",
      maxBodyBlocks: 4,
      visualBias: "image",
    },
    timeline: {
      id: "product-roadmap-timeline",
      theme: "product",
      slideKind: "timeline",
      layout: "timeline",
      maxBodyBlocks: 5,
      visualBias: "none",
    },
  },
  lecture: {
    section: {
      id: "lecture-section-hero",
      theme: "lecture",
      slideKind: "section",
      layout: "hero",
      maxBodyBlocks: 2,
      visualBias: "none",
    },
    quote: {
      id: "lecture-quote-focus",
      theme: "lecture",
      slideKind: "quote",
      layout: "quote-focus",
      maxBodyBlocks: 1,
      visualBias: "quote",
    },
  },
  executive: {
    comparison: {
      id: "executive-decision-memo",
      theme: "executive",
      slideKind: "comparison",
      layout: "decision-memo",
      maxBodyBlocks: 4,
      visualBias: "metric",
    },
    timeline: {
      id: "executive-timeline",
      theme: "executive",
      slideKind: "timeline",
      layout: "timeline",
      maxBodyBlocks: 4,
      visualBias: "none",
    },
  },
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/;

function isDeckThemeId(value: unknown): value is DeckThemeId {
  return typeof value === "string" && DECK_THEME_IDS.includes(value as DeckThemeId);
}

function isDeckSlideKind(value: unknown): value is DeckSlideKind {
  return (
    typeof value === "string" &&
    DECK_SLIDE_KINDS.includes(value as DeckSlideKind)
  );
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

export function deckProjectRowId(title: string): string {
  return `deck-project-${slugify(title)}`;
}

export function getDeckTemplateRecipe(
  theme: DeckThemeId,
  slideKind: DeckSlideKind,
): DeckTemplateRecipe {
  return (
    DECK_TEMPLATE_RECIPES[theme][slideKind] ??
    DECK_TEMPLATE_RECIPES.investor[slideKind] ?? {
      id: `${theme}-${slideKind}-hero`,
      theme,
      slideKind,
      layout: slideKind === "metric" ? "metric-wall" : "hero",
      maxBodyBlocks: slideKind === "title" ? 0 : 4,
      visualBias: slideKind === "quote" ? "quote" : "none",
    }
  );
}

function firstNonEmptyLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s]+/, "").trim())
    .find(Boolean) ?? "Untitled Deck";
}

function normalizeNoteLines(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s]+/, "").trim())
    .filter(Boolean);
}

function buildBody(lines: string[], prefix: string): DeckTextBlock[] {
  return lines.slice(0, 4).map((text, index) => ({
    id: `${prefix}-body-${index + 1}`,
    kind: "bullet",
    text,
  }));
}

export function createDeckProject(input: DeckGenerationInput): DeckProject {
  const lines = normalizeNoteLines(input.notes);
  const title = (input.title || firstNonEmptyLine(input.notes)).trim();
  const now = input.createdAt ?? new Date().toISOString();
  const slideCount = Math.max(4, Math.min(12, Math.round(input.slideCount || 6)));
  const sourceRefs: DeckSourceRef[] =
    input.sourceRefs && input.sourceRefs.length > 0
      ? input.sourceRefs
      : [
          {
            id: "src-paste",
            label: "Rough notes",
            kind: "paste",
            excerpt: input.notes.slice(0, 280),
          },
        ];
  const evidenceRefs = sourceRefs.map((source) => source.id);
  const keyLines = lines.filter((line) => line.toLowerCase() !== title.toLowerCase());
  const slides: DeckSlide[] = [
    {
      id: "slide-1",
      kind: "title",
      title,
      subtitle: input.goal || `For ${input.audience}`,
      body: [],
      visuals: [],
      evidenceRefs,
      speakerNotes: `Frame this for ${input.audience}.`,
    },
    {
      id: "slide-2",
      kind: "problem",
      title: "The Problem",
      body: buildBody(keyLines.slice(0, 4), "slide-2"),
      visuals: [],
      evidenceRefs,
      speakerNotes: "Keep this grounded in the supplied source notes.",
    },
    {
      id: "slide-3",
      kind: "solution",
      title: "The Solution",
      body: buildBody(keyLines.slice(2, 6), "slide-3"),
      visuals: [],
      evidenceRefs,
      speakerNotes: "Make the change feel specific and concrete.",
    },
    {
      id: "slide-4",
      kind: "evidence",
      title: "Why Now",
      body: buildBody(keyLines.slice(4, 8), "slide-4"),
      visuals: [
        {
          id: "slide-4-evidence",
          kind: "evidence",
          label: sourceRefs[0]?.label ?? "Source notes",
          caption: sourceRefs[0]?.excerpt ?? input.notes.slice(0, 120),
        },
      ],
      evidenceRefs,
      speakerNotes: "Name the strongest proof and the biggest assumption.",
    },
    {
      id: "slide-5",
      kind: "closing",
      title: "The Ask",
      body: [
        {
          id: "slide-5-body-1",
          kind: "callout",
          text: input.goal || "Align on the next decision.",
        },
      ],
      visuals: [],
      evidenceRefs,
      speakerNotes: "Close with the action the audience should take.",
    },
  ];

  while (slides.length < slideCount) {
    const next = slides.length + 1;
    slides.splice(slides.length - 1, 0, {
      id: `slide-${next}`,
      kind: next % 2 === 0 ? "comparison" : "metric",
      title: next % 2 === 0 ? "What Changes" : "Key Signal",
      body: buildBody(keyLines.slice(next - 2, next + 2), `slide-${next}`),
      visuals:
        next % 2 === 0
          ? []
          : [
              {
                id: `slide-${next}-metric`,
                kind: "metric",
                label: "Signal",
                value: "1",
                caption: "Replace with a sourced metric during review.",
              },
            ],
      evidenceRefs,
      speakerNotes: "Review this generated slide before export.",
    });
  }

  slides.forEach((slide, index) => {
    slide.id = `slide-${index + 1}`;
  });

  return {
    id: `deck-${slugify(title)}`,
    title,
    audience: input.audience,
    goal: input.goal,
    theme: input.theme,
    status: "draft",
    sourceRefs,
    slides,
    createdAt: now,
    updatedAt: now,
  };
}

export function scoreSlideDensity(slide: DeckSlide): DeckDensityResult {
  const bodyChars = slide.body.reduce((sum, block) => sum + block.text.length, 0);
  const visualChars = slide.visuals.reduce(
    (sum, visual) =>
      sum +
      (visual.label?.length ?? 0) +
      (visual.value?.length ?? 0) +
      (visual.caption?.length ?? 0),
    0,
  );
  const textChars =
    slide.title.length + (slide.subtitle?.length ?? 0) + bodyChars + visualChars;
  const bulletCount = slide.body.filter((block) => block.kind === "bullet").length;
  const score = textChars + bulletCount * 35 + slide.visuals.length * 30;
  const issues: string[] = [];

  if (bulletCount > 6) issues.push("Too many bullet blocks for one slide.");
  if (textChars > 620) issues.push("Too much text for a readable 16:9 slide.");
  if (slide.body.some((block) => block.text.length > 190)) {
    issues.push("A body block is too long; move detail into speaker notes.");
  }

  return {
    score,
    textChars,
    bulletCount,
    issues,
    level: score > 760 || issues.length > 1 ? "crowded" : score > 540 ? "dense" : "ok",
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const values = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
}

export function validateDeckProject(project: DeckProject): DeckValidationResult {
  const issues: DeckValidationIssue[] = [];
  if (!project.title?.trim()) {
    issues.push({
      code: "deck_title",
      path: "title",
      message: "Deck title is required.",
    });
  }
  if (!isDeckThemeId(project.theme)) {
    issues.push({
      code: "theme",
      path: "theme",
      message: "Deck theme must be one of the supported Deck Studio themes.",
    });
  }
  if (!Array.isArray(project.slides) || project.slides.length === 0) {
    issues.push({
      code: "empty_deck",
      path: "slides",
      message: "Deck must include at least one slide.",
    });
  }

  const theme = isDeckThemeId(project.theme)
    ? DECK_THEME_TOKENS[project.theme]
    : null;
  if (theme && contrastRatio(theme.foreground, theme.background) < 4.5) {
    issues.push({
      code: "contrast",
      path: "theme",
      message: "Theme foreground/background contrast is below 4.5:1.",
    });
  }

  project.slides?.forEach((slide, index) => {
    const path = `slides.${index}`;
    if (!isDeckSlideKind(slide.kind)) {
      issues.push({
        code: "slide_kind",
        path: `${path}.kind`,
        message: `Unsupported slide kind: ${String(slide.kind)}`,
      });
    }
    if (!slide.title?.trim()) {
      issues.push({
        code: "title",
        path: `${path}.title`,
        message: "Every slide needs a title before export.",
      });
    }
    if (slide.body?.some((block) => block.text.length > 320)) {
      issues.push({
        code: "body_text",
        path: `${path}.body`,
        message: "Slide body text is too long for deterministic layouts.",
      });
    }
    const density = scoreSlideDensity(slide);
    if (density.level === "crowded") {
      issues.push({
        code: "density",
        path,
        message: density.issues[0] ?? "Slide is too crowded.",
      });
    }
  });

  return { ok: issues.length === 0, issues };
}

export function runDeckQa(project: DeckProject): DeckQaResult {
  const issues: DeckQaIssue[] = validateDeckProject(project).issues.map((issue) => ({
    code: issue.code,
    severity:
      issue.code === "density" || issue.code === "body_text"
        ? "warning"
        : "blocker",
    path: issue.path,
    message: issue.message,
  }));

  project.slides.forEach((slide, index) => {
    const path = `slides.${index}`;
    const density = scoreSlideDensity(slide);
    if (density.level === "dense") {
      issues.push({
        code: "dense_slide",
        severity: "warning",
        path,
        slideId: slide.id,
        message: "Slide is dense; review before export.",
      });
    }
    if (slide.kind === "evidence" && slide.evidenceRefs.length === 0) {
      issues.push({
        code: "missing_evidence",
        severity: "blocker",
        path: `${path}.evidenceRefs`,
        slideId: slide.id,
        message: "Evidence slides must cite at least one source reference.",
      });
    } else if (
      (slide.kind === "metric" ||
        slide.kind === "problem" ||
        slide.kind === "solution") &&
      project.sourceRefs.length > 0 &&
      slide.evidenceRefs.length === 0
    ) {
      issues.push({
        code: "missing_evidence",
        severity: "warning",
        path: `${path}.evidenceRefs`,
        slideId: slide.id,
        message: "Source-grounded slides should cite at least one source reference.",
      });
    }
  });

  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return { ok: blockers === 0, blockers, warnings, issues };
}

export function buildDeckGenerationPrompt(input: DeckGenerationInput): string {
  return [
    "You are Deck Studio, a review-first presentation planner.",
    "Return only strict JSON matching the DeckProject interface.",
    "The LLM chooses narrative and slide kind; deterministic app code chooses layout.",
    `Audience: ${input.audience}`,
    `Goal: ${input.goal}`,
    `Theme: ${input.theme}`,
    `Target slides: ${input.slideCount}`,
    `Style notes: ${input.style || "polished, source-grounded, premium"}`,
    "Rules: use supported slide kinds only, keep slide body blocks concise, include evidenceRefs where claims rely on source material.",
    "Rough notes:",
    input.notes,
  ].join("\n\n");
}

export function buildDeckRepairPrompt(
  invalidProjectJson: string,
  issues: DeckQaIssue[],
): string {
  return [
    "Return only repaired DeckProject JSON.",
    "Do not add markdown fences, commentary, or explanations.",
    "Preserve the user's sourceRefs, evidenceRefs where valid, audience, goal, and theme.",
    "Fix these validation issues:",
    issues
      .map((issue) => `- ${issue.code} at ${issue.path}: ${issue.message}`)
      .join("\n"),
    "Invalid DeckProject JSON:",
    invalidProjectJson,
  ].join("\n\n");
}

function defaultDeckInput(
  title: string,
  notes: string,
  sourceRef: DeckSourceRef,
  overrides: Partial<DeckGenerationInput> = {},
): DeckGenerationInput {
  return {
    title,
    notes,
    audience: overrides.audience || "decision makers",
    goal: overrides.goal || "create a polished deck",
    theme: overrides.theme || "investor",
    slideCount: overrides.slideCount || 6,
    style: overrides.style || "premium, source-grounded, concise",
    sourceRefs: [sourceRef],
  };
}

export function buildDeckInputFromPage(
  input: DeckPageInput,
  overrides: Partial<DeckGenerationInput> = {},
): DeckGenerationInput {
  const body = input.blocks
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join("\n");
  return defaultDeckInput(input.title, `${input.title}\n${body}`.trim(), {
    id: `src-page-${slugify(input.pageId)}`,
    label: input.title,
    kind: "page",
    locator: `${input.pageId.replace(/\.md$/, "")}.md`,
    excerpt: body.slice(0, 280),
  }, overrides);
}

export function buildDeckInputFromContentIdea(
  idea: ContentIdea,
  overrides: Partial<DeckGenerationInput> = {},
): DeckGenerationInput {
  const sourceText = idea.sourceUrls.map((url) => `Source: ${url}`).join("\n");
  return defaultDeckInput(
    idea.title,
    `${idea.title}\n${idea.angle}\n${sourceText}`.trim(),
    {
      id: `src-content-${slugify(idea.id)}`,
      label: idea.title,
      kind: "content",
      locator: idea.id,
      excerpt: idea.angle.slice(0, 280),
    },
    {
      audience: idea.audience || overrides.audience,
      goal: "turn this sourced idea into a deck",
      ...overrides,
    },
  );
}

export function buildDeckInputFromContentRun(
  run: ContentRun,
  overrides: Partial<DeckGenerationInput> = {},
): DeckGenerationInput {
  const sourceText = run.sourceUrls.map((url) => `Source: ${url}`).join("\n");
  return defaultDeckInput(
    run.title,
    `${run.title}\nPlatform: ${run.platform}\nHook route: ${run.hookRoute}\n${sourceText}`.trim(),
    {
      id: `src-content-run-${slugify(run.id)}`,
      label: run.title,
      kind: "content",
      locator: run.id,
      excerpt: `${run.platform} ${run.hookRoute}`.trim(),
    },
    {
      goal: "turn this content run into a deck",
      ...overrides,
    },
  );
}

export function buildDeckInputFromResearch(
  input: DeckResearchInput,
  overrides: Partial<DeckGenerationInput> = {},
): DeckGenerationInput {
  return defaultDeckInput(input.title, `${input.title}\n${input.markdown}`.trim(), {
    id: `src-research-${slugify(input.title)}`,
    label: input.title,
    kind: "research",
    locator: input.locator,
    excerpt: input.markdown.slice(0, 280),
  }, {
    goal: "turn this research into a source-grounded deck",
    theme: "research",
    ...overrides,
  });
}

export function nextDeckExportName(
  existingNames: string[],
  title: string,
  ext: "pdf" | "pptx" | "md",
): string {
  const stem = deckProjectRowId(title);
  const re = new RegExp(`^${stem}-v(\\d{3})\\.${ext}$`);
  const max = existingNames.reduce((highest, name) => {
    const match = re.exec(name);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 0);
  return `${stem}-v${String(max + 1).padStart(3, "0")}.${ext}`;
}

export function parseDeckProjectJson(text: string): DeckProject {
  const trimmed = text.trim();
  const fenced = JSON_FENCE_RE.exec(trimmed)?.[1];
  const raw = fenced ?? trimmed;
  const parsed = JSON.parse(raw) as DeckProject;
  const validation = validateDeckProject(parsed);
  if (!validation.ok) {
    throw new Error(
      `Deck IR failed validation: ${validation.issues
        .map((issue) => issue.message)
        .join(" ")}`,
    );
  }
  return parsed;
}

export function serializeDeckProjectMarkdown(project: DeckProject): string {
  const frontmatter = stringify({
    type: "deck-project",
    id: project.id,
    title: project.title,
    audience: project.audience,
    goal: project.goal,
    theme: project.theme,
    status: project.status,
    slideCount: project.slides.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceRefs: project.sourceRefs,
  }).trim();
  return `---\n${frontmatter}\n---\n\n# ${project.title}\n\n\`\`\`json\n${JSON.stringify(
    project,
    null,
    2,
  )}\n\`\`\`\n`;
}

export function parseDeckProjectMarkdown(markdown: string): DeckProject {
  const body = FRONTMATTER_RE.test(markdown)
    ? markdown.slice(FRONTMATTER_RE.exec(markdown)?.[0].length ?? 0)
    : markdown;
  const json = JSON_FENCE_RE.exec(body)?.[1];
  if (!json) {
    throw new Error("Deck project markdown is missing a JSON deck body.");
  }
  return parseDeckProjectJson(json);
}

export function deckProjectToRow(project: DeckProject): DeckStudioRow {
  const validation = validateDeckProject(project);
  return {
    folder: DECK_STUDIO_FOLDER,
    rowId: deckProjectRowId(project.title),
    props: {
      type: "deck-project",
      id: project.id,
      title: project.title,
      audience: project.audience,
      goal: project.goal,
      theme: project.theme,
      status: validation.ok ? project.status : "review",
      slideCount: project.slides.length,
      issueCount: validation.issues.length,
      sourceCount: project.sourceRefs.length,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    body: serializeDeckProjectMarkdown(project),
  };
}

export function rowToDeckProject(props: Record<string, unknown>, body: string): DeckProject {
  const fromBody = parseDeckProjectMarkdown(body);
  const title = typeof props.title === "string" && props.title ? props.title : fromBody.title;
  return { ...fromBody, title };
}

export function parseDeckProjectFrontmatter(markdown: string): Record<string, unknown> {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return {};
  const parsed = parse(match[1]) as unknown;
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}
