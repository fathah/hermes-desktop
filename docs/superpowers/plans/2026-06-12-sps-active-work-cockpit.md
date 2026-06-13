# SPS Active Work Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long-running SPS work visible as goals plus a task board: active goal, acceptance criteria, worker/task status, heartbeat, blocker reason, artifacts, and resume/stop controls.

**Architecture:** Keep Hermes/Kanban as the backend engine and add a thin SPS product layer around it. Reuse existing `sendMessage`, `spsGetWorkSession`, `kanbanListTasks`, and `kanbanGetTask`; add only a small profile-scoped sidecar for SPS-owned active runs and minimal missing IPC/preload surface. Do not rename `window.hermesAPI`, Hermes internals, storage paths, or upstream CLI concepts.

**Tech Stack:** Electron main/preload IPC, React 19, Zustand SPS store, TypeScript shared types, Vitest/jsdom, existing Hermes Kanban CLI wrapper.

---

## Product Decisions

- Employee-facing surface name: **Active Work**.
- Sidebar placement: under **My Assistant**, near **Learn This**.
- Existing **Cockpit** remains the home dashboard. Do not overload it.
- Existing `AgentTasksModal` should either be replaced by the Active Work surface or reduced to a compatibility wrapper that opens the new surface.
- Use employee copy: **My Assistant**, **work**, **task board**, **goal**, **blocked**, **resume**, **stop**. Avoid new user-facing “agent” language.
- Internal names remain unchanged: `window.hermesAPI`, `hermes-agent`, `sps-agent`, `kanban*` IPC names, and Hermes session ids.

## V1 Scope

Build one useful cockpit, not the whole upstream dashboard:

- Show SPS-owned active runs from a profile sidecar.
- Track `/work` plan runs automatically.
- Add an optional “Start goal” flow that starts a `/goal` run and records it as active work.
- Show Kanban board columns using existing tasks.
- On task selection, fetch full `KanbanTaskDetail` and show comments, events, runs, latest summary, parent/child ids, heartbeat timestamp, result, and blocker-like event payloads.
- Add resume and stop for SPS-owned runs.
- Add Kanban task create support for upstream goal-mode flags, but keep advanced run termination/log streaming out of v1 unless already available through the current CLI wrapper.

## Out Of Scope For V1

- No direct SQLite reads from `~/.hermes/kanban.db` in Electron.
- No new Hermes backend implementation.
- No deletion of Kanban task files/rows from SPS.
- No attempt to parse all upstream `/goal status` text into a perfect structured state.
- No mobile/WhatsApp/Telegram/Gmail attachment ingestion in this slice.
- No task attachment schema unless upstream already returns it in `kanban show --json`.

## File Structure

Create:

- `src/shared/active-work.ts`  
  Shared `ActiveWorkRun`, status enums, criteria/artifact types, and IPC input shapes.

- `src/main/active-work-runs.ts`  
  Profile-local JSON sidecar under `<profileHome>/sps-agent/active-work-runs.json`. Pure fs/path logic only, no Electron native modules.

- `tests/active-work-runs.test.ts`  
  Unit tests for empty store, create/update/list, criteria updates, finish/error, and defensive handling of corrupt files.

- `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.tsx`  
  New SPS surface with active run list, goal starter, Kanban board, and detail panel.

- `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx`  
  Renderer tests for surface render, run controls, task detail expansion, and goal draft behavior.

Modify:

- `src/shared/kanban.ts`  
  Add optional `goalMode`, `goalMaxTurns`, and `maxRuntimeSeconds` to `KanbanCreateTaskInput` only.

- `src/main/kanban.ts`  
  Pass new create-task flags to `hermes kanban create` when present. Keep existing behavior unchanged when omitted.

- `src/main/ipc/kanban.ts`  
  No new handlers required for v1 unless `kanbanGetTask` needs stricter profile forwarding. Verify `kanbanListTasks(filters || {})` still carries `filters.profile`.

- `src/main/ipc/sps.ts`  
  Register active-work sidecar handlers.

- `src/preload/bridges/sps.ts` and `src/preload/index.d.ts`  
  Expose active-work sidecar methods. Also allow `abortChat(sessionIdOrRunId?: string)` to pass an optional id through preload.

- `src/preload/bridges/config.ts`  
  Change `abortChat` bridge to forward the optional run/session id.

- `src/renderer/src/screens/SpsAgent/App.tsx`  
  Render `ActiveWorkSurface` when `surface === "activeWork"`.

- `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`  
  Add **Active Work** under **My Assistant**. Consider removing the old **Assistant tasks** modal nav item once the surface is live.

- `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`  
  Add `"activeWork"` to `Surface`.

- `src/renderer/src/screens/SpsAgent/store/slices/assistant.ts`  
  Wrap `runWork` with active-work sidecar create/update calls, store the `clientRunId`, record tool progress, session id, completion, and error.

- `src/renderer/src/screens/SpsAgent/modals/AgentTasksModal.tsx`  
  Either leave as-is for one release or reduce to a small redirect/compatibility component after `ActiveWorkSurface` renders the same board.

- `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`  
  Extend expectation for **Active Work** under **My Assistant**.

