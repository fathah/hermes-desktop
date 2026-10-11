# Kanban board tab

The Kanban tab ([[src/renderer/src/screens/Kanban/Kanban.tsx]]) is a JIRA-style board for the hermes-agent multi-agent task queue, presented as "JIRA for AI agents": named agent profiles pick up cards, run them, and hand off through the durable `~/.hermes/kanban.db`.

Local and SSH modes use the `hermes kanban` CLI through [[src/main/kanban.ts]]. Direct Remote mode uses the authenticated dashboard Kanban plugin through [[src/main/remote-kanban.ts]]. The renderer holds no domain logic; it renders board state and routes actions to the selected target.

## Remote HTTP board

The dashboard plugin exposes board and task operations over HTTP, with server workspace paths entered as text rather than chosen from the desktop filesystem.

[[src/main/remote-kanban.ts]] maps task fields, status transitions, comments, and dispatch to `/api/plugins/kanban`. Board selection stays in desktop memory per server URL and profile and is sent as `?board=`, preserving the server's global current-board pointer. Selection writes capture their target before awaiting validation. [[src/main/remote-kanban.test.ts]] covers request schemas, profile routing, errors, and delayed board selection.

## Remote target lifecycle

Screen state belongs to one connection, profile, and resolved mode, so tasks, forms, and pending replies cannot carry over when the target changes.

The Layout keys Kanban by connection id. The screen additionally keys its content by profile and [[src/renderer/src/hooks/useConnectionTargetRevision.ts#useConnectionTargetRevision]], which subscribes to connection configuration changes so in-place URL or mode edits also discard the old screen lifetime.

### Profile changes

A delayed board reply for the old profile cannot replace the new profile's tasks or send an old task with the new profile when a card action is clicked.

### Connection edits

Editing a connection without changing its id resets loaded tasks and workspace forms, ignores late replies, and releases the configuration listener on unmount.

### SSH virtual board preference

A saved SSH-only HQ board preference does not suppress the real HTTP task list or its mutation controls when the user opens a direct Remote connection.

## Statuses and columns

The board renders the agent's canonical statuses, kept in sync with the agent's `kanban_db.VALID_STATUSES` and the dashboard plugin's `BOARD_COLUMNS`. Mis-syncing here silently mis-buckets cards into To-do.

The `COLUMNS` constant lists eight always-visible lanes in canonical order — `triage, todo, scheduled, ready, running, blocked, review, done` — each with a fixed status `tone` that drives a colored header dot and lane accent. A ninth `archived` lane is appended only when the "show archived" toggle is on; `STATUS_TONE` maps any status to its tone for surfaces outside the column loop (the detail drawer). A task whose status is none of the rendered columns falls back to the To-do lane.

## Actions

Cards expose status-appropriate actions, each calling a `hermes kanban` verb via the preload bridge. Header actions are dispatch, new task, new board, and the board switcher.

Card actions are specify (triage), mark-done (ready), reclaim (running), unblock (blocked), block (todo/ready), and archive (any).

Drag-drop moves route through `dragAction(from, to)`, which maps a target column to the single `hermes kanban` verb that effects it: `done`→complete, `blocked`→block, `ready`→unblock|reclaim|promote (by source), `scheduled`→schedule, `archived`→archive ([[src/main/kanban.ts#promoteTask]], [[src/main/kanban.ts#scheduleTask]]). The web dashboard can move a card to *any* column because it writes the status field directly in `kanban.db`; the desktop only has CLI verbs, so `todo`, `triage`, and `review` have no verb to set them and are not drop targets. `dragAction` returning a verb is also the drag-validity gate (`isValidDragTransition`).

In-place editing of a live card's title/body/priority is unavailable — the CLI `edit` verb only backfills a result on already-`done` tasks.

## Refresh model

The board stays current without a live event stream, using three refresh triggers instead.

A 6-second poll (`POLL_INTERVAL_MS`) runs while the tab is visible, a `focus` / `visibilitychange` listener refetches whenever the user returns to the app, and every mutation handler calls `loadAll(true)` so a UI action reflects immediately rather than waiting for the next tick.

## Detail drawer

Clicking a card opens a right-docked issue drawer (`kanban-detail-drawer`) fed by `kanbanGetTask` ([[src/main/kanban.ts#getTask]]).

It shows status, assignee, body, latest run summary, result, the read-only comment thread, and the recent event timeline. It is presentation-only; mutations stay on the card actions.

## Claw3D HQ virtual board

A read-only "HQ (Claw3D)" board appears in the switcher when SSH tunnel mode can read the remote task-store JSON ([[src/main/kanban.ts#listClaw3dHqTasks]]).

It is a renderer-only mirror — selecting it routes reads to the remote store, hides all mutation affordances, and never calls the backend board-switch RPC.
