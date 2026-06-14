// seed.ts — sample workspace content + initial-workspace builder.
// Ported from data.jsx and the seeding half of store.jsx.
import { blk } from "../lib/ids";
import type {
  Block,
  Comment,
  Person,
  PersonKey,
  PrioDef,
  PrioKey,
  SeedTreeNode,
  StatusDef,
  StatusKey,
  Task,
  TreeNode,
  Workspace,
  PageMeta,
} from "../types";

// ---- the Home document ----
export const HOME_BLOCKS: Block[] = [
  blk(
    "p",
    "Your SPS workspace. Capture notes, run the task board, and let My Assistant draft, summarize, and act on what's here.",
  ),
  blk(
    "callout",
    "Tip: press / for blocks, ⌘K to search, and ⌘J to open My Assistant on any page.",
    { emoji: "✨" },
  ),
  blk("h2", "This week"),
  blk("todo", "Ask the assistant to summarize this page", { done: false }),
  blk("todo", "Add your first project to the board below", { done: false }),
  blk("todo", "Make a page your own — try / blocks and a cover", {
    done: false,
  }),
  blk("h2", "Tasks"),
  blk("database", "", { view: "board" }),
  blk("h2", "Notes"),
  blk(
    "p",
    "Jot anything here. Select text to rewrite it as tracked changes, or pin a note to a block from the assistant panel.",
  ),
  blk(
    "quote",
    "The fastest way to find the right answer is to make the question cheap to ask.",
  ),
  blk("divider"),
  blk("p", ""),
];

// ---- first-run guided pages (the "Home Base" first loop) ----
// "Start here" lands first on a fresh workspace and demonstrates the three
// things that make this more than a notes app: wikilinks (the page-link blocks
// below populate the graph), the capture→ingest→search loop, and the assistant.
// Stable ids ("start-here" / "inbox-explainer") so the [[wikilinks]] resolve to
// real page files on disk in vault mode.
export const START_HERE_BLOCKS: Block[] = [
  blk(
    "p",
    "Welcome to your Home Base — one place that unifies your notes, tasks, and AI chats. Here's the quick tour.",
  ),
  blk(
    "callout",
    "Everything here is yours and lives as plain Markdown on disk. Press ⌘K to search across all of it, ⌘J to ask My Assistant on any page.",
    { emoji: "🏠" },
  ),
  blk("h2", "Find your way around"),
  blk("page", "", { pageId: "home" }),
  blk("page", "", { pageId: "inbox-explainer" }),
  blk("h2", "Your first loop"),
  blk("p", "Three steps turn this into a living knowledge base:"),
  blk("todo", "Capture — drop a link, note, or idea into the Inbox", {
    done: false,
  }),
  blk("todo", "Ingest — let My Assistant file it into the right page", {
    done: false,
  }),
  blk("todo", "Search — find it later with ⌘K (notes, tasks, and chats)", {
    done: false,
  }),
  blk(
    "p",
    "Tip: pages link to each other — open the Graph from the sidebar to see how yours connect.",
  ),
];

export const INBOX_EXPLAINER_BLOCKS: Block[] = [
  blk(
    "callout",
    "The Inbox is where raw material lands before it's filed — your capture tray.",
    { emoji: "📥" },
  ),
  blk("h2", "How it works"),
  blk("li", "Capture: send links, snippets, or quick notes to the Inbox."),
  blk(
    "li",
    "Ingest: press “Process inbox” and My Assistant files each item into the right page, cited.",
  ),
  blk(
    "li",
    "Review: nothing is lost — unparseable items are kept, not dropped.",
  ),
  blk(
    "p",
    "Open the Inbox from the sidebar. Once it's empty, you're caught up.",
  ),
];

// ---- people / status / priority reference tables ----
// Single-user app: the only built-in person is "you". PersonKey is a free string,
// so additional people can still be added via @mentions / assignee pickers.
export const PEOPLE: Record<PersonKey, Person> = {
  you: { name: "You", initials: "Y", color: "#1B4F8A" },
};

export const STATUS: Record<StatusKey, StatusDef> = {
  todo: { label: "To do", cls: "s-todo", dot: "#8a8d93" },
  doing: { label: "In progress", cls: "s-doing", dot: "#C79400" },
  review: { label: "In review", cls: "s-review", dot: "#1B4F8A" },
  done: { label: "Done", cls: "s-done", dot: "#1F6B3A" },
  inbox: { label: "Brain Dump", cls: "s-inbox", dot: "#8a8d93" },
  this_week: { label: "This Week", cls: "s-this-week", dot: "#3A86C8" },
  blocked: { label: "Waiting / Blocked", cls: "s-blocked", dot: "#E05A47" },
};

export const PRIO: Record<PrioKey, PrioDef> = {
  high: { label: "High", cls: "p-high" },
  med: { label: "Medium", cls: "p-med" },
  low: { label: "Low", cls: "p-low" },
};

