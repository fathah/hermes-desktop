import { getConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import type {
  CreateTaskInput,
  KanbanBoard,
  KanbanResult,
  KanbanTask,
  KanbanTaskDetail,
} from "./kanban";

// Remote (HTTP) mode backing for the Kanban screen, over the dashboard's kanban
// plugin (/api/plugins/kanban/*). Local mode shells out to `hermes kanban`; the
// plugin exposes the same operations over REST.
//
// The board the desktop is looking at is kept here, per app run, and sent as
// ?board=. `POST /boards/{slug}/switch` is deliberately NOT used: it persists
// the server-wide "current board" that the CLI and slash commands read, which a
// desktop view switch must not change behind the user's back.

const BASE = "/api/plugins/kanban";

let selectedBoard: string | null = null;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function withQuery(
  path: string,
  query: Record<string, string | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function api<T>(
  method: Method,
  path: string,
  options: {
    body?: unknown;
    query?: Record<string, string | boolean | undefined>;
    profile?: string;
    board?: boolean;
  } = {},
): Promise<T> {
  const query = { ...(options.query ?? {}) };
  if (options.board !== false && selectedBoard) query.board = selectedBoard;
  return remoteDashboardRequestJson<T>(
    getConnectionConfig(),
    withQuery(`${BASE}${path}`, query),
    { method, body: options.body },
    options.profile,
  );
}

function failure<T>(err: unknown): KanbanResult<T> {
  const statusCode = (err as { statusCode?: number }).statusCode;
  if (statusCode === 404) {
    return {
      success: false,
      error:
        "The Kanban API was not found on this Hermes server (is the kanban dashboard plugin enabled?).",
    };
  }
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
  };
}

async function run<T>(fn: () => Promise<T>): Promise<KanbanResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return failure(err);
  }
}

async function runVoid(
  fn: () => Promise<unknown>,
): Promise<KanbanResult<void>> {
  try {
    await fn();
    return { success: true };
  } catch (err) {
    return failure(err);
  }
}

export function remoteListBoards(
  includeArchived: boolean,
  profile?: string,
): Promise<KanbanResult<KanbanBoard[]>> {
  return run(async () => {
    const res = await api<{ boards?: KanbanBoard[]; current?: string }>(
      "GET",
      "/boards",
      {
        query: { include_archived: includeArchived || undefined },
        profile,
        board: false,
      },
    );
    const current = selectedBoard || res.current;
    return (res.boards ?? []).map((b) => ({
      ...b,
      is_current: b.slug === current,
    }));
  });
}

export function remoteCurrentBoard(
  profile?: string,
): Promise<KanbanResult<string>> {
  return run(async () => {
    if (selectedBoard) return selectedBoard;
    const res = await api<{ current?: string }>("GET", "/boards", {
      profile,
      board: false,
    });
    return res.current ?? "";
  });
}

export function remoteSwitchBoard(
  slug: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return runVoid(async () => {
    // Validate against the server's list so a stale slug can't be selected.
    const res = await api<{ boards?: Array<{ slug: string }> }>(
      "GET",
      "/boards",
      { profile, board: false },
    );
    if (!(res.boards ?? []).some((b) => b.slug === slug)) {
      throw new Error(`Unknown board: ${slug}`);
    }
    selectedBoard = slug;
  });
}

export function remoteCreateBoard(
  slug: string,
  name: string | undefined,
  switchAfter: boolean,
  profile?: string,
): Promise<KanbanResult<void>> {
  return runVoid(async () => {
    await api("POST", "/boards", {
      body: { slug, name: name || undefined, switch: false },
      profile,
      board: false,
    });
    if (switchAfter) selectedBoard = slug;
  });
}

export function remoteRemoveBoard(
  slug: string,
  hardDelete: boolean,
  profile?: string,
): Promise<KanbanResult<void>> {
  return runVoid(async () => {
    await api("DELETE", `/boards/${encodeURIComponent(slug)}`, {
      query: { delete: hardDelete || undefined },
      profile,
      board: false,
    });
    if (selectedBoard === slug) selectedBoard = null;
  });
}

export function remoteListTasks(opts: {
  status?: string;
  assignee?: string;
  tenant?: string;
  includeArchived?: boolean;
  profile?: string;
}): Promise<KanbanResult<KanbanTask[]>> {
  return run(async () => {
    const res = await api<{
      columns?: Array<{ name: string; tasks?: KanbanTask[] }>;
    }>("GET", "/board", {
      query: {
        tenant: opts.tenant,
        include_archived: opts.includeArchived || undefined,
      },
      profile: opts.profile,
    });
    let tasks = (res.columns ?? []).flatMap((c) => c.tasks ?? []);
    if (opts.status) tasks = tasks.filter((t) => t.status === opts.status);
    if (opts.assignee)
      tasks = tasks.filter((t) => t.assignee === opts.assignee);
    return tasks;
  });
}