## Shared Types

Add this to `src/shared/active-work.ts`:

```ts
export type ActiveWorkStatus =
  | "running"
  | "paused"
  | "blocked"
  | "completed"
  | "stopped"
  | "failed";

export interface ActiveWorkCriterion {
  id: string;
  text: string;
  done: boolean;
}

export interface ActiveWorkArtifact {
  id: string;
  kind: "page" | "session" | "task" | "file" | "text";
  label: string;
  ref?: string;
  createdAt: number;
}

export interface ActiveWorkRun {
  id: string;
  source: "sps-work" | "goal" | "kanban";
  status: ActiveWorkStatus;
  title: string;
  goal: string;
  pageId?: string;
  pageTitle?: string;
  sessionId?: string;
  clientRunId?: string;
  taskId?: string;
  criteria: ActiveWorkCriterion[];
  artifacts: ActiveWorkArtifact[];
  lastTool?: string;
  lastHeartbeatAt?: number;
  blockerReason?: string;
  summary?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ActiveWorkCreateInput {
  source: ActiveWorkRun["source"];
  title: string;
  goal: string;
  pageId?: string;
  pageTitle?: string;
  sessionId?: string;
  clientRunId?: string;
  taskId?: string;
  criteria?: Array<{ text: string; done?: boolean }>;
}

export interface ActiveWorkPatch {
  status?: ActiveWorkStatus;
  sessionId?: string;
  clientRunId?: string;
  taskId?: string;
  criteria?: ActiveWorkCriterion[];
  artifacts?: ActiveWorkArtifact[];
  lastTool?: string | null;
  lastHeartbeatAt?: number;
  blockerReason?: string | null;
  summary?: string | null;
  error?: string | null;
  completedAt?: number;
}
```

Extend `src/shared/kanban.ts`:

```ts
export interface KanbanCreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  tenant?: string;
  workspace?: string;
  triage?: boolean;
  skills?: string[];
  maxRetries?: number;
  goalMode?: boolean;
  goalMaxTurns?: number;
  maxRuntimeSeconds?: number;
}
```

## Task 1: Active Work Sidecar Tests

**Files:**

- Create: `tests/active-work-runs.test.ts`
- Create later: `src/shared/active-work.ts`
- Create later: `src/main/active-work-runs.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/active-work-runs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listActiveWorkRuns,
  createActiveWorkRun,
  updateActiveWorkRun,
  getActiveWorkRun,
} from "../src/main/active-work-runs";

let home: string;
const PROFILE = "default";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sps-active-work-"));
  process.env.HERMES_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("active work runs sidecar", () => {
  it("returns [] when no sidecar exists", async () => {
    expect(await listActiveWorkRuns(PROFILE)).toEqual([]);
  });

  it("creates a running SPS work record with criteria", async () => {
    const run = await createActiveWorkRun(
      {
        source: "sps-work",
        title: "Work: launch plan",
        goal: "Execute the launch plan",
        pageId: "page-1",
        pageTitle: "Launch plan",
        clientRunId: "run-1",
        criteria: [
          { text: "Build it", done: false },
          { text: "Verify it", done: true },
        ],
      },
      PROFILE,
    );

    expect(run.status).toBe("running");
    expect(run.criteria).toHaveLength(2);
    expect(run.createdAt).toBeGreaterThan(0);
    expect(await listActiveWorkRuns(PROFILE)).toEqual([run]);
  });

  it("updates status, session id, tool, and completion fields", async () => {
    const run = await createActiveWorkRun(
      {
        source: "goal",
        title: "Goal: fix tests",
        goal: "Fix failing tests",
        clientRunId: "run-2",
      },
      PROFILE,
    );

    const updated = await updateActiveWorkRun(
      run.id,
      {
        sessionId: "sess-2",
        lastTool: "terminal",
        status: "completed",
        summary: "Tests pass",
        completedAt: 123,
      },
      PROFILE,
    );

    expect(updated?.sessionId).toBe("sess-2");
    expect(updated?.lastTool).toBe("terminal");
    expect(updated?.status).toBe("completed");
    expect(updated?.summary).toBe("Tests pass");
    expect(updated?.completedAt).toBe(123);
  });

  it("returns null when updating a missing run", async () => {
    expect(
      await updateActiveWorkRun("missing", { status: "stopped" }, PROFILE),
    ).toBeNull();
  });

  it("treats corrupt JSON as empty instead of crashing", async () => {
    const p = join(
      home,
      "profiles",
      PROFILE,
      "sps-agent",
      "active-work-runs.json",
    );
    writeFileSync(p, "{not json", "utf-8");
    expect(await listActiveWorkRuns(PROFILE)).toEqual([]);
  });

  it("gets a run by id", async () => {
    const run = await createActiveWorkRun(
      { source: "kanban", title: "Task", goal: "Do task", taskId: "t_123" },
      PROFILE,
    );
    expect(await getActiveWorkRun(run.id, PROFILE)).toEqual(run);
    expect(await getActiveWorkRun("nope", PROFILE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npx vitest run tests/active-work-runs.test.ts
```

Expected: FAIL because `src/main/active-work-runs.ts` does not exist.

