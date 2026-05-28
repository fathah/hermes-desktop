# Hermes Desktop Rework — Design Spec (Mock 001 / “Focused Workbench”)

**Source mock:** `sketches/001-focused-workbench/index.html` + `sketches/001-focused-workbench/README.md`

**Status:** Draft (content-first spec; implementation details TBD)

## 0) Goal / One-liner
Build a desk-first **agent workbench** where the user keeps a glanceable agent list visible at all times, and the selected agent **owns the main workspace**.

> Contract: **pick an agent → now I’m inside that agent’s home**, without leaving a single cohesive app shell.

## 1) Scope
### In scope (Mock 001)
- 3-pane shell:
  1) **Global rail** (thin, persistent)
  2) **Agent list / summary pane** (glanceable, persistent)
  3) **Focused workspace** (changes with selected agent)
- Per-agent workspace **tabs**:
  - Chat
  - Runs
  - Ideas
  - Schedules
  - Status
- Workspace header with agent identity + quick actions
- Agent list cards with: avatar/initial, name, role/description, status pill, badges, meta/recency
- “Workbench summary band” metrics (at least):
  - Unread inbox
  - Failing jobs
  - Waiting threads
  - Running now

### Explicitly out of scope (for this spec draft)
- New visual language redesign (Mock 001 sets the tone; we implement it)
- Full feature expansion (Kanban/Office/Gate/etc.) beyond nav placement and stubbing
- Backend/agent runtime changes unless required for UI correctness

## 2) Build / Implementation constraints (grounded)
- App stack: **Electron + electron-vite**
- Renderer: **React**
- Packaging: **electron-builder**
- Build gate: `npm run build` includes **typecheck**

Constraint implication: this spec prefers **incremental UI integration** behind existing routes/components, and prioritizes changes that keep `npm test` and `npm run build` green.

## 3) Design stance (from Mock 001 notes)
- Desk-first operational shell; compact, scan-friendly labels
- Dark operator console feel, cool accent glow (close to current Hermes desktop tone)
- Inbox is present via **badges + per-agent tabs**, not as the only first impression

## 4) Information architecture
### 4.1 Global rail (primary navigation)
Mock shows (labels abbreviated in mock):
- Chat
- Sessions
- Inbox
- Ideas
- Agents
- Kanban
- Schedules
- Office
- Gate
- Settings

**Spec requirement:**
- Rail must support:
  - Icon + short label (or tooltip)
  - Active state
  - Keyboard navigation
  - Room for “companion dock” at bottom

**Open design question:** what is the canonical top-level route when the app opens?
- Option A: last selected agent + last selected tab
- Option B: Agents workbench (as mock suggests)

### 4.2 Agent list / summary pane
- Header:
  - Eyebrow: “Agent workbench”
  - Title: “Pick an agent, then drop into work”
  - Subtitle: “The left pane stays glanceable; the right pane becomes that agent’s home.”
- Filter chips:
  - All
  - Needs attention
  - Running
  - Waiting
- Summary band metrics (4-up)
- Agent cards list

### 4.3 Focused workspace
- Workspace header:
  - Agent avatar + name + role/description
  - Quick actions:
    - Open chat
    - Open inbox
    - Run default job
    - Inspect last error
- Tabs (per-agent): Chat / Runs / Ideas / Schedules / Status
- Main content region + side stack (2-column panel grid)

## 5) Core UI components (definition of done)
### 5.1 GlobalRail
**Props/data**
- `activeSection`
- `navItems[]` (id, label, icon, badgeCount?)

**Behavior**
- Click changes primary section.
- Keyboard: up/down, enter to activate.

### 5.2 AgentSummaryPane
**Props/data**
- `agents[]` (see data model)
- `filters[]` + selected filter
- `summaryMetrics` (unread, failing, waiting, running)

**Behavior**
- Selecting an agent updates the FocusedWorkspace identity + resets tab to default (Mock uses Chat).

