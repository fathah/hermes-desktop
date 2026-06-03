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
    "A shared home base for the product team. Jump into this week's focus, review the task board, and let the workspace assistant tidy things up.",
  ),
  blk(
    "callout",
    "Standup is at 9:30. Drop blockers in the thread before you join — keep it to one line each.",
    { emoji: "📌" },
  ),
  blk("h2", "This week"),
  blk("todo", "Ship onboarding redesign to staging", { done: true }),
  blk("todo", "Review the Q3 planning doc and leave comments", { done: false }),
  blk("todo", "Sync with design on the empty-state illustrations", {
    done: false,
  }),
  blk("todo", "Draft the changelog for the 2.4 release", { done: false }),
  blk("h2", "Tasks"),
  blk("database", "", { view: "board" }),
  blk("h2", "Meeting notes"),
  blk(
    "p",
    "Weekly product sync — attendees: Maya, Theo, Priya, Sam. Notes captured live; action items pulled into the board above.",
  ),
  blk("h3", "Decisions"),
  blk(
    "li",
    "Onboarding redesign goes to staging Thursday; full rollout gated on the activation metric holding for a week.",
  ),
  blk(
    "li",
    "We are cutting the multi-workspace switcher from 2.4 — it slips to 2.5.",
  ),
  blk("li", "Priya owns the migration guide; draft by Friday."),
  blk("h3", "Open questions"),
  blk(
    "li",
    "Do we backfill historical analytics, or start clean from the migration date?",
  ),
  blk("li", "Who signs off on the pricing-page copy before it ships?"),
  blk(
    "quote",
    "The fastest way to find the right answer is to make the question cheap to ask.",
  ),
  blk("divider"),
  blk("p", ""),
];

// ---- people / status / priority reference tables ----
export const PEOPLE: Record<PersonKey, Person> = {
  maya: { name: "Maya", initials: "MR", color: "#C0392B" },
  theo: { name: "Theo", initials: "TK", color: "#1F6B3A" },
  priya: { name: "Priya", initials: "PS", color: "#1B4F8A" },
  sam: { name: "Sam", initials: "SD", color: "#5A3A8A" },
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
export const TASKS: Task[] = [
  {
    id: "t1",
    title: "Redesign onboarding flow",
    status: "doing",
    prio: "high",
    who: "maya",
    due: "Jun 4",
    est: "3d",
  },
  {
    id: "t2",
    title: "Migrate analytics to new pipeline",
    status: "doing",
    prio: "med",
    who: "theo",
    due: "Jun 6",
    est: "5d",
  },
  {
    id: "t3",
    title: "Write 2.4 changelog",
    status: "todo",
    prio: "med",
    who: "sam",
    due: "Jun 5",
    est: "1d",
  },
  {
    id: "t4",
    title: "Empty-state illustrations",
    status: "todo",
    prio: "low",
    who: "priya",
    due: "Jun 9",
    est: "2d",
  },
  {
    id: "t5",
    title: "Pricing page copy pass",
    status: "review",
    prio: "high",
    who: "sam",
    due: "Jun 3",
    est: "4h",
  },
  {
    id: "t6",
    title: "Activation metric dashboard",
    status: "review",
    prio: "med",
    who: "theo",
    due: "Jun 4",
    est: "1d",
  },
  {
    id: "t7",
    title: "Q3 planning doc",
    status: "done",
    prio: "high",
    who: "maya",
    due: "May 30",
    est: "2d",
  },
  {
    id: "t8",
    title: "Audit accessibility on settings",
    status: "done",
    prio: "low",
    who: "priya",
    due: "May 28",
    est: "1d",
  },
];

// ---- sidebar page tree seed ----
export const FAVORITES: SeedTreeNode[] = [
  { id: "home", emoji: "🏠", label: "Team Home" },
  { id: "road", emoji: "🗺️", label: "Product roadmap" },
];

export const TREE: SeedTreeNode[] = [
  {
    id: "home",
    emoji: "🏠",
    label: "Team Home",
    children: [
      { id: "sync", emoji: "🗓️", label: "Weekly sync notes" },
      { id: "okr", emoji: "🎯", label: "OKRs — Q3" },
    ],
  },
  {
    id: "road",
    emoji: "🗺️",
    label: "Product roadmap",
    children: [
      { id: "r24", emoji: "🚢", label: "Release 2.4" },
      { id: "r25", emoji: "🧪", label: "Release 2.5 (draft)" },
    ],
  },
  {
    id: "eng",
    emoji: "⚙️",
    label: "Engineering",
    children: [
      { id: "arch", emoji: "🏗️", label: "Architecture notes" },
      { id: "oncall", emoji: "🔔", label: "On-call runbook" },
    ],
  },
  { id: "design", emoji: "🎨", label: "Design library" },
  { id: "people", emoji: "👥", label: "Team wiki" },
];

// ---- suggested assistant prompts ----
export const SUGGESTIONS = [
  { id: "summary", icon: "sparkle", label: "Summarize this page" },
  { id: "nextsteps", icon: "wand", label: "Draft next steps" },
  { id: "tasks", icon: "board", label: "Pull action items into tasks" },
  { id: "tighten", icon: "text", label: "Tighten the meeting notes" },
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
  meta.home = { icon: "🏠", title: "Team Home", cover: null };
  const docs: Record<string, Block[]> = { home: HOME_BLOCKS };
  Object.keys(meta).forEach((id) => {
    if (id !== "home" && !docs[id]) docs[id] = starterDoc(meta[id].title);
  });
  const comments: Comment[] = [
    {
      id: "seed1",
      quote: "do we backfill historical analytics",
      blockId: null,
      page: "home",
      resolved: false,
      messages: [
        {
          name: "Theo K",
          initials: "TK",
          color: "#1F6B3A",
          time: "1h ago",
          text: "I'd start clean from the migration date — backfill is a week of work for little payoff.",
        },
      ],
    },
  ];
  return { tree, meta, docs, comments, trash: [], page: "home" };
}