## Task 2: Active Work Shared Types And Store

**Files:**

- Create: `src/shared/active-work.ts`
- Create: `src/main/active-work-runs.ts`
- Test: `tests/active-work-runs.test.ts`

- [ ] **Step 1: Add shared types**

Create `src/shared/active-work.ts` with the exact shared types from the **Shared Types** section.

- [ ] **Step 2: Implement the sidecar**

Create `src/main/active-work-runs.ts`:

```ts
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";
import type {
  ActiveWorkCreateInput,
  ActiveWorkCriterion,
  ActiveWorkPatch,
  ActiveWorkRun,
} from "../shared/active-work";

function activeWorkPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "active-work-runs.json",
  );
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCriteria(
  criteria: ActiveWorkCreateInput["criteria"] = [],
): ActiveWorkCriterion[] {
  return criteria.map((c) => ({
    id: id("crit"),
    text: c.text,
    done: Boolean(c.done),
  }));
}

async function readRuns(profile?: string): Promise<ActiveWorkRun[]> {
  try {
    const raw = await fs.readFile(activeWorkPath(profile), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActiveWorkRun[]) : [];
  } catch {
    return [];
  }
}

async function writeRuns(
  runs: ActiveWorkRun[],
  profile?: string,
): Promise<void> {
  const p = activeWorkPath(profile);
  await fs.mkdir(dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(runs, null, 2), "utf-8");
}

export async function listActiveWorkRuns(
  profile?: string,
): Promise<ActiveWorkRun[]> {
  const runs = await readRuns(profile);
  return runs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActiveWorkRun(
  runId: string,
  profile?: string,
): Promise<ActiveWorkRun | null> {
  const runs = await readRuns(profile);
  return runs.find((r) => r.id === runId) ?? null;
}

export async function createActiveWorkRun(
  input: ActiveWorkCreateInput,
  profile?: string,
): Promise<ActiveWorkRun> {
  const now = Date.now();
  const run: ActiveWorkRun = {
    id: id("work"),
    source: input.source,
    status: "running",
    title: input.title,
    goal: input.goal,
    pageId: input.pageId,
    pageTitle: input.pageTitle,
    sessionId: input.sessionId,
    clientRunId: input.clientRunId,
    taskId: input.taskId,
    criteria: normalizeCriteria(input.criteria),
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  const runs = await readRuns(profile);
  await writeRuns([run, ...runs], profile);
  return run;
}

export async function updateActiveWorkRun(
  runId: string,
  patch: ActiveWorkPatch,
  profile?: string,
): Promise<ActiveWorkRun | null> {
  const runs = await readRuns(profile);
  const idx = runs.findIndex((r) => r.id === runId);
  if (idx < 0) return null;
  const current = runs[idx];
  const next: ActiveWorkRun = {
    ...current,
    ...patch,
    lastTool:
      patch.lastTool === null
        ? undefined
        : (patch.lastTool ?? current.lastTool),
    blockerReason:
      patch.blockerReason === null
        ? undefined
        : (patch.blockerReason ?? current.blockerReason),
    summary:
      patch.summary === null ? undefined : (patch.summary ?? current.summary),
    error: patch.error === null ? undefined : (patch.error ?? current.error),
    updatedAt: Date.now(),
  };
  runs[idx] = next;
  await writeRuns(runs, profile);
  return next;
}
```

- [ ] **Step 3: Run sidecar tests**

Run:

```bash
npx vitest run tests/active-work-runs.test.ts
```

Expected: PASS.

## Task 3: Active Work IPC And Preload

**Files:**

- Modify: `src/main/ipc/sps.ts`
- Modify: `src/preload/bridges/sps.ts`
- Modify: `src/preload/bridges/config.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Register active-work IPC**

In `src/main/ipc/sps.ts`, import:

```ts
import {
  listActiveWorkRuns,
  getActiveWorkRun,
  createActiveWorkRun,
  updateActiveWorkRun,
} from "../active-work-runs";
import type {
  ActiveWorkCreateInput,
  ActiveWorkPatch,
} from "../../shared/active-work";
```

Inside the existing `registerSpsIpc()` function, add handlers near `spsGetWorkSession` / `spsSetWorkSession`:

```ts
safeHandle("sps-active-work-list", (_event, profile?: string) =>
  listActiveWorkRuns(profile),
);
safeHandle("sps-active-work-get", (_event, runId: string, profile?: string) =>
  getActiveWorkRun(runId, profile),
);
safeHandle(
  "sps-active-work-create",
  (_event, input: ActiveWorkCreateInput, profile?: string) =>
    createActiveWorkRun(input, profile),
);
safeHandle(
  "sps-active-work-update",
  (_event, runId: string, patch: ActiveWorkPatch, profile?: string) =>
    updateActiveWorkRun(runId, patch, profile),
);
```

- [ ] **Step 2: Expose active-work methods in preload**

In `src/preload/bridges/sps.ts`, add:

```ts
spsListActiveWorkRuns: (profile?: string) =>
  ipcRenderer.invoke("sps-active-work-list", profile),
