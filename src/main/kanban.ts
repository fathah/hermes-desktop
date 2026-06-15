import { execFile, ExecFileOptions } from "child_process";
import { join } from "path";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer";
import { isRemoteOnlyMode } from "./hermes";
import { getConnectionConfig } from "./config";
import { sshRunKanban } from "./ssh-remote";
import type {
  KanbanTask,
  KanbanBoard,
  KanbanRun,
  KanbanComment,
  KanbanEvent,
  KanbanTaskDetail,
  KanbanCreateTaskInput,
} from "../shared/kanban";

export type {
  KanbanTask,
  KanbanBoard,
  KanbanRun,
  KanbanComment,
  KanbanEvent,
  KanbanTaskDetail,
};

export interface KanbanResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stdout?: string;
  /**
   * Set only when the failure is the connection mode genuinely not
   * supporting Kanban (plain remote HTTP). The renderer keys its
   * "switch modes" screen off this flag — never off the error text —
   * so a real SSH-Kanban failure surfaces its actual error instead of
   * being mislabelled as a mode problem (issue #319).
   */
  unsupportedMode?: boolean;
}

const KANBAN_TIMEOUT_MS = 20000;

interface RunOpts {
  profile?: string;
  parseJson?: boolean;
  timeoutMs?: number;
}

async function runKanban(
  args: string[],
  opts: RunOpts = {},
): Promise<KanbanResult<unknown>> {
  // SSH tunnel mode: dispatch to the remote Hermes CLI over SSH.
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    return sshRunKanban(conn.ssh, args, {
      profile: opts.profile,
      parseJson: opts.parseJson,
      timeoutMs: opts.timeoutMs,
    });
  }

  const cliArgs = hermesCliArgs();
  if (opts.profile && opts.profile !== "default") {
    cliArgs.push("-p", opts.profile);
  }
  cliArgs.push("kanban", ...args);

  const execOpts: ExecFileOptions = {
    cwd: join(HERMES_HOME, "hermes-agent"),
    timeout: opts.timeoutMs ?? KANBAN_TIMEOUT_MS,
    env: { ...process.env, PATH: getEnhancedPath() },
    maxBuffer: 16 * 1024 * 1024,
  };

  return new Promise((resolve) => {
    execFile(HERMES_PYTHON, cliArgs, execOpts, (err, stdout, stderr) => {
      const out = (stdout || "").toString();
      if (err) {
        resolve({
          success: false,
          error: (stderr || err.message || "").toString().trim(),
          stdout: out,
        });
        return;
      }
      if (opts.parseJson) {
        try {
          resolve({ success: true, data: JSON.parse(out), stdout: out });
        } catch (parseErr) {
          resolve({
            success: false,
            error: `Failed to parse JSON from 'hermes kanban': ${(parseErr as Error).message}`,
            stdout: out,
          });
        }
        return;
      }
      resolve({ success: true, stdout: out });
    });
  });
}

export function unsupportedInRemote<T>(): KanbanResult<T> {
  return {
    success: false,
    unsupportedMode: true,
    error:
      "Kanban requires either a local Hermes install or SSH tunnel mode. " +
      "Plain remote (HTTP+API key) mode does not yet expose the kanban API. " +
      "Switch to SSH tunnel mode in Settings to use the board against a remote Hermes.",
  };
}

export async function listBoards(
  includeArchived = false,
  profile?: string,
): Promise<KanbanResult<KanbanBoard[]>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const args = ["boards", "list", "--json"];
  if (includeArchived) args.push("--all");
  const res = await runKanban(args, { profile, parseJson: true });
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data as KanbanBoard[] };
}

export async function currentBoard(
  profile?: string,
): Promise<KanbanResult<string>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const res = await runKanban(["boards", "show"], { profile });
  if (!res.success) return { success: false, error: res.error };
  const slug = (res.stdout || "").trim();
  return { success: true, data: slug };
}

export async function switchBoard(
  slug: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  if (!slug) return { success: false, error: "Missing board slug" };
  const res = await runKanban(["boards", "switch", slug], { profile });
  return { success: res.success, error: res.error };
}

export async function createBoard(
  slug: string,
  name?: string,
  switchAfter = false,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  if (!slug) return { success: false, error: "Missing board slug" };
  const args = ["boards", "create", slug];
  if (name) args.push("--name", name);
  if (switchAfter) args.push("--switch");
  const res = await runKanban(args, { profile });
  return { success: res.success, error: res.error };
}

