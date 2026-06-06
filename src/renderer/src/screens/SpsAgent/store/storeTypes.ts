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
} from "../types";
import type { WorkDetail } from "../../../../../shared/openalex/core";

export type RightTab = "assistant" | "outline" | "comments" | "info";

// Top-level surface shown in the main area. "doc" is the page editor (default);
// the others are full-area surfaces reached from the rail (ideas A2/A4 + the
// Ask panel and Agent Console). "chats" is the AI Chats surface (sessions),
// distinct from "agent" (the tool-using Agent Console) but sharing <Chat>.
// "graph" is the local wikilink graph view (F4).
export type Surface =
  | "doc"
  | "insights"
  | "memory"
  | "you"
  | "ask"
  | "agent"
  | "chats"
  | "graph"
  | "equity"
  | "journal";

// Named, toggleable sidebar sections (Notion 3.1 grammar). Order here is the
// render order in the rail.
export type SectionId =
  | "meetings"
  | "recents"
  | "agents"
  | "shared"
  | "private"
  | "apps";

export const SECTION_ORDER: SectionId[] = [
  "meetings",
  "recents",
  "agents",
  "shared",
  "private",
  "apps",
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
  renamePage: (id: string, title: string) => void;
  movePage: (dragId: string, targetId: string, where: DropWhere) => void;
  setPMeta: (patch: Partial<PageMeta>) => void;
  resetWorkspace: () => void;
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
  tweaksOpen: boolean;
  openTask: Task | null;
  emojiPick: XY | null;
  coverPick: XY | null;
  toast: { text: string; tone?: "warn" } | null;
  focusReq: string | null;
  // AI Chats surface: the session currently shown (null = a fresh chat).
  activeChatSession: string | null;
  // A prompt to pre-fill into the chat on next mount (powers the "card → guided
  // agent flow" entry points: meetings, calendar, apps). Consumed once.
  pendingChatPrompt: string | null;
  // Bumped on every new-chat / session-select so the chat surface remounts
  // cleanly (re-captures the pending prompt, reloads the transcript).
  chatNonce: number;

  setPanelOpen: (v: boolean) => void;
  setRightTab: (t: RightTab) => void;
  openPanelTab: (t: RightTab) => void;
  setSurface: (s: Surface) => void;
  setPaletteOpen: (v: boolean) => void;
  setTemplatesOpen: (v: { parent: string | null } | null) => void;
  setTrashOpen: (v: boolean) => void;
  setResearchOpen: (v: boolean) => void;
  setTweaksOpen: (v: boolean) => void;
  setOpenTask: (t: Task | null) => void;
  setEmojiPick: (v: XY | null) => void;
  setCoverPick: (v: XY | null) => void;
  setFocusReq: (id: string | null) => void;
  flash: (text: string, opts?: { tone?: "warn"; ms?: number }) => void;
  setActiveChatSession: (id: string | null) => void;
  setPendingChatPrompt: (text: string | null) => void;
  /** Open the AI Chats surface on a fresh chat, optionally pre-filled. */
  startNewChat: (prompt?: string) => void;
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
  decideProposal: (proposalId: string, accept: boolean) => void;
  applyDbAction: (messageId: string, action: DbAction) => void;
  dismissDbAction: (messageId: string) => void;
}

export type Store = WorkspaceSlice &
  CommentsSlice &
  UiSlice &
  SidebarSlice &
  JournalSlice &
  TweaksSlice &
  AssistantSlice;