spsGetActiveWorkRun: (runId: string, profile?: string) =>
  ipcRenderer.invoke("sps-active-work-get", runId, profile),
spsCreateActiveWorkRun: (input: ActiveWorkCreateInput, profile?: string) =>
  ipcRenderer.invoke("sps-active-work-create", input, profile),
spsUpdateActiveWorkRun: (
  runId: string,
  patch: ActiveWorkPatch,
  profile?: string,
) => ipcRenderer.invoke("sps-active-work-update", runId, patch, profile),
```

Add imports at the top:

```ts
import type {
  ActiveWorkCreateInput,
  ActiveWorkPatch,
} from "../../shared/active-work";
```

- [ ] **Step 3: Allow scoped abort from preload**

In `src/preload/bridges/config.ts`, change:

```ts
abortChat: (): Promise<void> => ipcRenderer.invoke("abort-chat"),
```

to:

```ts
abortChat: (sessionIdOrRunId?: string): Promise<void> =>
  ipcRenderer.invoke("abort-chat", sessionIdOrRunId),
```

- [ ] **Step 4: Update `index.d.ts`**

Import active-work types:

```ts
import type {
  ActiveWorkCreateInput,
  ActiveWorkPatch,
  ActiveWorkRun,
} from "../shared/active-work";
```

Change:

```ts
abortChat: () => Promise<void>;
```

to:

```ts
abortChat: (sessionIdOrRunId?: string) => Promise<void>;
```

Add:

```ts
spsListActiveWorkRuns: (profile?: string) => Promise<ActiveWorkRun[]>;
spsGetActiveWorkRun: (runId: string, profile?: string) =>
  Promise<ActiveWorkRun | null>;
spsCreateActiveWorkRun: (input: ActiveWorkCreateInput, profile?: string) =>
  Promise<ActiveWorkRun>;
spsUpdateActiveWorkRun: (
  runId: string,
  patch: ActiveWorkPatch,
  profile?: string,
) => Promise<ActiveWorkRun | null>;
```

- [ ] **Step 5: Validate preload parity and type surface**

Run:

```bash
npx vitest run tests/preload-api-surface.test.ts tests/active-work-runs.test.ts
npm run typecheck
```

Expected: PASS.

## Task 4: Kanban Goal-Mode Create Flags

**Files:**

- Modify: `src/shared/kanban.ts`
- Modify: `src/main/kanban.ts`
- Modify: `src/preload/bridges/kanban.ts`
- Modify: `src/preload/index.d.ts`
- Test if existing: `tests/skills-management.test.ts` is unrelated; add coverage only if a Kanban wrapper test exists. If none exists, rely on typecheck and changed-file ESLint for this narrow CLI arg append.

- [ ] **Step 1: Extend create input type**

Add these optional fields to every `KanbanCreateTaskInput` shape:

```ts
goalMode?: boolean;
goalMaxTurns?: number;
maxRuntimeSeconds?: number;
```

- [ ] **Step 2: Pass flags in `src/main/kanban.ts`**

Inside `createTask`, after `maxRetries` handling and before skills:

```ts
if (input.goalMode) args.push("--goal");
if (input.goalMaxTurns !== undefined)
  args.push("--goal-max-turns", String(input.goalMaxTurns));
if (input.maxRuntimeSeconds !== undefined)
  args.push("--max-runtime", String(input.maxRuntimeSeconds));
```

- [ ] **Step 3: Update preload inline input shape**

In `src/preload/bridges/kanban.ts`, add the same optional fields to the inline `input` type for `kanbanCreateTask`.

- [ ] **Step 4: Validate**

Run:

```bash
npm run typecheck
npx eslint --quiet src/shared/kanban.ts src/main/kanban.ts src/preload/bridges/kanban.ts src/preload/index.d.ts
```

Expected: PASS.

## Task 5: Add Active Work Surface Shell

**Files:**

- Create: `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`
- Modify: `src/renderer/src/screens/SpsAgent/App.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Add surface type**

In `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`, add `"activeWork"` to the existing `Surface` union.

- [ ] **Step 2: Create minimal surface**

