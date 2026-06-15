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
