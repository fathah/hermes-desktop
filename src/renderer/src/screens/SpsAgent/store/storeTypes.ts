// storeTypes.ts — the composed store shape, split into slice interfaces.
import type { AgentMessage, DbAction } from "../assistant/types";
import type { AiActionKind } from "../assistant/prompts";
import type { DropWhere } from "../lib/tree";
import type { Tweaks } from "../lib/theme";
import type {
  Block,
  Comment,
  PageMeta,
  Task,
  TreeNode,
  TrashEntry,
  SpsSaveResult,
} from "../types";
import type { WorkDetail } from "../../../../../shared/openalex/core";
import type { ExternalSource } from "../../../../../shared/external-context";
import type { ResearchReachIntent } from "../../../../../shared/research-reach";
import type { ContentIdea } from "../../../lib/content-studio";
import type { DeckGenerationInput } from "../../../../../shared/deck-studio";
import type {
  ApprovalChoice,
  ApprovalState,
  PendingApproval,
} from "../../../lib/approval";

export type RightTab =
  | "assistant"
  | "outline"
  | "comments"
  | "info"
  | "backlinks";

/** A transcript hit to auto-open in the External Sessions viewer (federated
 *  search routing). Carries just enough to reconstruct the viewer call + banner. */
export interface ExternalConversationTarget {
  convId: string;
  seq: number;
  source: ExternalSource;
  title: string | null;
  projectPath: string | null;
  gitBranch: string | null;
}

// Top-level surface shown in the main area. "doc" is the page editor (default);
// the others are full-area surfaces reached from the rail (ideas A2/A4 + the
// Ask panel). "chats" is the single, session-backed Chat surface — the former
// ephemeral "agent" surface was merged into it (tool-use is gateway-driven, so
// there was no functional difference, only persistence). "graph" is the local
// wikilink graph view (F4).
export type Surface =
  | "doc"
  | "dashboard"
  | "cockpit"
  | "insights"
  | "memory"
  | "you"
  | "learning"
  | "activeWork"
  | "ask"
  | "chats"
  | "graph"
  | "equity"
  | "inbox"
  | "review"
  | "health"
  | "journal"
  | "obsidian-note"
  | "work"
  | "personal-health"
  | "rss-reader"
  | "contentStudio"
  | "deckStudio";

// Named, toggleable sidebar sections (Notion 3.1 grammar). Order here is the
// render order in the rail.
export type SectionId =
  | "meetings"
  | "recents"
  | "agents"
  | "shared"
  | "private"
  | "apps"
  | "aiAssistant"
  | "workspaceTools";

export const SECTION_ORDER: SectionId[] = [
  "meetings",
  "recents",
  "agents",
  "shared",
  "private",
  "apps",
  "aiAssistant",
  "workspaceTools",
];

export interface XY {
  x: number;
  y: number;
}

export interface WorkspaceSlice {
  tree: TreeNode[];
  meta: Record<string, PageMeta>;
  trash: TrashEntry[];
  page: string;
  docs: Record<string, Block[]>;

