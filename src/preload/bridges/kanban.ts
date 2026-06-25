import { ipcRenderer } from "electron";
import type { KanbanBridgeApi } from "./kanban.types";

export const kanbanBridge = {
  // Kanban
  kanbanListBoards: (includeArchived?: boolean, profile?: string) =>
    ipcRenderer.invoke("kanban-list-boards", includeArchived, profile),
  kanbanCurrentBoard: (profile?: string) =>
    ipcRenderer.invoke("kanban-current-board", profile),
  kanbanSwitchBoard: (slug: string, profile?: string) =>
    ipcRenderer.invoke("kanban-switch-board", slug, profile),
  kanbanCreateBoard: (
    slug: string,
    name?: string,
    switchAfter?: boolean,
    profile?: string,
  ) =>
    ipcRenderer.invoke("kanban-create-board", slug, name, switchAfter, profile),
  kanbanRemoveBoard: (slug: string, hardDelete?: boolean, profile?: string) =>
    ipcRenderer.invoke("kanban-remove-board", slug, hardDelete, profile),
  kanbanListTasks: (filters?: {
    status?: string;
    assignee?: string;
    tenant?: string;
    includeArchived?: boolean;
    profile?: string;
  }) => ipcRenderer.invoke("kanban-list-tasks", filters),
  kanbanGetTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-get-task", taskId, profile),
  kanbanCreateTask: (
    input: {
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
    },
    profile?: string,
  ) => ipcRenderer.invoke("kanban-create-task", input, profile),
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("select-folder"),
  readDirectory: (
    dirPath: string,
  ): Promise<{ name: string; isDirectory: boolean }[] | null> =>
    ipcRenderer.invoke("read-directory", dirPath),
  readFile: (
    filePath: string,
    maxBytes?: number,
  ): Promise<{ content: string; truncated: boolean } | null> =>
    ipcRenderer.invoke("read-file", filePath, maxBytes),
  openFileInEditor: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("open-file-in-editor", filePath),
  readImageFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("read-image-file", filePath),
  kanbanAssignTask: (
    taskId: string,
    assignee: string | null,
    profile?: string,
  ) => ipcRenderer.invoke("kanban-assign-task", taskId, assignee, profile),
  kanbanCompleteTask: (taskId: string, result?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-complete-task", taskId, result, profile),
  kanbanBlockTask: (taskId: string, reason?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-block-task", taskId, reason, profile),
  kanbanUnblockTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-unblock-task", taskId, profile),
  kanbanArchiveTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-archive-task", taskId, profile),
  kanbanSpecifyTask: (taskId: string, profile?: string) =>
    ipcRenderer.invoke("kanban-specify-task", taskId, profile),
  kanbanReclaimTask: (taskId: string, reason?: string, profile?: string) =>
    ipcRenderer.invoke("kanban-reclaim-task", taskId, reason, profile),
  kanbanCommentTask: (taskId: string, body: string, profile?: string) =>
    ipcRenderer.invoke("kanban-comment-task", taskId, body, profile),
  kanbanDispatchOnce: (dryRun?: boolean, profile?: string) =>
    ipcRenderer.invoke("kanban-dispatch-once", dryRun, profile),
} satisfies KanbanBridgeApi;