export async function removeBoard(
  slug: string,
  hardDelete = false,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  if (!slug) return { success: false, error: "Missing board slug" };
  const args = ["boards", "rm", slug];
  if (hardDelete) args.push("--delete");
  const res = await runKanban(args, { profile });
  return { success: res.success, error: res.error };
}

export async function listTasks(
  opts: {
    status?: string;
    assignee?: string;
    tenant?: string;
    includeArchived?: boolean;
    profile?: string;
  } = {},
): Promise<KanbanResult<KanbanTask[]>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const args = ["list", "--json"];
  if (opts.status) args.push("--status", opts.status);
  if (opts.assignee) args.push("--assignee", opts.assignee);
  if (opts.tenant) args.push("--tenant", opts.tenant);
  if (opts.includeArchived) args.push("--archived");
  const res = await runKanban(args, { profile: opts.profile, parseJson: true });
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data as KanbanTask[] };
}

export async function getTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<KanbanTaskDetail>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  if (!taskId) return { success: false, error: "Missing task ID" };
  const res = await runKanban(["show", taskId, "--json"], {
    profile,
    parseJson: true,
  });
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data as KanbanTaskDetail };
}

export type CreateTaskInput = KanbanCreateTaskInput;

export async function createTask(
  input: CreateTaskInput,
  profile?: string,
): Promise<KanbanResult<{ id: string }>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  if (!input.title?.trim()) {
    return { success: false, error: "Title is required" };
  }
  const args = ["create", input.title];
  if (input.body) args.push("--body", input.body);
  if (input.assignee) args.push("--assignee", input.assignee);
  if (input.priority !== undefined)
    args.push("--priority", String(input.priority));
  if (input.tenant) args.push("--tenant", input.tenant);
  if (input.workspace) args.push("--workspace", input.workspace);
  if (input.triage) args.push("--triage");
  if (input.maxRetries !== undefined)
    args.push("--max-retries", String(input.maxRetries));
  if (input.goalMode) args.push("--goal");
  if (input.goalMaxTurns !== undefined)
    args.push("--goal-max-turns", String(input.goalMaxTurns));
  if (input.maxRuntimeSeconds !== undefined)
    args.push("--max-runtime", String(input.maxRuntimeSeconds));
  for (const skill of input.skills || []) {
    args.push("--skill", skill);
  }
  args.push("--json");

  const res = await runKanban(args, { profile, parseJson: true });
  if (!res.success) return { success: false, error: res.error };
  const data = res.data as { id?: string };
  return { success: true, data: { id: data?.id || "" } };
}

export async function assignTask(
  taskId: string,
  assignee: string | null,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const res = await runKanban(["assign", taskId, assignee || "none"], {
    profile,
  });
  return { success: res.success, error: res.error };
}

export async function completeTask(
  taskId: string,
  result?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const args = ["complete", taskId];
  if (result) args.push("--result", result);
  const res = await runKanban(args, { profile });
  return { success: res.success, error: res.error };
}

export async function blockTask(
  taskId: string,
  reason?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const args = ["block", taskId];
  if (reason) args.push(reason);
  const res = await runKanban(args, { profile });
  return { success: res.success, error: res.error };
}

export async function unblockTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const res = await runKanban(["unblock", taskId], { profile });
  return { success: res.success, error: res.error };
}

export async function archiveTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const res = await runKanban(["archive", taskId], { profile });
  return { success: res.success, error: res.error };
}

export async function specifyTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const res = await runKanban(["specify", taskId], { profile });
  return { success: res.success, error: res.error };
}

export async function reclaimTask(
  taskId: string,
  reason?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const args = ["reclaim", taskId];
  if (reason) args.push("--reason", reason);
  const res = await runKanban(args, { profile });
  return { success: res.success, error: res.error };
}

export async function commentTask(
  taskId: string,
  body: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  if (!body.trim()) return { success: false, error: "Empty comment" };
  const res = await runKanban(["comment", taskId, body], { profile });
  return { success: res.success, error: res.error };
}

export async function dispatchOnce(
  dryRun = false,
  profile?: string,
): Promise<KanbanResult<unknown>> {
  if (isRemoteOnlyMode()) return unsupportedInRemote();
  const args = ["dispatch", "--json"];
  if (dryRun) args.push("--dry-run");
  const res = await runKanban(args, { profile, parseJson: true });
  return { success: res.success, error: res.error, data: res.data };
}
