/**
 * IPC handlers for kanban CRUD — Phase-4 (PR-E2). Pass-through
 * to the backend's /api/kanban/* endpoints introduced in the
 * matching hermes-agent commits. Reuses the shared mutation
 * client.
 */

import { telemetryRequest, type MutationResult } from "./mutations";

export interface CreateBoardInput {
  slug: string;
  name?: string;
  description?: string;
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  board?: string;
  assignee?: string;
  priority?: number;
  skills?: string[];
  triage?: boolean;
}

export async function createBoard(
  input: CreateBoardInput,
): Promise<MutationResult> {
  return telemetryRequest("POST", "/api/kanban/boards", input);
}

export async function removeBoard(
  slug: string,
  hard = false,
): Promise<MutationResult> {
  const qs = hard ? "?hard=1" : "";
  return telemetryRequest(
    "DELETE",
    `/api/kanban/boards/${encodeURIComponent(slug)}${qs}`,
  );
}

export async function createTask(
  input: CreateTaskInput,
): Promise<MutationResult> {
  return telemetryRequest("POST", "/api/kanban/tasks", input);
}

export async function deleteTask(
  taskId: string,
  board?: string,
): Promise<MutationResult> {
  const qs = board ? `?board=${encodeURIComponent(board)}` : "";
  return telemetryRequest(
    "DELETE",
    `/api/kanban/tasks/${encodeURIComponent(taskId)}${qs}`,
  );
}

export async function completeTask(
  taskId: string,
  board?: string,
): Promise<MutationResult> {
  const qs = board ? `?board=${encodeURIComponent(board)}` : "";
  return telemetryRequest(
    "POST",
    `/api/kanban/tasks/${encodeURIComponent(taskId)}/complete${qs}`,
  );
}