### 5.3 AgentCard
**Must show**
- Avatar (initial or graphic)
- Name
- Role/one-line description
- Status pill: running | waiting | idle | error
- Badge row: small operational tags
- Meta: recency + secondary hint (e.g., “next digest 17:30”)

### 5.4 FocusedWorkspace
**Props/data**
- Selected agent
- Active tab

**Behavior**
- Tab switching changes the main panel + side stack.

### 5.5 WorkspaceTabs
**Tabs are per-agent** but share the canonical set.
- Chat
- Runs
- Ideas
- Schedules
- Status

**Definition of done:**
- Active styling matches mock (subtle accent background)
- Tabs can be navigated via keyboard

### 5.6 PrimaryPanel + SideStack panels
- Primary panel shows a stream/list appropriate to tab
- Side stack shows 2–3 “mini panels” for glanceable context

## 6) Data model requirements (UI-level)
### 6.1 Agent
Minimum fields needed to render Mock 001:
- `id: string`
- `displayName: string`
- `avatarKey | avatarInitial: string`
- `roleSummary: string`
- `status: 'running' | 'waiting' | 'idle' | 'error'`
- `badges: string[]` (small tags)
- `metaLeft: string` (e.g., “last active 2m ago”)
- `metaRight: string` (e.g., “next digest 17:30”)

### 6.2 Tab content
Mock models each tab as:
- `primary[]`: list of items (chat messages / run entries / idea items / schedule items / status items)
- `side[]`: list of small summary panels { title, body }

Spec requirement: the real app should support this shape even if initially populated by placeholder adapters.

## 7) States & empty/error handling
- If no agents exist:
  - Agent pane shows empty state + CTA to create/import profile
  - Focused workspace shows friendly placeholder
- If agent data unavailable:
  - Show skeleton loaders; avoid layout shift
- Error status:
  - Status pill “error” + badge conveys “1 failing job” style items
  - “Inspect last error” should route to the most recent failing run/log for that agent

## 8) Interaction rules
- Selecting a different agent:
  - Updates workspace identity immediately
  - Default tab: **Chat** (as mock behavior)
- Quick actions:
  - Open chat → activates Chat tab
  - Open inbox → activates Runs tab *or* a dedicated Inbox view scoped to agent (TBD)
  - Run default job → triggers agent default action (requires per-agent mapping)
  - Inspect last error → opens latest error detail (agent-scoped)

## 9) Visual system requirements (token-level)
From mock CSS:
- Dark base background + subtle radial accent glows
- Panels with rounded corners, subtle borders, and blur/backdrop feel
- Status colors:
  - running: green
  - waiting: amber
  - idle: neutral
  - error: red/pink

**DoD:**
- Implement as theme tokens (CSS variables / Tailwind tokens) rather than hard-coding in components.

## 10) Accessibility & usability
- Color contrast for muted text and status colors must remain readable.
- All clickable items must be keyboard reachable.
- Focus states must be visible (not purely color subtlety).
- Tab list should announce selected state to screen readers.

## 11) Telemetry / QA hooks (optional but recommended)
- Track:
  - agent selection changes
  - tab switches
  - quick action invocations
  - time-to-first-render for agent pane/workspace

## 12) Open questions (to resolve before Kramer deep-dive)
1) What is the canonical mapping of global rail items to routes in the current app?
2) Is “Inbox” a global unified queue, or always agent-scoped, or both?
3) What defines an agent’s “default job” (config field? heuristic? explicit button mapping?)
4) Which data is local vs remote (sessions/runs) and which must remain offline-first?
5) How should profiles relate to agents in this UI (1:1 vs multiple profiles per agent)?

## 13) Next steps (execution order)
1) Implement the 3-pane shell layout (rail + agent pane + workspace) with static data.
2) Wire to real agent/profile list.
3) Wire tabs to existing screens/components incrementally.
4) Replace placeholders for Runs/Schedules/Status with live data sources.

---

### Appendix A — Mock 001 key text (canonical copy)
- “Pick an agent, then drop into work”
- “The left pane stays glanceable; the right pane becomes that agent’s home.”