export function remoteGetTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<KanbanTaskDetail>> {
  return run(async () => {
    const res = await api<{
      task: KanbanTask & { latest_summary?: string | null };
      comments?: KanbanTaskDetail["comments"];
      events?: KanbanTaskDetail["events"];
      links?: { parents?: string[]; children?: string[] };
      runs?: KanbanTaskDetail["runs"];
    }>("GET", `/tasks/${encodeURIComponent(taskId)}`, { profile });
    return {
      task: res.task,
      comments: res.comments ?? [],
      events: res.events ?? [],
      parents: res.links?.parents ?? [],
      children: res.links?.children ?? [],
      runs: res.runs ?? [],
      latest_summary: res.task?.latest_summary ?? null,
    };
  });
}

function workspaceFields(workspace?: string): {
  workspace_kind?: string;
  workspace_path?: string;
} {
  if (!workspace) return {};
  if (workspace.startsWith("dir:")) {
    return { workspace_kind: "dir", workspace_path: workspace.slice(4) };
  }
  return { workspace_kind: workspace };
}

export function remoteCreateTask(
  input: CreateTaskInput,
  profile?: string,
): Promise<KanbanResult<{ id: string }>> {
  return run(async () => {
    const res = await api<{ task?: { id?: string } | null }>("POST", "/tasks", {
      body: {
        title: input.title,
        body: input.body,
        assignee: input.assignee,
        priority: input.priority ?? 0,
        tenant: input.tenant,
        triage: Boolean(input.triage),
        skills: input.skills?.length ? input.skills : undefined,
        ...workspaceFields(input.workspace),
      },
      profile,
    });
    return { id: res.task?.id ?? "" };
  });
}

function patchTask(
  taskId: string,
  body: Record<string, unknown>,
  profile?: string,
): Promise<KanbanResult<void>> {
  return runVoid(() =>
    api("PATCH", `/tasks/${encodeURIComponent(taskId)}`, { body, profile }),
  );
}

export const remoteAssignTask = (
  taskId: string,
  assignee: string | null,
  profile?: string,
) => patchTask(taskId, { assignee: assignee ?? "" }, profile);

export const remoteCompleteTask = (
  taskId: string,
  result?: string,
  profile?: string,
) =>
  patchTask(taskId, { status: "done", result: result || undefined }, profile);

export const remoteBlockTask = (
  taskId: string,
  reason?: string,
  profile?: string,
) =>
  patchTask(
    taskId,
    { status: "blocked", block_reason: reason || undefined },
    profile,
  );

// "ready" from blocked/scheduled re-opens via unblock; from todo it promotes.
// The server refuses (409, naming the open parents) when dependencies aren't
// done — the same guard `hermes kanban promote` applies, never forced.
export const remoteUnblockTask = (taskId: string, profile?: string) =>
  patchTask(taskId, { status: "ready" }, profile);
export const remotePromoteTask = remoteUnblockTask;

export const remoteArchiveTask = (taskId: string, profile?: string) =>
  patchTask(taskId, { status: "archived" }, profile);

export const remoteScheduleTask = (
  taskId: string,
  reason?: string,
  profile?: string,
) =>
  patchTask(
    taskId,
    { status: "scheduled", block_reason: reason || undefined },
    profile,
  );

export function remoteSpecifyTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return (async () => {
    try {
      const res = await api<{ ok?: boolean; reason?: string }>(
        "POST",
        `/tasks/${encodeURIComponent(taskId)}/specify`,
        { body: {}, profile },
      );
      // A refused specify is a normal outcome (not an HTTP error); surface why.
      return res.ok
        ? { success: true }
        : { success: false, error: res.reason || "Specify did not run." };
    } catch (err) {
      return failure<void>(err);
    }
  })();
}

export function remoteReclaimTask(
  taskId: string,
  reason?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return runVoid(() =>
    api("POST", `/tasks/${encodeURIComponent(taskId)}/reclaim`, {
      body: { reason: reason || undefined },
      profile,
    }),
  );
}

export function remoteCommentTask(
  taskId: string,
  body: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return runVoid(() =>
    api("POST", `/tasks/${encodeURIComponent(taskId)}/comments`, {
      body: { body },
      profile,
    }),
  );
}

export function remoteDispatchOnce(
  dryRun: boolean,
  profile?: string,
): Promise<KanbanResult<unknown>> {
  return run(() =>
    api("POST", "/dispatch", {
      query: { dry_run: dryRun || undefined },
      profile,
    }),
  );
}

/** Test seam: forget the locally selected board. */
export function resetRemoteKanbanState(): void {
  selectedBoard = null;
}
