export type AssistantRecipeKind =
  | "research-brief"
  | "article-writer"
  | "content-writer"
  | "deck-builder"
  | "meeting-debrief"
  | "file-processor"
  | "morning-briefing"
  | "competitor-tracker"
  | "custom";

export type AssistantRecipeReviewMode = "review-first" | "auto-apply";

export type AssistantRecipeRunStatus = "success" | "error";

export type AssistantRecipeScheduleCadence = "daily" | "weekly" | "monthly";

export type AssistantRecipeAction =
  | "read_workspace"
  | "search_web"
  | "draft_content"
  | "propose_changes"
  | "process_files"
  | "schedule_runs"
  | "send_messages";

export interface AssistantRecipeTemplate {
  kind: AssistantRecipeKind;
  title: string;
  description: string;
  defaultJob: string;
  defaultInputs: string;
  defaultOutput: string;
  defaultActions: AssistantRecipeAction[];
  fields: AssistantRecipeTemplateField[];
}

export interface AssistantRecipeTemplateField {
  key: string;
  label: string;
  placeholder: string;
  lines?: number;
}

export interface AssistantRecipeSchedule {
  enabled: boolean;
  cadence: AssistantRecipeScheduleCadence;
  hour: number;
  cronJobId?: string;
  lastRunAt?: number;
  lastDrainedAt?: number;
}

export interface AssistantRecipe {
  id: string;
  name: string;
  kind: AssistantRecipeKind;
  description: string;
  job: string;
  inputs: string;
  output: string;
  allowedActions: AssistantRecipeAction[];
  reviewMode: AssistantRecipeReviewMode;
  skillName: string;
  skillPath?: string;
  enabled: boolean;
  schedule?: AssistantRecipeSchedule;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunSummary?: string;
}

export interface CreateAssistantRecipeInput {
  name: string;
  kind: AssistantRecipeKind;
  description?: string;
  job: string;
  inputs: string;
  output: string;
  allowedActions: AssistantRecipeAction[];
  reviewMode?: AssistantRecipeReviewMode;
  schedule?: AssistantRecipeSchedule;
}

export type AssistantRecipePatch = Partial<
  Pick<
    AssistantRecipe,
    | "name"
    | "description"
    | "job"
    | "inputs"
    | "output"
    | "allowedActions"
    | "reviewMode"
    | "enabled"
    | "schedule"
  >
>;

export interface AssistantRecipeResult {
  ok: boolean;
  recipe?: AssistantRecipe;
  recipes?: AssistantRecipe[];
  error?: string;
}

export interface AssistantRecipeRunResult {
  ok: boolean;
  recipe?: AssistantRecipe;
  run?: AssistantRecipeRunRecord;
  result?: unknown;
  prompt?: string;
  error?: string;
}

export interface AssistantRecipeRunRecord {
  id: string;
  recipeId: string;
  recipeName: string;
  input: string;
  resultText: string;
  status: AssistantRecipeRunStatus;
  error?: string;
  createdAt: number;
  durationMs: number;
  savedProposalId?: string;
  savedPageId?: string;
  trigger: "manual" | "scheduled" | "cron";
}

export interface AssistantRecipeRunsResult {
  ok: boolean;
  runs?: AssistantRecipeRunRecord[];
  error?: string;
}

export interface AssistantRecipeSaveRunResult {
  ok: boolean;
  run?: AssistantRecipeRunRecord;
  proposalId?: string;
  pageId?: string;
  error?: string;
}

export const ASSISTANT_RECIPE_HIGH_RISK_ACTIONS: AssistantRecipeAction[] = [
  "send_messages",
  "process_files",
  "schedule_runs",
];

export const ASSISTANT_RECIPE_SCHEDULABLE_KINDS: AssistantRecipeKind[] = [
  "morning-briefing",
  "research-brief",
  "competitor-tracker",
];