// ---- tasks database seed ----
// A light, single-user sample so the board isn't empty on first run. Everything
// is assigned to "you"; clear these out and add your own anytime.
export const TASKS: Task[] = [
  {
    id: "t1",
    title: "Draft the project brief",
    status: "doing",
    prio: "high",
    who: "you",
    due: "",
    est: "",
  },
  {
    id: "t2",
    title: "Review this week's notes",
    status: "doing",
    prio: "med",
    who: "you",
    due: "",
    est: "",
  },
  {
    id: "t3",
    title: "Set up a recurring summary",
    status: "todo",
    prio: "med",
    who: "you",
    due: "",
    est: "",
  },
  {
    id: "t4",
    title: "Tidy the workspace structure",
    status: "todo",
    prio: "low",
    who: "you",
    due: "",
    est: "",
  },
  {
    id: "t5",
    title: "Try a template",
    status: "review",
    prio: "low",
    who: "you",
    due: "",
    est: "",
  },
  {
    id: "t7",
    title: "Connect an assistant profile",
    status: "done",
    prio: "high",
    who: "you",
    due: "",
    est: "",
  },
];

// ---- sidebar page tree seed ----
export const FAVORITES: SeedTreeNode[] = [
  { id: "home", emoji: "🏠", label: "Home" },
];

export const TREE: SeedTreeNode[] = [
  {
    id: "home",
    emoji: "🏠",
    label: "Home",
    children: [
      { id: "sync", emoji: "🗓️", label: "Weekly notes" },
      { id: "okr", emoji: "🎯", label: "Goals" },
    ],
  },
  {
    id: "road",
    emoji: "🗺️",
    label: "Projects",
    children: [
      { id: "r24", emoji: "🚀", label: "First project" },
      { id: "r25", emoji: "🧪", label: "Ideas (draft)" },
    ],
  },
  { id: "people", emoji: "📚", label: "Reading list" },
];

// ---- suggested assistant prompts ----
export const SUGGESTIONS = [
  { id: "summary", icon: "sparkle", label: "Summarize this page" },
  { id: "nextsteps", icon: "wand", label: "Draft next steps" },
  { id: "tasks", icon: "board", label: "Pull action items into tasks" },
  { id: "tighten", icon: "text", label: "Tighten this writing" },
] as const;

/** Flatten a seed tree into a flat node list (for mention/palette listings). */
export function flattenTree(
  nodes: SeedTreeNode[],
  acc: SeedTreeNode[] = [],
): SeedTreeNode[] {
  for (const n of nodes) {
    acc.push(n);
    if (n.children) flattenTree(n.children, acc);
  }
  return acc;
}

// ---- initial workspace from the static seed (ported from store.jsx) ----
function treeFromSeed(nodes: SeedTreeNode[]): TreeNode[] {
  return nodes.map((n) => ({
    id: n.id,
    children: n.children ? treeFromSeed(n.children) : [],
  }));
}

function metaFromSeed(
  nodes: SeedTreeNode[],
  acc: Record<string, PageMeta>,
): Record<string, PageMeta> {
  nodes.forEach((n) => {
    acc[n.id] = { icon: n.emoji, title: n.label, cover: null };
    if (n.children) metaFromSeed(n.children, acc);
  });
  return acc;
}

function starterDoc(title: string): Block[] {
  return [
    blk(
      "callout",
      `This is the ${title} page. Type "/" for blocks, or ask the assistant to draft it for you.`,
      {
        emoji: "📄",
      },
    ),
    blk("h2", "Overview"),
    blk("p", ""),
    blk("h2", "Details"),
    blk("p", ""),
  ];
}

export function buildInitialWorkspace(): Workspace {
  const tree = treeFromSeed(TREE);
  const meta = metaFromSeed(TREE, {});
  meta.home = { icon: "🏠", title: "Home", cover: null };
  const docs: Record<string, Block[]> = { home: HOME_BLOCKS };
  Object.keys(meta).forEach((id) => {
    if (id !== "home" && !docs[id]) docs[id] = starterDoc(meta[id].title);
  });

  // First-run guided entry: a "Start here" page (wiki-linked to Home/Tasks and a
  // nested Inbox explainer) that lands first and demonstrates the capture→ingest
  // →search loop and the wikilink graph. Only ever surfaces on a genuinely fresh
  // workspace — once workspace.json exists, hydrateWorkspace() replaces this.
  const startHereId = "start-here";
  const inboxId = "inbox-explainer";
  meta[startHereId] = { icon: "📍", title: "Start here", cover: null };
  meta[inboxId] = { icon: "📥", title: "How the Inbox works", cover: null };
  docs[startHereId] = START_HERE_BLOCKS;
  docs[inboxId] = INBOX_EXPLAINER_BLOCKS;
  tree.unshift({ id: startHereId, children: [{ id: inboxId, children: [] }] });

  // Single-user workspace ships with no seed annotations — you create your own.
  const comments: Comment[] = [];
  return { tree, meta, docs, comments, trash: [], page: startHereId };
}