  /** Update the current page's blocks. */
  setBlocks: (updater: (bs: Block[]) => Block[]) => void;
  /** Replace a specific page's blocks. */
  setPageDoc: (id: string, blocks: Block[]) => void;
  selectPage: (id: string) => void;
  makePage: (
    info: {
      icon?: string;
      title?: string;
      source?: string;
      ingestedAt?: number;
      journal?: boolean;
      date?: string;
      time?: string;
      mood?: string;
    },
    docBlocks: Block[],
    parentId: string | null,
  ) => string;
  /** Like makePage but with a caller-supplied id (ingest needs slug ids so
   *  [[wikilink]] targets resolve to the page file's basename). */
  makePageWithId: (
    id: string,
    info: {
      icon?: string;
      title?: string;
      source?: string;
      ingestedAt?: number;
    },
    docBlocks: Block[],
    parentId: string | null,
  ) => string;
  /** Find (by title at root) or create the "Wiki" folder; returns its id. */
  ensureWikiFolder: () => string;
  /** Commit one proposed ingest page (create under Wiki, or update in place). */
  ingestCommitPage: (page: {
    op: "create" | "update";
    pageId: string;
    title: string;
    markdown: string;
  }) => string;
  newSubPage: (parentId: string) => void;
  /**
   * KB Phase 0: pick a PDF, extract it, and ingest it as a page inside the
   * dedicated "Sources" folder (created on first import). A PDF with no usable
   * text layer (scanned, or a broken/unmappable font) is routed to OCR instead
   * of refused (item 2).
   */
  importPdf: () => Promise<void>;
  /** The OCR job currently being processed (for the progress indicator). */
  ocrActive: { title: string; page: number; pages: number } | null;
  /** Number of OCR jobs still queued (persisted, survives restart). */
  ocrPending: number;
  /** When true, queued OCR waits for the overnight window instead of draining now. */
  ocrDefer: boolean;
  /**
   * Queue a scanned / unreadable-text-layer PDF for background OCR (item 2,
   * P2). Persisted; drains sequentially; the result is filed under "Sources".
   */
  ocrEnqueue: (filePath: string, title: string, pageCount: number) => void;
  /** Resume persisted OCR jobs + start the overnight scheduler (call on launch). */
  ocrResume: () => void;
  /** Stop the overnight scheduler (call on workspace unmount/HMR cleanup). */
  ocrStopScheduler: () => void;
  /** Drain the OCR queue immediately, regardless of the overnight setting (P3). */
  ocrRunNow: () => void;
  /** Toggle deferring OCR to the overnight window (P3); persisted. */
  ocrSetDefer: (on: boolean) => void;
  /** Find (by title at root) or create the "Sources" folder; returns its id. */
  ensureSourcesFolder: () => string;
  /** Find (by title) or create the "Research" folder under "Sources"; returns its id. */
  ensureResearchFolder: () => string;
  /**
   * Ingest an OpenAlex work as a curated, plain-language page under
   * Sources/Research: a co-author TL;DR callout, the reconstructed abstract,
   * an at-a-glance line, the open-access PDF as a bookmark, and topic tags.
   * Never hard-fails — the TL;DR degrades to the abstract if the gateway is down.
   */
  importResearchWork: (work: WorkDetail) => Promise<void>;
  createChildPage: () => string;
  createFromTemplate: (
    blocks: Block[],
    info: { emoji: string; name: string },
    parent: string | null,
  ) => void;
  deletePage: (id?: string) => void;
  restorePage: (entry: TrashEntry) => void;
  purgeTrashedPage: (entry: TrashEntry) => void;
  renamePage: (id: string, title: string) => void;
  movePage: (dragId: string, targetId: string, where: DropWhere) => void;
  setPMeta: (patch: Partial<PageMeta>) => void;
  setPageMeta: (id: string, patch: Partial<PageMeta>) => void;
  resetWorkspace: () => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteDoneTasks: () => void;
}

export interface CommentsSlice {
  comments: Comment[];
  addComment: (c: Comment) => void;
  addBlockComment: (blockId: string, text: string) => void;
  addSelectionComment: (cid: string, text: string) => void;
  replyComment: (id: string, text: string) => void;
  resolveComment: (id: string) => void;
  removeComment: (id: string) => void;
}

export interface UiSlice {
  panelOpen: boolean;
  rightTab: RightTab;
  surface: Surface;
  paletteOpen: boolean;
  templatesOpen: { parent: string | null } | null;
  trashOpen: boolean;
  /** The Research (OpenAlex paper search) modal is open. */
  researchOpen: boolean;
  /** The Scheduled Research management modal is open. */
  scheduledOpen: boolean;
  /** Topic handed off from Research into the topic monitor create form. */
  scheduledDraftTopic: string | null;
  /** The read-only Agent tasks (Kanban oversight) modal is open. */
  agentTasksOpen: boolean;
  /** The External Sessions (other AI tools' transcripts) modal is open. */
  externalSessionsOpen: boolean;
  /** When set, the External Sessions modal auto-opens this conversation's viewer
   *  on mount (federated-search transcript routing). Cleared once consumed. */
  externalSessionsTarget: ExternalConversationTarget | null;
  tweaksOpen: boolean;
  openTask: Task | null;
  emojiPick: XY | null;
  coverPick: XY | null;
  toast: { text: string; tone?: "warn" } | null;
  /** Persistent workspace-save failure message (Phase 1.5). Non-null ⇒ the
   *  latest save did not reach disk; the shell shows a standing warning until a
   *  later save succeeds. Distinct from the transient `toast`. */
  saveError: string | null;
  /** One-shot guard so the >25 MB "consider vault migration" hint fires once. */
  oversizeAdvised: boolean;
  focusReq: string | null;
  // AI Chats surface: the session currently shown (null = a fresh chat).
  activeChatSession: string | null;
  // Human title of the active session (from Recents/Cockpit at selection time),
  // shown in the chat header instead of the id suffix. null for a fresh chat.
  activeChatSessionTitle: string | null;
  // A prompt to pre-fill into the chat on next mount (powers the "card → guided
  // agent flow" entry points: meetings, calendar, apps). Consumed once.
  pendingChatPrompt: string | null;
  // Bumped on every new-chat / session-select so the chat surface remounts
  // cleanly (re-captures the pending prompt, reloads the transcript).
  chatNonce: number;
  activeObsidianPath: string | null;
  pendingContentStudioIdea: ContentIdea | null;
  pendingDeckStudioInput: DeckGenerationInput | null;
  pendingInboxMode: "image" | null;