export const ASSISTANT_RECIPE_TEMPLATES: AssistantRecipeTemplate[] = [
  {
    kind: "research-brief",
    title: "Research brief",
    description: "Research a topic and save a plain-language briefing.",
    defaultJob:
      "Research the topic, extract the most useful facts, and produce a short briefing with sources and next steps.",
    defaultInputs:
      "A topic or question from the user, plus workspace notes when relevant.",
    defaultOutput:
      "A concise briefing with key findings, caveats, and suggested next actions.",
    defaultActions: ["read_workspace", "search_web", "draft_content"],
    fields: [
      {
        key: "topic",
        label: "Topic",
        placeholder: "What should this assistant research?",
      },
      {
        key: "depth",
        label: "Depth",
        placeholder: "Quick scan, detailed brief, or source-backed memo",
      },
      {
        key: "sources",
        label: "Sources to prefer",
        placeholder: "Workspace notes, web sources, specific sites",
      },
    ],
  },
  {
    kind: "article-writer",
    title: "Article writer",
    description: "Turn a topic into a structured article draft.",
    defaultJob:
      "Research the topic, choose an angle, outline the piece, draft it, and review it for clarity.",
    defaultInputs: "A topic, audience, tone, and optional source notes.",
    defaultOutput:
      "A publish-ready article draft with a title and section headings.",
    defaultActions: ["read_workspace", "search_web", "draft_content"],
    fields: [
      {
        key: "audience",
        label: "Audience",
        placeholder: "Who is this article for?",
      },
      {
        key: "tone",
        label: "Tone",
        placeholder: "Clear, executive, casual, technical",
      },
      {
        key: "length",
        label: "Length",
        placeholder: "Short post, newsletter, long-form article",
      },
    ],
  },
  {
    kind: "content-writer",
    title: "Content post writer",
    description:
      "Turn a sourced idea into review-first short-form post variants.",
    defaultJob:
      "Research the idea, add original value beyond the sources, verify claims, name evidence gaps and fair objections, write three draft variants with different hooks, and propose a manual-review publish packet.",
    defaultInputs:
      "A scored content idea, source links, target audience, platform, hook route, evidence gaps, and disclosure notes.",
    defaultOutput:
      "three draft variants, source notes with evidence gaps, an asset brief, disclosure reminders, and a manual review publish packet.",
    defaultActions: [
      "read_workspace",
      "search_web",
      "draft_content",
      "propose_changes",
    ],
    fields: [
      {
        key: "idea",
        label: "Idea",
        placeholder: "What sourced idea should become a post?",
      },
      {
        key: "platform",
        label: "Platform",
        placeholder: "X, LinkedIn, newsletter, blog, YouTube script",
      },
      {
        key: "hook",
        label: "Hook route",
        placeholder: "Freebie reveal, setup guide, comparison, proof-led",
      },
      {
        key: "disclosure",
        label: "Disclosure notes",
        placeholder: "Sponsor, free account, affiliate, synthetic media, none",
      },
    ],
  },
  {
    kind: "deck-builder",
    title: "Deck builder",
    description:
      "Turn rough notes and sourced workspace context into a review-first slide deck outline.",
    defaultJob:
      "Read the selected notes, clarify the audience and goal, choose a coherent narrative, and return a strict DeckProject JSON draft for Deck Studio.",
    defaultInputs:
      "Rough notes, selected workspace context, target audience, deck goal, desired length, and visual style.",
    defaultOutput:
      "Strict DeckProject JSON only: supported slide kinds, concise slide copy, source references, evidenceRefs, and speaker notes for review.",
    defaultActions: ["read_workspace", "draft_content", "propose_changes"],
    fields: [
      {
        key: "audience",
        label: "Audience",
        placeholder: "Seed investors, executive team, students, product buyers",
      },
      {
        key: "goal",
        label: "Goal",
        placeholder: "Raise a round, teach a concept, align a product decision",
      },
      {
        key: "length",
        label: "Length",
        placeholder: "5, 8, 10, or 12 slides",
      },
      {
        key: "style",
        label: "Style",
        placeholder: "Investor, research, product, lecture, executive",
      },
    ],
  },
  {
    kind: "meeting-debrief",
    title: "Meeting debrief",
    description:
      "Clean up messy meeting notes into decisions and action items.",
    defaultJob:
      "Turn raw meeting notes into a clean summary, decisions, action items, owners, and open questions.",
    defaultInputs: "Raw notes, transcript excerpts, or a meeting page.",
    defaultOutput:
      "A structured debrief ready to share or file into the workspace.",
    defaultActions: ["read_workspace", "draft_content", "propose_changes"],
    fields: [
      {
        key: "notes",
        label: "Raw notes",
        placeholder: "Paste meeting notes or describe where they live.",
        lines: 3,
      },
      {
        key: "decisions",
        label: "Decision format",
        placeholder: "Bullets, table, executive summary",
      },
      {
        key: "actions",
        label: "Action item style",
        placeholder: "Owner/date/status, simple checklist, or task-ready",
      },
    ],
  },
  {
    kind: "file-processor",
    title: "File/PDF processor",
    description: "Summarize files and propose organized workspace updates.",
    defaultJob:
      "Read provided files, extract the important points, and propose where each summary should be saved.",
    defaultInputs: "Inbox captures, PDFs, documents, or pasted file text.",
    defaultOutput: "Reviewable summaries and proposed wiki updates.",
    defaultActions: ["read_workspace", "process_files", "propose_changes"],
    fields: [
      {
        key: "files",
        label: "Files or captures",
        placeholder: "Which files, PDFs, or inbox captures should it process?",
      },
      {
        key: "summary",
        label: "Summary style",
        placeholder: "Brief, detailed, decisions only, source-backed",
      },
      {
        key: "destination",
        label: "Save target",
        placeholder: "Inbox, project page, source notes, or review queue",
      },
    ],
  },
  {
    kind: "morning-briefing",
    title: "Morning briefing",
    description: "Prepare a daily briefing from workspace context.",
    defaultJob:
      "Prepare a morning briefing with urgent items, scheduled work, follow-ups, and focus for the day.",
    defaultInputs: "Workspace notes, tasks, inbox captures, and today's focus.",
    defaultOutput: "A daily briefing page or chat summary.",
    defaultActions: ["read_workspace", "draft_content", "schedule_runs"],
    fields: [
      {
        key: "focus",
        label: "Focus",
        placeholder: "What should the briefing optimize for?",
      },
      {
        key: "lookback",
        label: "Lookback",
        placeholder: "Today only, since yesterday, this week",
      },
      {
        key: "format",
        label: "Briefing format",
        placeholder: "Priorities, calendar-style, risks, follow-ups",
      },
    ],
  },
  {
    kind: "competitor-tracker",
    title: "Competitor tracker",
    description: "Track competitors and produce a reviewable update.",
    defaultJob:
      "Search for recent competitor updates, summarize product/pricing/content/news changes, and flag what matters.",
    defaultInputs:
      "Competitor names, keywords, and optional workspace context.",
    defaultOutput:
      "A competitive intelligence brief with links and recommended follow-up.",
    defaultActions: ["read_workspace", "search_web", "draft_content"],
    fields: [
      {
        key: "competitors",
        label: "Competitors",
        placeholder: "Names, URLs, or product categories",
      },
      {
        key: "keywords",
        label: "Keywords",
        placeholder: "Pricing, launches, hiring, integrations",
      },
      {
        key: "style",
        label: "Update style",
        placeholder: "Brief, table, strategic risks, action memo",
      },
    ],
  },
  {
    kind: "custom",
    title: "Custom assistant",
    description: "Create a helper for any repeatable workflow.",
    defaultJob: "Describe the repeatable job this assistant should do.",
    defaultInputs: "Describe what the assistant should read or receive.",
    defaultOutput: "Describe what the assistant should produce.",
    defaultActions: ["read_workspace", "draft_content", "propose_changes"],
    fields: [
      {
        key: "job",
        label: "Job",
        placeholder: "What repeatable job should this assistant do?",
      },
      {
        key: "inputs",
        label: "Inputs",
        placeholder: "What should the assistant read or receive?",
      },
      {
        key: "output",
        label: "Output",
        placeholder: "What should the assistant produce?",
      },
    ],
  },
];