Create `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { ActiveWorkRun } from "../../../../../shared/active-work";
import type {
  KanbanBoard,
  KanbanTask,
  KanbanTaskDetail,
} from "../../../../../shared/kanban";

const COLUMNS = ["triage", "todo", "ready", "running", "blocked", "done"];

function timeAgo(ms?: number | null): string {
  if (!ms) return "never";
  const age = Date.now() - ms;
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActiveWorkSurface() {
  const [runs, setRuns] = useState<ActiveWorkRun[]>([]);
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<KanbanTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const runWork = useStore((s) => s.runWork);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const [activeRuns, boardsRes, tasksRes] = await Promise.all([
        window.hermesAPI.spsListActiveWorkRuns(),
        window.hermesAPI.kanbanListBoards(false),
        window.hermesAPI.kanbanListTasks({ includeArchived: false }),
      ]);
      setRuns(activeRuns);
      setBoards(boardsRes.success ? boardsRes.data || [] : []);
      setTasks(tasksRes.success ? tasksRes.data || [] : []);
      setError(boardsRes.error || tasksRes.error || "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load active work.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      setTaskDetail(null);
      return;
    }
    let cancelled = false;
    window.hermesAPI.kanbanGetTask(selectedTask).then((res) => {
      if (!cancelled && res.success) setTaskDetail(res.data || null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTask]);

  const byColumn = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {};
    for (const col of COLUMNS) map[col] = [];
    for (const task of tasks) {
      (map[task.status] ??= []).push(task);
    }
    return map;
  }, [tasks]);

  const currentBoard = boards.find((b) => b.is_current) ?? boards[0] ?? null;

  async function stopRun(run: ActiveWorkRun): Promise<void> {
    await window.hermesAPI.abortChat(run.sessionId || run.clientRunId);
    await window.hermesAPI.spsUpdateActiveWorkRun(run.id, {
      status: "stopped",
      completedAt: Date.now(),
      lastTool: null,
    });
    await refresh();
  }

  async function resumeRun(run: ActiveWorkRun): Promise<void> {
    if (run.pageId) {
      selectPage(run.pageId);
      setSurface("doc");
      await runWork();
    }
  }

  return (
    <div className="surface active-work-surface">
      <div className="surface-head">
        <div>
          <h1>Active Work</h1>
          <p>Goals, running work, and My Assistant's task board.</p>
        </div>
        <button
          className="cover-btn"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </div>

      {error && (
        <div className="c-name" style={{ color: "var(--danger, #c00)" }}>
          {error}
        </div>
      )}

      <section className="active-work-section">
        <h2>Active Runs</h2>
        {runs.length === 0 ? (
          <div className="ck-empty">
            No active work yet. Run a plan with /work or start a goal.
          </div>
        ) : (
          <div className="active-work-run-list">
            {runs.map((run) => (
              <article
                key={run.id}
                className={`active-work-run is-${run.status}`}
              >
                <div className="active-work-run-main">
                  <strong>{run.title}</strong>
                  <span>{run.goal}</span>
                  <small>
                    {run.status} · updated {timeAgo(run.updatedAt)}
                    {run.lastTool ? ` · running ${run.lastTool}` : ""}
                  </small>
                </div>
                <div className="active-work-run-actions">
                  {run.pageId && (
                    <button
                      className="cover-btn"
                      onClick={() => void resumeRun(run)}
                    >
                      Resume
                    </button>
                  )}
                  {run.status === "running" && (
                    <button
                      className="cover-btn"
                      onClick={() => void stopRun(run)}
                    >
                      Stop
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="active-work-section">
        <h2>{currentBoard ? currentBoard.name : "Task Board"}</h2>
        <div className="active-work-board">
          {COLUMNS.map((col) => (
            <div key={col} className="active-work-column">
              <div className="active-work-column-title">
                {col} ({byColumn[col]?.length || 0})
              </div>
              {(byColumn[col] || []).map((task) => (
                <button
                  key={task.id}
                  className="lst-row"
                  onClick={() => setSelectedTask(task.id)}
                >
                  <strong>{task.title}</strong>
                  <small>
                    {task.assignee ? `@${task.assignee}` : "unassigned"}
                  </small>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {taskDetail && (
        <section className="active-work-section">
          <h2>{taskDetail.task.title}</h2>
          <p>{taskDetail.task.body}</p>
          <div className="active-work-meta">
            <span>Status: {taskDetail.task.status}</span>
            <span>Runs: {taskDetail.runs.length}</span>
            <span>
              Last heartbeat:{" "}
              {timeAgo(
                taskDetail.runs[0]?.last_heartbeat_at
                  ? taskDetail.runs[0].last_heartbeat_at * 1000
                  : null,
              )}
            </span>
          </div>
          {taskDetail.latest_summary && <p>{taskDetail.latest_summary}</p>}
          {taskDetail.comments.length > 0 && (
            <div>
              <h3>Comments</h3>
              {taskDetail.comments.map((c) => (
                <div key={c.id} className="lst-row">
                  <strong>{c.author || "worker"}</strong>
                  <span>{c.body}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

If `Icon` has no `"refresh"` icon, use the existing `"return"` or `"clock"` icon rather than adding a new icon in this task.

- [ ] **Step 3: Render the surface**

In `src/renderer/src/screens/SpsAgent/App.tsx`, import `ActiveWorkSurface` and add:

```tsx
{
  surface === "activeWork" && <ActiveWorkSurface />;
}
```

- [ ] **Step 4: Add sidebar nav**

In `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`, add under the **My Assistant** section:

```tsx
<button
  type="button"
  className={`nav-item ${surface === "activeWork" ? "active" : ""}`}
  onClick={() => setSurface("activeWork")}
  title="View goals, running work, and the task board"
  style={{ paddingLeft: 24 }}
>
  <Icon name="board" size={17} />
  <span className="nav-label">Active Work</span>
