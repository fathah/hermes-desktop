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
  | "ask"
  | "agent"
  | "chats"
  | "graph";

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
    info: { icon?: string; title?: string },
    docBlocks: Block[],
    parentId: string | null,
  ) => string;
  newSubPage: (parentId: string) => void;
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
  tweaksOpen: boolean;
  openTask: Task | null;
  emojiPick: XY | null;
  coverPick: XY | null;
  toast: { text: string } | null;
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
  setTweaksOpen: (v: boolean) => void;
  setOpenTask: (t: Task | null) => void;
  setEmojiPick: (v: XY | null) => void;
  setCoverPick: (v: XY | null) => void;
  setFocusReq: (id: string | null) => void;
  flash: (text: string) => void;
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

export interface TweaksSlice {
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
}

export interface AssistantSlice {
  messages: AgentMessage[];
  thinking: boolean;
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
  TweaksSlice &
  AssistantSlice;
