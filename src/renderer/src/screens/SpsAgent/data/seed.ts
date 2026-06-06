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
    "Your workspace and agent cockpit. Capture notes, run the task board, and let your assistant draft, summarize, and act on what's here.",
  ),
  blk(
    "callout",
    "Tip: press / for blocks, ⌘K to search, and ⌘J to open the assistant on any page.",
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
    title: "Connect an agent profile",
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
  // Single-user workspace ships with no seed annotations — you create your own.
  const comments: Comment[] = [];
  return { tree, meta, docs, comments, trash: [], page: "home" };
}