</button>
```

- [ ] **Step 5: Update sidebar test**

In `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`, assert:

```ts
expect(screen.getByText("Active Work")).toBeInTheDocument();
```

- [ ] **Step 6: Validate shell**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 6: Track SPS `/work` Runs

**Files:**

- Modify: `src/renderer/src/screens/SpsAgent/store/slices/assistant.ts`
- Test: add focused tests only if an assistant slice test already exists. If none exists, cover through `ActiveWorkSurface.test.tsx` with mocked APIs.

- [ ] **Step 1: Extract criteria from page todos**

Add helper near `serializePlanBlocks` usage in `assistant.ts`:

```ts
function activeCriteriaFromBlocks(
  blocks: Block[],
): Array<{ text: string; done: boolean }> {
  return blocks
    .filter((b) => b.type === "todo" && b.text.trim())
    .map((b) => ({ text: b.text.trim(), done: Boolean(b.done) }));
}
```

- [ ] **Step 2: Create active run at `/work` start**

Inside `runWork`, after `runId` and before `sendMessage`, create a sidecar record:

```ts
let activeWorkId: string | null = null;
try {
  const active = await window.hermesAPI.spsCreateActiveWorkRun({
    source: "sps-work",
    title: `Work: ${meta.title}`,
    goal: `Execute the plan "${meta.title}"`,
    pageId,
    pageTitle: meta.title,
    sessionId: resumeId,
    clientRunId: runId,
    criteria: activeCriteriaFromBlocks(blocks),
  });
  activeWorkId = active.id;
} catch {
  activeWorkId = null;
}
```

- [ ] **Step 3: Update last tool during tool progress**

Inside `onChatToolProgress` callback, after `tool = t;`:

```ts
if (activeWorkId) {
  void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
    lastTool: t,
    lastHeartbeatAt: Date.now(),
  });
}
```

- [ ] **Step 4: Record session id and completion**

After `if (result.sessionId)`, add:

```ts
if (activeWorkId) {
  void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
    sessionId: result.sessionId,
    status: "completed",
    summary: acc.slice(0, 500),
    completedAt: Date.now(),
    lastTool: null,
    artifacts: [
      {
        id: uid("artifact"),
        kind: "page",
        label: meta.title,
        ref: pageId,
        createdAt: Date.now(),
      },
      {
        id: uid("artifact"),
        kind: "session",
        label: "Assistant session",
        ref: result.sessionId,
        createdAt: Date.now(),
      },
    ],
  });
}
```

If there is no `result.sessionId`, still mark completed with the page artifact:

```ts
if (activeWorkId && !result.sessionId) {
  void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
    status: "completed",
    summary: acc.slice(0, 500),
    completedAt: Date.now(),
    lastTool: null,
  });
}
```

- [ ] **Step 5: Record failure**

Inside `catch`, after `render()`:

```ts
if (activeWorkId) {
  void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
    status: "failed",
    error: err instanceof Error ? err.message : "work failed",
    completedAt: Date.now(),
    lastTool: null,
  });
}
```

- [ ] **Step 6: Validate**

Run:

```bash
npm run typecheck
npx eslint --quiet src/renderer/src/screens/SpsAgent/store/slices/assistant.ts
```

Expected: PASS.

## Task 7: Start Goal Flow

**Files:**

- Modify: `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.tsx`
- Test: `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx`

- [ ] **Step 1: Add test for pending goal creation**

Create `ActiveWorkSurface.test.tsx` with mocks:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActiveWorkSurface } from "./ActiveWorkSurface";

beforeEach(() => {
  (globalThis as any).window = {
    hermesAPI: {
      spsListActiveWorkRuns: vi.fn().mockResolvedValue([]),
      spsCreateActiveWorkRun: vi.fn().mockResolvedValue({
        id: "work-1",
        source: "goal",
        status: "running",
        title: "Goal: Fix reports",
        goal: "Fix reports",
        criteria: [],
        artifacts: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      spsUpdateActiveWorkRun: vi.fn().mockResolvedValue(null),
      kanbanListBoards: vi.fn().mockResolvedValue({ success: true, data: [] }),
      kanbanListTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
      kanbanGetTask: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        response: "Done",
        sessionId: "sess-1",
      }),
      abortChat: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("ActiveWorkSurface", () => {
  it("starts a goal through /goal and records it as active work", async () => {
    render(<ActiveWorkSurface />);
    fireEvent.change(await screen.findByLabelText("Goal"), {
      target: { value: "Fix reports" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start goal" }));

    await waitFor(() => {
      expect(window.hermesAPI.sendMessage).toHaveBeenCalledWith(
        "/goal Fix reports",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        expect.stringMatching(/^goal-/),
      );
    });
    expect(window.hermesAPI.spsCreateActiveWorkRun).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "goal",
        goal: "Fix reports",
      }),
    );
  });
});
```