  setPanelOpen: (v: boolean) => void;
  setRightTab: (t: RightTab) => void;
  openPanelTab: (t: RightTab) => void;
  setSurface: (s: Surface) => void;
  openContentStudioIdea: (idea: ContentIdea) => void;
  clearPendingContentStudioIdea: () => void;
  openDeckStudioInput: (input: DeckGenerationInput) => void;
  clearPendingDeckStudioInput: () => void;
  openInboxImageCapture: () => void;
  clearPendingInboxMode: () => void;
  setPaletteOpen: (v: boolean) => void;
  setTemplatesOpen: (v: { parent: string | null } | null) => void;
  setTrashOpen: (v: boolean) => void;
  setResearchOpen: (v: boolean) => void;
  setScheduledOpen: (v: boolean) => void;
  setScheduledDraftTopic: (topic: string | null) => void;
  setAgentTasksOpen: (v: boolean) => void;
  setExternalSessionsOpen: (v: boolean) => void;
  /** Open the External Sessions modal focused on a specific transcript. */
  openExternalConversation: (target: ExternalConversationTarget) => void;
  /** Clear the auto-open target after the modal has consumed it. */
  clearExternalSessionsTarget: () => void;
  setTweaksOpen: (v: boolean) => void;
  setOpenTask: (t: Task | null) => void;
  setEmojiPick: (v: XY | null) => void;
  setCoverPick: (v: XY | null) => void;
  setFocusReq: (id: string | null) => void;
  flash: (text: string, opts?: { tone?: "warn"; ms?: number }) => void;
  /** Reconcile a workspace-save outcome: clear/raise the persistent saveError,
   *  flash a transient toast on a failure→ok transition, and fire the one-time
   *  oversize advisory. */
  reportSaveResult: (result: SpsSaveResult) => void;
  setActiveChatSession: (id: string | null, title?: string | null) => void;
  setPendingChatPrompt: (text: string | null) => void;
  /** Open the AI Chats surface on a fresh chat, optionally pre-filled. */
  startNewChat: (prompt?: string) => void;
  setActiveObsidianPath: (path: string | null) => void;
}

export interface SidebarSlice {
  /** Whether a section is shown at all (the "customize sidebar" toggle). */
  sectionsEnabled: Record<SectionId, boolean>;
  /** Whether a shown section is expanded (the collapse caret). */
  sectionsOpen: Record<SectionId, boolean>;
  setSectionEnabled: (id: SectionId, v: boolean) => void;
  toggleSection: (id: SectionId) => void;
}

export interface JournalSlice {
  /** The day the calendar surface is focused on ("YYYY-MM-DD"). */
  journalDate: string;
  setJournalDate: (date: string) => void;
  /** Open the calendar surface, optionally focused on a given day. */
  openJournal: (date?: string) => void;
  /**
   * Create a new journal entry (a page flagged `journal:true`) on the given
   * day (defaults to today), stamped with the current time, then open it in
   * the document editor. Returns the new page id.
   */
  createJournalEntry: (date?: string) => string;
  /** Set (or clear) the mood emoji on a journal entry. */
  setEntryMood: (id: string, mood: string) => void;
}

export interface TweaksSlice {
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
}

/** One assistant conversation = one tab (M3 #5: parallel agent runs). */
export interface Conversation {
  id: string;
  title: string;
  messages: AgentMessage[];
  thinking: boolean;
}

