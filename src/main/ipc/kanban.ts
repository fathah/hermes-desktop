import { ipcMain } from "electron";
import {
  listBoards as kanbanListBoards,
  currentBoard as kanbanCurrentBoard,
  switchBoard as kanbanSwitchBoard,
  createBoard as kanbanCreateBoard,
  removeBoard as kanbanRemoveBoard,
  listTasks as kanbanListTasks,
  getTask as kanbanGetTask,
  createTask as kanbanCreateTask,
  assignTask as kanbanAssignTask,
  completeTask as kanbanCompleteTask,
  blockTask as kanbanBlockTask,
  unblockTask as kanbanUnblockTask,
  archiveTask as kanbanArchiveTask,
  specifyTask as kanbanSpecifyTask,
  reclaimTask as kanbanReclaimTask,
  commentTask as kanbanCommentTask,
  dispatchOnce as kanbanDispatchOnce,
  listClaw3dHqTasks as kanbanListClaw3dHqTasks,
  type CreateTaskInput,
} from "../kanban";

export function registerKanbanIpc(): void {
  ipcMain.handle(
    "kanban-list-boards",
    (_event, includeArchived?: boolean, profile?: string) =>
      kanbanListBoards(includeArchived, profile),
  );
  ipcMain.handle("kanban-current-board", (_event, profile?: string) =>
    kanbanCurrentBoard(profile),
  );
  ipcMain.handle(
    "kanban-switch-board",
    (_event, slug: string, profile?: string) =>
      kanbanSwitchBoard(slug, profile),
  );
  ipcMain.handle(
    "kanban-create-board",
    (
      _event,
      slug: string,
      name?: string,
      switchAfter?: boolean,
      profile?: string,
    ) => kanbanCreateBoard(slug, name, switchAfter, profile),
  );
  ipcMain.handle(
    "kanban-remove-board",
    (_event, slug: string, hardDelete?: boolean, profile?: string) =>
      kanbanRemoveBoard(slug, hardDelete, profile),
  );
  ipcMain.handle(
    "kanban-list-tasks",
    (
      _event,
      filters?: {
        status?: string;
        assignee?: string;
        tenant?: string;
        includeArchived?: boolean;
        profile?: string;
      },
    ) => kanbanListTasks(filters || {}),
  );
  ipcMain.handle(
    "kanban-get-task",
    (_event, taskId: string, profile?: string) =>
      kanbanGetTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-create-task",
    (_event, input: CreateTaskInput, profile?: string) =>
      kanbanCreateTask(input, profile),
  );
  ipcMain.handle(
    "kanban-assign-task",
    (_event, taskId: string, assignee: string | null, profile?: string) =>
      kanbanAssignTask(taskId, assignee, profile),
  );
  ipcMain.handle(
    "kanban-complete-task",
    (_event, taskId: string, result?: string, profile?: string) =>
      kanbanCompleteTask(taskId, result, profile),
  );
  ipcMain.handle(
    "kanban-block-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanBlockTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-unblock-task",
    (_event, taskId: string, profile?: string) =>
      kanbanUnblockTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-archive-task",
    (_event, taskId: string, profile?: string) =>
      kanbanArchiveTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-specify-task",
    (_event, taskId: string, profile?: string) =>
      kanbanSpecifyTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-reclaim-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanReclaimTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-comment-task",
    (_event, taskId: string, body: string, profile?: string) =>
      kanbanCommentTask(taskId, body, profile),
  );
  ipcMain.handle(
    "kanban-dispatch-once",
    (_event, dryRun?: boolean, profile?: string) =>
      kanbanDispatchOnce(dryRun, profile),
  );
  ipcMain.handle("kanban-list-claw3d-hq-tasks", () =>
    kanbanListClaw3dHqTasks(),
  );
}