If existing test setup already defines `window.hermesAPI`, use that project pattern instead of overwriting `window`.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx
```

Expected: FAIL because the form is not implemented yet.

- [ ] **Step 3: Add form and send logic**

In `ActiveWorkSurface`, add state:

```tsx
const [goalText, setGoalText] = useState("");
const [startingGoal, setStartingGoal] = useState(false);
```

Add function:

```tsx
async function startGoal(): Promise<void> {
  const goal = goalText.trim();
  if (!goal) return;
  setStartingGoal(true);
  const clientRunId = `goal-${Date.now().toString(36)}`;
  let activeId: string | null = null;
  try {
    const active = await window.hermesAPI.spsCreateActiveWorkRun({
      source: "goal",
      title: `Goal: ${goal.length > 60 ? `${goal.slice(0, 60)}...` : goal}`,
      goal,
      clientRunId,
    });
    activeId = active.id;
    const result = await window.hermesAPI.sendMessage(
      `/goal ${goal}`,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      clientRunId,
    );
    await window.hermesAPI.spsUpdateActiveWorkRun(active.id, {
      status: "completed",
      sessionId: result.sessionId,
      summary: result.response?.slice(0, 500),
      completedAt: Date.now(),
    });
    setGoalText("");
    await refresh();
  } catch (err) {
    if (activeId) {
      await window.hermesAPI.spsUpdateActiveWorkRun(activeId, {
        status: "failed",
        error: err instanceof Error ? err.message : "Goal failed",
        completedAt: Date.now(),
      });
    }
  } finally {
    setStartingGoal(false);
  }
}
```

Add JSX above Active Runs:

```tsx
<section className="active-work-section">
  <h2>Start Goal</h2>
  <div className="active-work-goal-form">
    <label>
      <span>Goal</span>
      <textarea
        aria-label="Goal"
        value={goalText}
        onChange={(e) => setGoalText(e.target.value)}
        placeholder="Tell My Assistant what to keep working toward..."
      />
    </label>
    <button
      className="cover-btn"
      onClick={() => void startGoal()}
      disabled={!goalText.trim() || startingGoal}
    >
      Start goal
    </button>
  </div>
</section>
```

- [ ] **Step 4: Run renderer test**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx
```

Expected: PASS.

## Task 8: Rich Task Detail Panel

**Files:**

- Modify: `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.tsx`
- Test: `src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx`

- [ ] **Step 1: Add task detail test**

Append test:

```tsx
it("loads task detail with runs and comments when a task is selected", async () => {
  window.hermesAPI.kanbanListTasks = vi.fn().mockResolvedValue({
    success: true,
    data: [
      {
        id: "t_1",
        title: "Investigate import",
        body: "Find failure",
        assignee: "worker",
        status: "running",
        priority: 5,
        tenant: null,
        workspace_kind: "scratch",
        workspace_path: null,
        created_by: null,
        created_at: 1,
        started_at: 2,
        completed_at: null,
        result: null,
        skills: [],
        max_retries: null,
      },
    ],
  });
  window.hermesAPI.kanbanGetTask = vi.fn().mockResolvedValue({
    success: true,
    data: {
      task: {
        id: "t_1",
        title: "Investigate import",
        body: "Find failure",
        assignee: "worker",
        status: "running",
        priority: 5,
        tenant: null,
        workspace_kind: "scratch",
        workspace_path: null,
        created_by: null,
        created_at: 1,
        started_at: 2,
        completed_at: null,
        result: null,
        skills: [],
        max_retries: null,
      },
      comments: [
        {
          id: 1,
          task_id: "t_1",
          author: "me",
          body: "Use v2 schema",
          created_at: 3,
        },
      ],
      events: [],
      parents: [],
      children: [],
      runs: [
        {
          id: 7,
          task_id: "t_1",
          profile: "worker",
          status: "running",
          outcome: null,
          summary: null,
          error: null,
          started_at: 10,
          ended_at: null,
          last_heartbeat_at: 20,
        },
      ],
      latest_summary: "Still investigating",
    },
  });

  render(<ActiveWorkSurface />);
  fireEvent.click(await screen.findByText("Investigate import"));
  expect(await screen.findByText("Use v2 schema")).toBeInTheDocument();
  expect(screen.getByText("Still investigating")).toBeInTheDocument();
  expect(screen.getByText(/Runs: 1/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Improve detail rendering**

In the selected-task panel, render:

```tsx
{
  taskDetail.runs.length > 0 && (
    <div>
      <h3>Runs</h3>
      {taskDetail.runs.map((run) => (
        <div key={run.id} className="lst-row">
          <strong>{run.profile || "worker"}</strong>
          <span>{run.status || run.outcome || "unknown"}</span>
          <small>
            Last heartbeat{" "}
            {timeAgo(
              run.last_heartbeat_at ? run.last_heartbeat_at * 1000 : null,
            )}
          </small>
          {run.error && <span>{run.error}</span>}
          {run.summary && <span>{run.summary}</span>}
        </div>
      ))}
    </div>
  );
}
{
  taskDetail.events.length > 0 && (
    <div>
      <h3>Events</h3>
      {taskDetail.events.slice(0, 10).map((event) => (
        <div key={event.id} className="lst-row">
          <strong>{event.kind}</strong>
          <code>{JSON.stringify(event.payload || {})}</code>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run renderer tests**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx
```

Expected: PASS.

## Task 9: Replace Or De-emphasize Old Assistant Tasks Modal

**Files:**

- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/modals/AgentTasksModal.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/shell/Overlays.tsx` only if removing the modal state.
- Modify: `src/renderer/src/screens/SpsAgent/store/storeTypes.ts` and `src/renderer/src/screens/SpsAgent/store/slices/ui.ts` only if removing `agentTasksOpen`.

- [ ] **Step 1: Choose surgical option**

Preferred v1 option: keep `AgentTasksModal` in code but remove the sidebar nav item that opens it. This avoids deleting state and overlay plumbing in the same feature.

- [ ] **Step 2: Remove only the old sidebar button**

Delete this button from `Sidebar.tsx`:

```tsx
<button
  type="button"
  className="nav-item"
  onClick={() => setAgentTasksOpen(true)}
  style={{ paddingLeft: 24 }}
>
  <Icon name="board" size={17} />
  <span className="nav-label">Assistant tasks</span>
</button>
```

Do not delete `AgentTasksModal`, `agentTasksOpen`, or `setAgentTasksOpen` in v1 unless tests force cleanup.

- [ ] **Step 3: Validate**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 10: Styling

**Files:**

- Modify the smallest existing SPS stylesheet that already owns surface/card styles. Likely `src/renderer/src/screens/SpsAgent/styles/*.css`; inspect imports before editing.

- [ ] **Step 1: Locate active surface CSS patterns**

Run:

```bash
rg -n "ck-card|surface-head|lst-row|modal-body|db-head" src/renderer/src/screens/SpsAgent/styles src/renderer/src/assets/main.css
```

Expected: identify the stylesheet already used by Cockpit/Workspace surfaces.

- [ ] **Step 2: Add minimal classes**

Add only these classes, adapted to the located stylesheet:

```css
.active-work-surface {
  padding: 24px;
}

.active-work-section {
  margin-top: 18px;
}

.active-work-run-list {
  display: grid;
  gap: 8px;
}

.active-work-run {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg-1);
}

.active-work-run-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.active-work-run-main span,
.active-work-run-main small {
  color: var(--tx-3);
}

.active-work-run-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.active-work-board {
  display: grid;
  grid-template-columns: repeat(6, minmax(120px, 1fr));
  gap: 8px;
  overflow-x: auto;
}

.active-work-column {
  min-width: 120px;
}

.active-work-column-title {
  margin-bottom: 6px;
  color: var(--tx-3);
  font-size: 11px;
  text-transform: uppercase;
}

.active-work-goal-form {
  display: grid;
  gap: 8px;
}

.active-work-goal-form textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
}

.active-work-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--tx-3);
  font-size: 12px;
}
```

- [ ] **Step 3: Validate styling does not break typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 11: End-To-End Validation

**Files:** no new edits unless validation finds a real defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/active-work-runs.test.ts src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.test.tsx src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx tests/preload-api-surface.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run changed-file lint**

Run:

```bash
npx eslint --quiet src/shared/active-work.ts src/shared/kanban.ts src/main/active-work-runs.ts src/main/kanban.ts src/main/ipc/sps.ts src/preload/bridges/sps.ts src/preload/bridges/config.ts src/preload/bridges/kanban.ts src/preload/index.d.ts src/renderer/src/screens/SpsAgent/activeWork/ActiveWorkSurface.tsx src/renderer/src/screens/SpsAgent/store/slices/assistant.ts src/renderer/src/screens/SpsAgent/App.tsx src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx
```

Expected: PASS. If repo-wide lint fails on unrelated existing files, report it separately.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Smoke test**

Run after build:

```bash
node scripts/sps-smoke.mjs
```

Expected: PASS or a clear unrelated existing smoke failure. Verify manually that **Active Work** appears under **My Assistant** and can render with empty active work and an empty/unavailable Kanban board.

## Acceptance Criteria

- Sidebar shows **Active Work** under **My Assistant**.
- Active Work renders without a configured Kanban board.
- Active Work lists sidecar runs from `<profileHome>/sps-agent/active-work-runs.json`.
- Running `/work` creates an active work record with page id, goal text, criteria, client run id, and later session id.
- Tool progress updates `lastTool` and `lastHeartbeatAt`.
- Completed `/work` records summary, completion time, and page/session artifacts.
- Failed `/work` records status `failed` and an error.
- Stop on a running SPS-owned active run calls `abortChat(run.sessionId || run.clientRunId)` and marks the run stopped.
- Kanban board still loads through `kanbanListBoards` and `kanbanListTasks`.
- Selecting a Kanban task calls `kanbanGetTask` and shows comments, events, runs, latest summary, and heartbeat timestamp where present.
- `kanbanCreateTask` remains backward-compatible and supports optional goal-mode flags when supplied.
- No Hermes internal names, storage paths, package names, or IPC channel names are renamed.

## Self-Review

- Spec coverage: goal visibility is covered by Active Work records and Start Goal; task board by existing Kanban list/detail; heartbeat by `KanbanRun.last_heartbeat_at` and SPS `lastHeartbeatAt`; blocked state by Kanban status plus event payload display; artifacts by active-work artifacts; resume/stop by existing `runWork` and scoped `abortChat`.
- Placeholder scan: no implementation step depends on an undefined future backend. Known optional upstream surfaces such as run logs and terminate endpoints are explicitly out of scope for v1.
- Type consistency: `ActiveWorkRun`, `ActiveWorkCreateInput`, and `ActiveWorkPatch` names are used consistently across shared, main, preload, and renderer steps.