export interface AssistantSlice {
  conversations: Conversation[];
  activeConvId: string;
  workApprovals: ApprovalState;
  workApprovalTimeout: number;
  workApprovalNow: number;
  /** Tab management — open / switch / close conversations. */
  newConversation: () => void;
  selectConversation: (id: string) => void;
  closeConversation: (id: string) => void;
  setThinking: (v: boolean) => void;
  pushUser: (text: string) => void;
  pushBot: (msg: Omit<AgentMessage, "id" | "role">) => void;
  /** Phase 8 wires these to a provider + page orchestration. */
  runAgent: (prompt: string, displayText?: string) => void;
  askAbout: (text: string) => void;
  /** Inline co-author affordances (Milestone 1D). */
  aiAction: (kind: AiActionKind, text: string) => void;
  /** `/plan` — produce a structured, vault-grounded plan (Milestone 1B). */
  runPlan: (idea: string, opts?: { planForThePlan?: boolean }) => void;
  /** `/work` — execute the plan on the current page (Milestone 1C). */
  runWork: () => void;
  enqueueWorkApproval: (req: PendingApproval) => void;
  respondWorkApproval: (id: string, choice: ApprovalChoice) => void;
  tickWorkApprovalTimeouts: (now: number) => void;
  setWorkApprovalTimeout: (seconds: number) => void;
  decideProposal: (proposalId: string, accept: boolean) => void;
  applyDbAction: (messageId: string, action: DbAction) => void;
  dismissDbAction: (messageId: string) => void;
  applySshAction: (messageId: string, action: "start" | "stop") => void;
  applyConfigAction: (messageId: string, provider: string, key: string) => void;
  /** Query-that-compounds (Karpathy's `outputs/` layer): synthesize a grounded
   *  answer into a durable wiki page and commit it through the ingest path. */
  fileAnswerToWiki: (messageId: string) => Promise<{
    ok: boolean;
    pages?: number;
    summary?: string;
    error?: string;
  }>;
  /** Research-that-compounds: research any topic on the live web (headless
   *  streaming, tool-using turn) and auto-commit a cited wiki page to the KB.
   *  `error: "no-sources"` means the agent returned no usable web sources — the
   *  caller must NOT treat that as a successful save. On success, `undo` reverses
   *  the commit (created pages → trash; updated pages → restored). */
  runResearch: (
    topic: string,
    handlers?: {
      onChunk?: (markdown: string) => void;
      onTool?: (tool: string | null) => void;
    },
    intent?: ResearchReachIntent,
  ) => Promise<{
    ok: boolean;
    error?: string;
    summary?: string;
    pageId?: string;
    undo?: () => void;
  }>;
  saveStudyToWiki: (
    focus: string,
    answer: string,
  ) => Promise<{
    ok: boolean;
    error?: string;
    summary?: string;
    pageId?: string;
    undo?: () => void;
  }>;
}

/** A template the user saved from one of their own pages (localStorage-backed). */
export interface UserTemplate {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  blocks: Block[];
}

export interface TemplatesSlice {
  userTemplates: UserTemplate[];
  /** Snapshot a page's blocks + icon/title into a reusable template. */
  saveAsTemplate: (pageId: string) => void;
  removeUserTemplate: (id: string) => void;
}

/** The widgets available on the customizable cockpit home dashboard. */
export type WidgetKind =
  | "quick"
  | "glance"
  | "notes"
  | "pages"
  | "ask"
  | "recentChats"
  | "today"
  | "agent"
  | "guide"
  | "operatorTasks"
  | "operatorInbox"
  | "operatorBrief"
  | "operatorApprovals"
  | "operatorUpdates"
  | "equityAlerts"
  | "pulse"
  | "piping";

/** A placed cockpit widget: which widget, and how many columns it spans. */
export interface CockpitWidget {
  kind: WidgetKind;
  span: 1 | 2;
}

export interface CockpitSlice {
  cockpit: CockpitWidget[];
  reorderCockpit: (from: number, to: number) => void;
  setCockpitSpan: (index: number, span: 1 | 2) => void;
  removeCockpitWidget: (index: number) => void;
  addCockpitWidget: (kind: WidgetKind) => void;
  resetCockpit: () => void;
}

/** Save an external (other-AI-tool) session into the KB as a decision brief.
 *  Mirrors the runResearch tail: synthesize → commit → wiki-log → select + undo. */
export interface ExternalContextSlice {
  saveExternalSessionToKb: (convId: string) => Promise<{
    ok: boolean;
    summary?: string;
    pageId?: string;
    undo?: () => void;
    error?: string;
  }>;
}

export type Store = WorkspaceSlice &
  CommentsSlice &
  UiSlice &
  SidebarSlice &
  JournalSlice &
  TweaksSlice &
  TemplatesSlice &
  CockpitSlice &
  AssistantSlice &
  ExternalContextSlice;
