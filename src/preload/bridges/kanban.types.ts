import type * as Api from "../api-types";

export interface KanbanBridgeApi {
  kanbanListBoards: (
    includeArchived?: boolean,
    profile?: string,
  ) => Promise<{
    success: boolean;
    data?: Api.KanbanBoard[];
    error?: string;
    unsupportedMode?: boolean;
  }>;

  kanbanCurrentBoard: (
    profile?: string,
  ) => Promise<{ success: boolean; data?: string; error?: string }>;

  kanbanSwitchBoard: (
    slug: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanCreateBoard: (
    slug: string,
    name?: string,
    switchAfter?: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanRemoveBoard: (
    slug: string,
    hardDelete?: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanListTasks: (filters?: {
    status?: string;
    assignee?: string;
    tenant?: string;
    includeArchived?: boolean;
    profile?: string;
  }) => Promise<{ success: boolean; data?: Api.KanbanTask[]; error?: string }>;

  kanbanGetTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    data?: Api.KanbanTaskDetail;
    error?: string;
  }>;

  kanbanCreateTask: (
    input: Api.KanbanCreateTaskInput,
    profile?: string,
  ) => Promise<{ success: boolean; data?: { id: string }; error?: string }>;

  selectFolder: () => Promise<string | null>;

  readDirectory: (
    dirPath: string,
  ) => Promise<{ name: string; isDirectory: boolean }[] | null>;

  readFile: (
    filePath: string,
    maxBytes?: number,
  ) => Promise<{ content: string; truncated: boolean } | null>;

  openFileInEditor: (filePath: string) => Promise<boolean>;

  readImageFile: (filePath: string) => Promise<string | null>;

  kanbanAssignTask: (
    taskId: string,
    assignee: string | null,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanCompleteTask: (
    taskId: string,
    result?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanBlockTask: (
    taskId: string,
    reason?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanUnblockTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanArchiveTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanSpecifyTask: (
    taskId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanReclaimTask: (
    taskId: string,
    reason?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanCommentTask: (
    taskId: string,
    body: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  kanbanDispatchOnce: (
    dryRun?: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;

  // Shell
}
