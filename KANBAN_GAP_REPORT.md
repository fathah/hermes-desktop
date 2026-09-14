# Kanban — Reference vs. hermes-desktop: Report & Plan

_Generated 2026-06-21. Sources: `hermes-agent` docs + `kanban_db.py` + `plugins/kanban/dashboard/plugin_api.py`; our `src/main/kanban.ts` + `src/renderer/src/screens/Kanban/Kanban.tsx`._

## 1. What Kanban is (in hermes-agent)

Hermes Kanban is a **durable, SQLite-backed task board** (`~/.hermes/kanban.db`, WAL mode) for coordinating multiple named agent profiles. It is the heavier sibling of `delegate_task`:

| | `delegate_task` | Kanban |
|---|---|---|
| Shape | RPC (fork→join) | Durable queue + state machine |
| Parent | Blocks | Fire-and-forget |
| Child | Anonymous subagent | Named profile w/ persistent memory |
| Resumable | No | Block→unblock→re-run; crash→reclaim |
| Human-in-loop | No | Comment / unblock anytime |
| Audit | Lost on compression | Durable SQLite rows |

**Three surfaces, one `kanban_db` core (cannot drift):**
1. **Agents** drive it via `kanban_*` tools (`kanban_show/list/complete/block/heartbeat/comment/create/link/unblock`).
2. **Humans/scripts/cron** drive it via `hermes kanban …` CLI and `/kanban` slash command.
3. **Dashboard plugin** (FastAPI + React SPA) at `plugins/kanban/` — REST under `/api/plugins/kanban/`, live `task_events` WebSocket.

**Key concepts:** Board (isolated queue, multi-project) · Task · Link (parent→child dependency, promotes `todo→ready` when all parents `done`) · Comment (inter-agent protocol) · Workspace (`scratch` / `dir:<abs>` / `worktree`) · Dispatcher (gateway-embedded loop, 60s tick: reclaim stale/crashed, promote, claim, spawn) · Tenant (soft namespace within a board).

**Notable mechanics:** auto-decompose of triage tasks, goal-mode cards (Ralph loop + judge), circuit-breaker (`failure_limit`, auto-block after N spawn failures), respawn guard (`blocker_auth`/`recent_success`/`active_pr`), `scheduled_at` delayed dispatch, diagnostics rule-engine, attachments (25 MB cap), Kanban Swarm topology helper.

## 2. Canonical statuses (the "kanban words")

From `kanban_db.VALID_STATUSES`:

```
triage · todo · scheduled · ready · running · blocked · review · done · archived
```

Dashboard `BOARD_COLUMNS` (plugin_api.py): `triage, todo, scheduled, ready, running, blocked, review, done` (+ `archived` via toggle).

`VALID_INITIAL_STATUSES = {running, blocked}`.

### Allowed status transitions (from plugin PATCH `/tasks/:id`)
- `done` → `complete_task(result, summary, metadata)`
- `blocked` → `block_task(reason)`
- `scheduled` → `schedule_task(reason)`
- `ready` → if currently `blocked`/`scheduled` → `unblock_task`; else direct set (drag-drop `todo→ready`); **refused if any parent not `done`** (409 names the blocking parent)
- `archived` → `archive_task`
- `running` → **rejected** ("use the dispatcher/claim path")
- `todo` / `triage` / `scheduled` → direct set
- Reopening a `done`/`archived` parent demotes stale-`ready` children back to `todo`.

## 3. Actions / API surface

### Canonical CLI verbs (`hermes_cli/kanban.py`)
`init, create, list, show, assign, reassign, edit, promote, schedule, diagnostics, link, unlink, claim, comment, complete, block, unblock, archive, tail, watch, heartbeat, runs, assignees, dispatch, daemon, stats, log, notify-subscribe, notify-list, notify-unsubscribe, context, specify, decompose, swarm, gc`, plus `boards {list,create,rm,switch,show,rename,set-workdir}`.

### Dashboard REST (representative)
`GET /board` · `GET/POST/PATCH/DELETE /tasks[/:id]` · `POST /tasks/bulk` · attachments CRUD · `POST /tasks/:id/comments` · `POST /tasks/:id/{specify,decompose}` · `GET/PATCH /profiles[/:name]` + `/describe-auto` · `GET/PUT /orchestration` · `POST/DELETE /links` · `POST /dispatch` · `GET /diagnostics` · `GET /workers/active` · `GET /runs/:id[/inspect]` · `POST /runs/:id/terminate` · `GET /config` · `WS /events`.

> Note: the **reference desktop app** (`hermes-agent/apps/desktop`) has **no kanban board UI** — only `/kanban` as a slash-command string and a notifications comment. The rich UI reference is the **dashboard plugin**, not that app.

