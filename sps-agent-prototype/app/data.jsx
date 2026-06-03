// data.jsx — sample workspace content (generic Notion-style)

let _id = 0;
const _seed = Math.random().toString(36).slice(2, 6);
const uid = (p = 'b') => `${p}${_seed}${++_id}`;

// ---- block factory ----
const blk = (type, text = '', extra = {}) => ({ id: uid(), type, text, ...extra });

// ---- the Home document ----
const HOME_BLOCKS = [
  blk('p', "A shared home base for the product team. Jump into this week's focus, review the task board, and let the workspace assistant tidy things up."),
  blk('callout', "Standup is at 9:30. Drop blockers in the thread before you join — keep it to one line each.", { emoji: '📌' }),
  blk('h2', 'This week'),
  blk('todo', 'Ship onboarding redesign to staging', { done: true }),
  blk('todo', 'Review the Q3 planning doc and leave comments', { done: false }),
  blk('todo', 'Sync with design on the empty-state illustrations', { done: false }),
  blk('todo', 'Draft the changelog for the 2.4 release', { done: false }),
  blk('h2', 'Tasks'),
  blk('database', '', { view: 'board' }),
  blk('h2', 'Meeting notes'),
  blk('p', 'Weekly product sync — attendees: Maya, Theo, Priya, Sam. Notes captured live; action items pulled into the board above.'),
  blk('h3', 'Decisions'),
  blk('li', 'Onboarding redesign goes to staging Thursday; full rollout gated on the activation metric holding for a week.'),
  blk('li', 'We are cutting the multi-workspace switcher from 2.4 — it slips to 2.5.'),
  blk('li', 'Priya owns the migration guide; draft by Friday.'),
  blk('h3', 'Open questions'),
  blk('li', 'Do we backfill historical analytics, or start clean from the migration date?'),
  blk('li', 'Who signs off on the pricing-page copy before it ships?'),
  blk('quote', 'The fastest way to find the right answer is to make the question cheap to ask.'),
  blk('divider'),
  blk('p', ''),
];

// ---- tasks database ----
const PEOPLE = {
  maya:  { name: 'Maya',  initials: 'MR', color: '#C0392B' },
  theo:  { name: 'Theo',  initials: 'TK', color: '#1F6B3A' },
  priya: { name: 'Priya', initials: 'PS', color: '#1B4F8A' },
  sam:   { name: 'Sam',   initials: 'SD', color: '#5A3A8A' },
};
const STATUS = {
  todo:   { label: 'To do',       cls: 's-todo',   dot: '#8a8d93' },
  doing:  { label: 'In progress', cls: 's-doing',  dot: '#C79400' },
  review: { label: 'In review',   cls: 's-review', dot: '#1B4F8A' },
  done:   { label: 'Done',        cls: 's-done',   dot: '#1F6B3A' },
};
const PRIO = {
  high: { label: 'High', cls: 'p-high' },
  med:  { label: 'Medium', cls: 'p-med' },
  low:  { label: 'Low', cls: 'p-low' },
};

const TASKS = [
  { id: uid('t'), title: 'Redesign onboarding flow',            status: 'doing',  prio: 'high', who: 'maya',  due: 'Jun 4',  est: '3d' },
  { id: uid('t'), title: 'Migrate analytics to new pipeline',   status: 'doing',  prio: 'med',  who: 'theo',  due: 'Jun 6',  est: '5d' },
  { id: uid('t'), title: 'Write 2.4 changelog',                 status: 'todo',   prio: 'med',  who: 'sam',   due: 'Jun 5',  est: '1d' },
  { id: uid('t'), title: 'Empty-state illustrations',           status: 'todo',   prio: 'low',  who: 'priya', due: 'Jun 9',  est: '2d' },
  { id: uid('t'), title: 'Pricing page copy pass',              status: 'review', prio: 'high', who: 'sam',   due: 'Jun 3',  est: '4h' },
  { id: uid('t'), title: 'Activation metric dashboard',         status: 'review', prio: 'med',  who: 'theo',  due: 'Jun 4',  est: '1d' },
  { id: uid('t'), title: 'Q3 planning doc',                     status: 'done',   prio: 'high', who: 'maya',  due: 'May 30', est: '2d' },
  { id: uid('t'), title: 'Audit accessibility on settings',     status: 'done',   prio: 'low',  who: 'priya', due: 'May 28', est: '1d' },
];

// ---- sidebar page tree ----
const FAVORITES = [
  { id: 'home', emoji: '🏠', label: 'Team Home' },
  { id: 'road', emoji: '🗺️', label: 'Product roadmap' },
];
const TREE = [
  { id: 'home', emoji: '🏠', label: 'Team Home', children: [
    { id: 'sync', emoji: '🗓️', label: 'Weekly sync notes' },
    { id: 'okr',  emoji: '🎯', label: 'OKRs — Q3' },
  ]},
  { id: 'road', emoji: '🗺️', label: 'Product roadmap', children: [
    { id: 'r24', emoji: '🚢', label: 'Release 2.4' },
    { id: 'r25', emoji: '🧪', label: 'Release 2.5 (draft)' },
  ]},
  { id: 'eng', emoji: '⚙️', label: 'Engineering', children: [
    { id: 'arch', emoji: '🏗️', label: 'Architecture notes' },
    { id: 'oncall', emoji: '🔔', label: 'On-call runbook' },
  ]},
  { id: 'design', emoji: '🎨', label: 'Design library' },
  { id: 'people', emoji: '👥', label: 'Team wiki' },
];

// suggested agent prompts
const SUGGESTIONS = [
  { id: 'summary', icon: 'sparkle', label: 'Summarize this page' },
  { id: 'nextsteps', icon: 'wand', label: 'Draft next steps' },
  { id: 'tasks', icon: 'board', label: 'Pull action items into tasks' },
  { id: 'tighten', icon: 'text', label: 'Tighten the meeting notes' },
];

function flattenTree(nodes, acc = []) {
  for (const n of nodes) { acc.push(n); if (n.children) flattenTree(n.children, acc); }
  return acc;
}

Object.assign(window, { uid, blk, HOME_BLOCKS, TASKS, PEOPLE, STATUS, PRIO, FAVORITES, TREE, SUGGESTIONS, flattenTree });