## 4. What our hermes-desktop has today

**Main (`src/main/kanban.ts`)** — execs `hermes kanban` (local) or SSH-tunnels (`sshRunKanban`); blocks plain-remote mode. Exposes:
`listBoards, currentBoard, switchBoard, createBoard, removeBoard, listTasks, getTask, createTask, assignTask, completeTask, blockTask, unblockTask, archiveTask, specifyTask, reclaimTask, commentTask, listClaw3dHqTasks, dispatchOnce`.

**Renderer (`Kanban.tsx`)** — 6 columns `triage, todo, ready, running, blocked, done`; 6s poll; board switcher (+ read-only Claw3D HQ virtual board); create-task modal; create-board modal; read-only detail modal (body/summary/result/comments/events). Card actions: specify, mark-done, reclaim, unblock, block, archive. Drag-drop transitions: `→done`, `→blocked` (from todo/ready/running), `blocked→ready`.

## 5. Gap analysis (reference → ours)

### A. Status coverage
| Status | Canonical | Our columns | Gap |
|---|---|---|---|
| triage,todo,ready,running,blocked,done | ✓ | ✓ | — |
| **scheduled** | ✓ | ✗ | **Missing column** — `scheduled` tasks fall through to `todo` bucket (`Kanban.tsx:322`). |
| **review** | ✓ | ✗ | **Missing column** — `review` tasks mis-bucket to `todo`. |
| archived | ✓ (toggle) | ✗ | No "show archived" toggle in UI (main supports `includeArchived`). |

### B. Actions defined in main but NOT surfaced in UI
- `assignTask` / reassign — no reassign control in detail modal.
- `commentTask` — detail modal shows comments **read-only**; no compose box.
- `removeBoard` — no delete-board affordance.

### C. Canonical actions NOT wired at all (no main fn, no UI)
- **`decompose`** — the headline triage flow (fan-out to child graph). We only have `specify`.
- **`promote`** (todo/blocked→ready recovery), **`schedule`** (`scheduled_at`), **`edit`** (title/body/priority in place — we can create but not edit), **`link`/`unlink`** (dependency editing), **`diagnostics`**, **`runs`** (attempt history — `KanbanRun` typed but not fetched standalone), **`assignees`/`stats`**, **`notify-*`**, **`swarm`**, **`gc`**, **`tail`/`watch`**, **`heartbeat`**, **boards `rename`/`set-workdir`**, **attachments** (upload/list/download/delete).

### D. UX / behavior gaps vs dashboard plugin
- **Polling vs live** — we poll every 6s; plugin tails `task_events` over WebSocket (instant, debounced). No WS bridge in our main.
- **No dependency / progress UI** — no parent/child chips, no `N/M` progress pill, no link editor.
- **No diagnostics surfacing** — no distress badges (hallucination/crash/stuck-blocked) the plugin renders.
- **No bulk multi-select** actions.
- **No orchestration controls** — Auto/Manual decompose pill, profile-description editor, orchestrator settings.
- **Transition rules are re-implemented client-side** (`isValidDragTransition`) and narrower than the backend — risk of drift; e.g. no `→scheduled`, no `→review`, no `→ready` from `todo` via drag.
- **Detail modal is read-only** — can't edit title/body/priority/assignee or add comments/links inline.

## 6. Recommended plan (phased)

### Phase 1 — Correctness (low effort, high value)
1. Add `scheduled` + `review` to `COLUMNS` and `en/kanban.ts` `status.*` (and other locales). Fixes silent mis-bucketing.
2. Add a **"show archived"** toggle (main already supports `includeArchived`).
3. Wire **comment compose** in the detail modal (`commentTask` already in main).
4. Wire **reassign** in the detail modal (`assignTask` already in main).

### Phase 2 — Parity actions
5. Add main fns + UI for **`decompose`**, **`edit`** (title/body/priority), **`promote`**, **`schedule`** (`--at`), **`link`/`unlink`** (dependency editor with parent/child chips + progress pill).
6. Add **`runs`/diagnostics`** read views in the detail drawer (attempt history, distress badges).

### Phase 3 — Live + richer UX
7. Replace 6s poll with a **`task_events` tail** (SSH `kanban watch --json` stream, or local tail) for instant updates.
8. **Bulk multi-select** actions; **orchestration** Auto/Manual + profile descriptions; **attachments**.

### Cross-cutting
- Prefer routing transitions through backend verbs rather than widening the client-side `isValidDragTransition`, to avoid drift from `kanban_db` rules.
- Keep SSH-tunnel + remote-unsupported guards on every new verb (existing pattern in `kanban.ts`).
- Each new IPC verb needs: `kanban.ts` fn → `ipc/register.ts` → `preload/index.ts` (+ `.d.ts`) → renderer.
