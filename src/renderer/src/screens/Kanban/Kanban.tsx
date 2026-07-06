import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Refresh,
  X,
  Zap,
  Trash,
  Alert,
  Check,
  Ban,
  RotateCcw,
  Sparkles,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

interface KanbanProps {
  profile?: string;
  visible?: boolean;
}

interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  tenant: string | null;
  workspace_kind: string;
  workspace_path: string | null;
  created_by: string | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills: string[];
  max_retries: number | null;
}

interface KanbanBoard {
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  is_current: boolean;
  archived?: boolean;
  total: number;
  counts: Record<string, number>;
  db_path?: string;
}

interface KanbanComment {
  id: number;
  task_id: string;
  author: string | null;
  body: string;
  created_at: number;
}

interface KanbanEvent {
  id: number;
  task_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
  run_id: number | null;
}

interface KanbanRun {
  id: number;
  task_id: string;
  profile: string | null;
  status: string | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  started_at: number | null;
  ended_at: number | null;
  last_heartbeat_at: number | null;
}

interface KanbanTaskDetail {
  task: KanbanTask;
  comments: KanbanComment[];
  events: KanbanEvent[];
  parents: string[];
  children: string[];
  runs: KanbanRun[];
  latest_summary: string | null;
}

// Column order + status "tone" (drives the JIRA-style colored header dot via
// `data-tone` in CSS). Mirrors the agent dashboard's BOARD_COLUMNS so a
// `scheduled`/`review` task lands in its own lane instead of mis-bucketing
// into To-do. Labels resolve at render via `kanban.status.<key>`.
const COLUMNS: { key: string; tone: string }[] = [
  { key: "triage", tone: "neutral" },
  { key: "todo", tone: "todo" },
  { key: "scheduled", tone: "scheduled" },
  { key: "ready", tone: "ready" },
  { key: "running", tone: "running" },
  { key: "blocked", tone: "blocked" },
  { key: "review", tone: "review" },
  { key: "done", tone: "done" },
];

// The archived column is appended only when the "show archived" toggle is on.
const ARCHIVED_COLUMN = { key: "archived", tone: "archived" };

// status key → tone, for surfaces (e.g. the detail drawer) that show a status
// outside the column loop. Unknown statuses fall back to "neutral".
const STATUS_TONE: Record<string, string> = Object.fromEntries(
  [...COLUMNS, ARCHIVED_COLUMN].map((c) => [c.key, c.tone]),
);

// The `hermes kanban` CLI verb a drag from one column to another maps to.
// Unlike the web dashboard — which writes the status column directly into
// kanban.db and can therefore move a card anywhere — the desktop shells the
// CLI, which only exposes lifecycle verbs. So a drag is allowed only when the
// target column corresponds to a verb. `todo`, `triage`, and `review` have no
// CLI verb to set them and thus cannot be drop targets here.
type DragAction =
  | "complete"
  | "block"
  | "unblock"
  | "reclaim"
  | "promote"
  | "schedule"
  | "archive";

function dragAction(from: string, to: string): DragAction | null {
  if (from === to) return null;
  if (from === "archived") return null; // archived is terminal (no un-archive verb)
  if (from === "done") return to === "archived" ? "archive" : null;
  switch (to) {
    case "done":
      return "complete";
    case "archived":
      return "archive";
    case "blocked":
      return ["todo", "ready", "running", "scheduled", "review"].includes(from)
        ? "block"
        : null;
    case "ready":
      if (from === "blocked" || from === "scheduled") return "unblock";
      if (from === "running") return "reclaim";
      if (from === "todo") return "promote";
      return null;
    case "scheduled":
      return ["todo", "ready", "blocked"].includes(from) ? "schedule" : null;
    default:
      // todo / triage / review — no CLI verb sets these.
      return null;
  }
}

function isValidDragTransition(from: string, to: string): boolean {
  return dragAction(from, to) !== null;
}

const POLL_INTERVAL_MS = 6000;

// Sentinel slug for the read-only Claw3D HQ virtual board. Distinct from any
// real hermes-agent kanban board slug (which is bash-safe alphanumeric per
// the backend CLI).
const HQ_BOARD_SLUG = "__claw3d_hq__";

// localStorage key for remembering which board the user last viewed across
// sessions. Stored value is either a real board slug or HQ_BOARD_SLUG.
const ACTIVE_BOARD_LS_KEY = "hermes:kanban:active-board";

function readStoredActiveBoard(): string | null {
  try {
    const v = window.localStorage.getItem(ACTIVE_BOARD_LS_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function priorityLabel(p: number): string {
  if (p >= 10) return "P0";
  if (p >= 5) return "P1";
  if (p > 0) return "P2";
  return "";
}

// Selectable priority chips for the create-task modal. `value` is the numeric
// priority the CLI takes; `tone` drives the colored bullet (matches the card
// priority accents — p0=urgent/red, p1=high/amber, p2=low/blue, ""=normal).
const PRIORITY_OPTIONS: { value: string; labelKey: string; tone: string }[] = [
  { value: "0", labelKey: "kanban.priorityNormal", tone: "" },
  { value: "1", labelKey: "kanban.priorityLow", tone: "p2" },
  { value: "5", labelKey: "kanban.priorityHigh", tone: "p1" },
  { value: "10", labelKey: "kanban.priorityUrgent", tone: "p0" },
];

// CSS tone key for the card's left priority accent. "" = no accent (normal).
function priorityTone(p: number): string {
  if (p >= 10) return "p0";
  if (p >= 5) return "p1";
  if (p > 0) return "p2";
  return "";
}

// 1–2 char avatar initials for an assignee profile name (JIRA-style chip).
function initials(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function ageLabel(createdAt: number | null): string {
  if (!createdAt) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - createdAt));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function Kanban({ profile, visible }: KanbanProps): React.JSX.Element {
  const { t } = useI18n();
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [remoteUnsupported, setRemoteUnsupported] = useState(false);
  const [profileOptions, setProfileOptions] = useState<string[]>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // When the Claw3D HQ virtual board is active we route reads to the
  // task-store JSON on the remote (via kanbanListClaw3dHqTasks) and hide all
  // mutation affordances. Initialized from localStorage so the user's last
  // selection survives reloads; null means "follow the real boards'
  // is_current" until autoDefaultRef below decides otherwise.
  const [activeBoardSlug, setActiveBoardSlug] = useState<string | null>(
    readStoredActiveBoard,
  );
  const isHqActive = activeBoardSlug === HQ_BOARD_SLUG;
  const [hqAvailable, setHqAvailable] = useState(false);
  // One-shot guard: only auto-default to HQ on the first loadAll. After
  // that, respect the user's explicit choice (including switching back to
  // Default), and never re-jump them to HQ on subsequent refreshes.
  const autoDefaultedRef = useRef(false);

  // Create task form
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newPriority, setNewPriority] = useState("0");
  const [newWorkspace, setNewWorkspace] = useState("scratch");
  const [newWorkspaceDir, setNewWorkspaceDir] = useState("");
  const [newTriage, setNewTriage] = useState(false);

  // New board form
  const [newBoardSlug, setNewBoardSlug] = useState("");
  const [newBoardName, setNewBoardName] = useState("");

  const currentBoard = useMemo(
    () => boards.find((b) => b.is_current) ?? null,
    [boards],
  );

  const loadAll = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      try {
        // Always refresh the real boards list, plus either the active real
        // board's tasks OR the Claw3D HQ tasks depending on which is selected.
        const wantHq = activeBoardSlug === HQ_BOARD_SLUG;
        type TasksRes = {
          success: boolean;
          data?: KanbanTask[];
          error?: string;
        };
        const [boardsRes, tasksRes, hqRes] = await Promise.all([
          window.hermesAPI.kanbanListBoards(false, profile),
          wantHq
            ? Promise.resolve<TasksRes>({ success: true, data: [] })
            : window.hermesAPI.kanbanListTasks({
                includeArchived: showArchived,
                profile,
              }),
          window.hermesAPI.kanbanListClaw3dHqTasks(),
        ]);
        if (!boardsRes.success) {
          // Only the genuine unsupported-mode result (plain remote HTTP)
          // flips the "switch modes" screen. A real SSH-Kanban failure
          // must surface its actual error rather than be mislabelled as a
          // mode problem — its message can contain the word "remote"
          // without the mode being unsupported (issue #319).
          if (boardsRes.unsupportedMode) {
            setRemoteUnsupported(true);
            return;
          }
          setError(boardsRes.error || t("kanban.errLoadBoards"));
          return;
        }
        // HQ availability: we treat the board as available whenever the SSH
        // reader succeeds (even with zero tasks — that's a valid empty board).
        // Failure (not in SSH mode, file unreadable) → hide the chip entirely.
        const hqOk = hqRes.success;
        const hqTasks = hqOk ? hqRes.data || [] : [];
        setHqAvailable(hqOk);
        setRemoteUnsupported(false);
        setBoards(boardsRes.data || []);

        // One-shot auto-default to HQ: if this is the first load AND the
        // user has no stored preference AND HQ is available, jump straight
        // to HQ. `hqOk` already implies SSH tunnel mode (the SSH reader
        // only succeeds when conn.mode === "ssh"), so this also satisfies
        // "if I'm running tunnel mode, use tunnel not default". After this
        // one-shot fires, respect the user's explicit choice — never
        // re-jump them on subsequent refreshes.
        if (!autoDefaultedRef.current && activeBoardSlug === null && hqOk) {
          autoDefaultedRef.current = true;
          setActiveBoardSlug(HQ_BOARD_SLUG);
          setTasks(hqTasks);
          setError("");
          return;
        }
        autoDefaultedRef.current = true;

        if (wantHq) {
          setTasks(hqTasks);
        } else {
          if (!tasksRes.success) {
            setError(tasksRes.error || t("kanban.errLoadTasks"));
            return;
          }
          setTasks(tasksRes.data || []);
        }
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [profile, activeBoardSlug, showArchived, t],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Refresh when the user returns to the app/tab. The gateway dispatcher
  // mutates kanban.db out-of-band, so a board left open in the background
  // can be stale; a focus/visibility refetch catches up immediately without
  // waiting for the next 6s poll tick.
  useEffect(() => {
    if (visible === false) return;
    const refresh = (): void => {
      if (document.visibilityState === "visible") loadAll(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadAll, visible]);

  // Persist the user's board choice across reloads. Skip the initial null
  // state (= "not yet decided") so we don't overwrite a previously-stored
  // value before auto-default fires.
  useEffect(() => {
    if (activeBoardSlug === null) return;
    try {
      window.localStorage.setItem(ACTIVE_BOARD_LS_KEY, activeBoardSlug);
    } catch {
      // localStorage unavailable (private mode, quota) — fall back to
      // session-only memory of the selection.
    }
  }, [activeBoardSlug]);

  useEffect(() => {
    if (!showCreate) return;
    window.hermesAPI.listProfiles().then((profiles) => {
      setProfileOptions(profiles.map((p) => p.name));
    });
  }, [showCreate]);

  // Light polling while the tab is visible — the gateway dispatcher writes
  // to kanban.db out-of-band, so we need to refresh to surface state moves
  // (e.g. ready → running once a worker claims a task).
  useEffect(() => {
    if (visible === false) return;
    const id = setInterval(() => loadAll(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadAll, visible]);

  useEffect(() => {
    if (!detailTaskId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    window.hermesAPI.kanbanGetTask(detailTaskId, profile).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setDetail(res.data);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [detailTaskId, profile]);

  // Visible columns: the canonical 8, plus a trailing archived lane when the
  // toggle is on (backend only returns archived rows when includeArchived).
  const renderedColumns = useMemo(
    () => (showArchived ? [...COLUMNS, ARCHIVED_COLUMN] : COLUMNS),
    [showArchived],
  );

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, KanbanTask[]> = {};
    for (const col of renderedColumns) grouped[col.key] = [];
    for (const task of tasks) {
      const col = renderedColumns.some((c) => c.key === task.status)
        ? task.status
        : "todo";
      grouped[col] = grouped[col] || [];
      grouped[col].push(task);
    }
    // Stable ordering: priority DESC, created_at ASC (matches backend)
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (a.created_at || 0) - (b.created_at || 0);
      });
    }
    return grouped;
  }, [tasks, renderedColumns]);

  function resetCreateForm(): void {
    setNewTitle("");
    setNewBody("");
    setNewAssignee("");
    setNewPriority("0");
    setNewWorkspace("scratch");
    setNewWorkspaceDir("");
    setNewTriage(false);
  }

  async function handlePickWorkspaceFolder(): Promise<void> {
    const dir = await window.hermesAPI.selectFolder();
    if (dir) setNewWorkspaceDir(dir);
  }

  async function handleCreate(): Promise<void> {
    if (!newTitle.trim()) return;
    let workspaceArg: string | undefined;
    if (newWorkspace === "dir") {
      if (!newWorkspaceDir) {
        setError(t("kanban.errPickFolder"));
        return;
      }
      workspaceArg = `dir:${newWorkspaceDir}`;
    } else {
      workspaceArg = newWorkspace || undefined;
    }
    setActionBusy("create");
    const res = await window.hermesAPI.kanbanCreateTask(
      {
        title: newTitle.trim(),
        body: newBody.trim() || undefined,
        assignee: newAssignee.trim() || undefined,
        priority: parseInt(newPriority, 10) || 0,
        workspace: workspaceArg,
        triage: newTriage || undefined,
      },
      profile,
    );
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errCreateTask"));
      return;
    }
    setShowCreate(false);
    resetCreateForm();
    loadAll(true);
  }

  async function handleBoardSwitch(slug: string): Promise<void> {
    // HQ is a virtual, renderer-only view; don't call the backend switch RPC.
    if (slug === HQ_BOARD_SLUG) {
      if (isHqActive) return;
      setActiveBoardSlug(HQ_BOARD_SLUG);
      setDetailTaskId(null);
      return;
    }
    if (currentBoard?.slug === slug && !isHqActive) return;
    setActionBusy("board-switch");
    const res = await window.hermesAPI.kanbanSwitchBoard(slug, profile);
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errSwitchBoard"));
      return;
    }
    setActiveBoardSlug(slug);
    loadAll();
  }

  async function handleCreateBoard(): Promise<void> {
    if (!newBoardSlug.trim()) return;
    setActionBusy("board-create");
    const res = await window.hermesAPI.kanbanCreateBoard(
      newBoardSlug.trim(),
      newBoardName.trim() || undefined,
      true,
      profile,
    );
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errCreateBoard"));
      return;
    }
    setShowNewBoard(false);
    setNewBoardSlug("");
    setNewBoardName("");
    loadAll();
  }

  async function handleMove(task: KanbanTask, target: string): Promise<void> {
    const action = dragAction(task.status, target);
    if (!action) {
      setError(
        t("kanban.moveNotAllowed", {
          from: t(`kanban.status.${task.status}`),
          to: t(`kanban.status.${target}`),
        }),
      );
      return;
    }
    setActionBusy(task.id);
    let res: { success: boolean; error?: string };
    switch (action) {
      case "complete":
        res = await window.hermesAPI.kanbanCompleteTask(
          task.id,
          undefined,
          profile,
        );
        break;
      case "archive":
        res = await window.hermesAPI.kanbanArchiveTask(task.id, profile);
        break;
      case "block": {
        const reason = window.prompt(t("kanban.blockReasonPrompt")) || "";
        res = await window.hermesAPI.kanbanBlockTask(
          task.id,
          reason || undefined,
          profile,
        );
        break;
      }
      case "unblock":
        res = await window.hermesAPI.kanbanUnblockTask(task.id, profile);
        break;
      case "reclaim":
        res = await window.hermesAPI.kanbanReclaimTask(
          task.id,
          "reclaimed from desktop",
          profile,
        );
        break;
      case "promote":
        res = await window.hermesAPI.kanbanPromoteTask(task.id, profile);
        break;
      case "schedule":
        res = await window.hermesAPI.kanbanScheduleTask(
          task.id,
          undefined,
          profile,
        );
        break;
    }
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errMoveTask"));
      return;
    }
    loadAll(true);
  }

  async function handleSpecify(task: KanbanTask): Promise<void> {
    setActionBusy(task.id);
    const res = await window.hermesAPI.kanbanSpecifyTask(task.id, profile);
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errSpecify"));
      return;
    }
    loadAll(true);
  }

  async function handleDrop(task: KanbanTask, target: string): Promise<void> {
    if (!isValidDragTransition(task.status, target)) return;
    if (target === "done") {
      if (!window.confirm(t("kanban.confirmMarkDone", { title: task.title })))
        return;
    } else if (target === "archived") {
      if (!window.confirm(t("kanban.confirmArchive", { title: task.title })))
        return;
    }
    await handleMove(task, target);
  }

  async function handleArchive(task: KanbanTask): Promise<void> {
    if (!window.confirm(t("kanban.confirmArchive", { title: task.title })))
      return;
    setActionBusy(task.id);
    const res = await window.hermesAPI.kanbanArchiveTask(task.id, profile);
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errArchive"));
      return;
    }
    if (detailTaskId === task.id) setDetailTaskId(null);
    loadAll(true);
  }

  async function handleReclaim(task: KanbanTask): Promise<void> {
    setActionBusy(task.id);
    const res = await window.hermesAPI.kanbanReclaimTask(
      task.id,
      "reclaimed from desktop",
      profile,
    );
    setActionBusy(null);
    if (!res.success) setError(res.error || t("kanban.errReclaim"));
    else loadAll(true);
  }

  async function handleDispatch(): Promise<void> {
    setActionBusy("dispatch");
    const res = await window.hermesAPI.kanbanDispatchOnce(false, profile);
    setActionBusy(null);
    if (!res.success) {
      setError(res.error || t("kanban.errDispatch"));
      return;
    }
    loadAll(true);
  }

  if (remoteUnsupported) {
    return (
      <div className="kanban-container">
        <div className="kanban-empty">
          <p className="schedules-empty-text">
            {t("kanban.remoteUnsupportedTitle")}
          </p>
          <p className="schedules-empty-hint">
            {t("kanban.remoteUnsupportedHint")}
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="kanban-container">
        <div className="schedules-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="kanban-container">
      <div className="kanban-header">
        <div>
          <h2 className="schedules-title">{t("kanban.title")}</h2>
        </div>
        <div className="schedules-header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => loadAll()}
            disabled={actionBusy !== null}
            data-tooltip={t("kanban.refreshTooltip")}
          >
            <Refresh size={14} />
            {t("kanban.refresh")}
          </button>
          {!isHqActive && (
            <>
              <button
                className={`btn btn-secondary${
                  showArchived ? " kanban-toggle-active" : ""
                }`}
                onClick={() => setShowArchived((v) => !v)}
                disabled={actionBusy !== null}
                data-tooltip={t("kanban.archivedTooltip")}
              >
                {showArchived
                  ? t("kanban.hideArchived")
                  : t("kanban.showArchived")}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleDispatch}
                disabled={actionBusy !== null}
                data-tooltip={t("kanban.dispatchTooltip")}
              >
                <Zap size={14} />
                {t("kanban.dispatch")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setShowCreate(true)}
                data-tooltip={t("kanban.newTaskTooltip")}
              >
                <Plus size={14} />
                {t("kanban.newTask")}
              </button>
            </>
          )}
        </div>
      </div>

      {(boards.length > 0 || hqAvailable) && (
        <div className="kanban-boards-bar">
          {boards.map((b) => {
            const active = isHqActive ? false : b.is_current;
            return (
              <button
                key={b.slug}
                className={`kanban-board-chip${
                  active ? " kanban-board-chip-active" : ""
                }`}
                onClick={() => handleBoardSwitch(b.slug)}
                disabled={actionBusy === "board-switch"}
                title={b.description || b.slug}
              >
                {active && <span className="kanban-board-dot" />}
                <span>{b.name || b.slug}</span>
                <span className="kanban-board-count">{b.total}</span>
              </button>
            );
          })}
          {hqAvailable && (
            <button
              key={HQ_BOARD_SLUG}
              className={`kanban-board-chip${
                isHqActive ? " kanban-board-chip-active" : ""
              }`}
              onClick={() => handleBoardSwitch(HQ_BOARD_SLUG)}
              disabled={actionBusy === "board-switch"}
              title={t("kanban.hqBoardTooltip")}
            >
              {isHqActive && <span className="kanban-board-dot" />}
              <span>HQ (Claw3D)</span>
              <span className="kanban-board-count">
                {isHqActive ? tasks.length : ""}
              </span>
            </button>
          )}
          {!isHqActive && (
            <button
              className="kanban-board-chip kanban-board-chip-add"
              onClick={() => setShowNewBoard(true)}
              data-tooltip={t("kanban.newBoardTooltip")}
            >
              <Plus size={12} />
              {t("kanban.newBoard")}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="skills-error">
          {error}
          <button
            className="btn-ghost"
            title={t("kanban.dismissError")}
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {isHqActive && (
        <div className="kanban-hq-banner">
          Read-only mirror of Claw3D&apos;s headquarters board. Edits made here
          would not sync — use the Office screen to manage HQ tasks.
        </div>
      )}

      <div className="kanban-columns">
        {renderedColumns.map((col) => {
          const colTasks = tasksByStatus[col.key] || [];
          const draggingTask = draggingTaskId
            ? tasks.find((t) => t.id === draggingTaskId)
            : null;
          const canDropHere =
            !!draggingTask &&
            isValidDragTransition(draggingTask.status, col.key);
          return (
            <div
              key={col.key}
              data-tone={col.tone}
              className={`kanban-column${
                dragOverCol === col.key && canDropHere && !isHqActive
                  ? " kanban-column-drop"
                  : ""
              }`}
              onDragOver={(e) => {
                if (isHqActive || !canDropHere) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverCol !== col.key) setDragOverCol(col.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverCol === col.key) setDragOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCol(null);
                if (isHqActive || !draggingTask) return;
                handleDrop(draggingTask, col.key);
              }}
            >
              <div className="kanban-column-header">
                <span className="kanban-column-dot" data-tone={col.tone} />
                <span className="kanban-column-title">
                  {t(`kanban.status.${col.key}`)}
                </span>
                <span className="kanban-column-count">{colTasks.length}</span>
              </div>
              <div className="kanban-column-body">
                {colTasks.length === 0 && (
                  <div className="kanban-column-empty">—</div>
                )}
                {colTasks.map((task) => {
                  const prio = priorityLabel(task.priority);
                  const age = ageLabel(task.created_at);
                  const skillCount = task.skills?.length || 0;
                  return (
                    <div
                      key={task.id}
                      data-prio={priorityTone(task.priority) || undefined}
                      className={`kanban-card${
                        draggingTaskId === task.id
                          ? " kanban-card-dragging"
                          : ""
                      }${isHqActive ? " kanban-card-readonly" : ""}`}
                      draggable={!isHqActive}
                      onDragStart={(e) => {
                        if (isHqActive) return;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", task.id);
                        setDraggingTaskId(task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingTaskId(null);
                        setDragOverCol(null);
                      }}
                      onClick={() => {
                        if (isHqActive) return;
                        setDetailTaskId(task.id);
                      }}
                    >
                      <div className="kanban-card-top">
                        <span className="kanban-card-id">{task.id}</span>
                        {task.status === "running" && (
                          <span
                            className="kanban-live-dot"
                            title={t("kanban.status.running")}
                          />
                        )}
                        {prio && (
                          <span
                            className="kanban-pill kanban-pill-prio"
                            data-prio={priorityTone(task.priority)}
                          >
                            {prio}
                          </span>
                        )}
                        {age && <span className="kanban-card-age">{age}</span>}
                      </div>
                      <div className="kanban-card-title">{task.title}</div>
                      <div className="kanban-card-meta">
                        {task.assignee ? (
                          <span
                            className="kanban-assignee"
                            title={`@${task.assignee}`}
                          >
                            <span className="kanban-avatar">
                              {initials(task.assignee)}
                            </span>
                            <span className="kanban-assignee-name">
                              {task.assignee}
                            </span>
                          </span>
                        ) : (
                          <span className="kanban-assignee kanban-assignee-none">
                            <span className="kanban-avatar kanban-avatar-none">
                              ?
                            </span>
                          </span>
                        )}
                        {task.tenant && (
                          <span className="kanban-pill">{task.tenant}</span>
                        )}
                        {skillCount > 0 && (
                          <span
                            className="kanban-pill kanban-pill-skills"
                            title={task.skills.join(", ")}
                          >
                            {skillCount} {skillCount === 1 ? "skill" : "skills"}
                          </span>
                        )}
                      </div>
                      <div className="kanban-card-actions">
                        {isHqActive && (
                          <span className="kanban-pill kanban-pill-readonly">
                            read-only
                          </span>
                        )}
                        {!isHqActive && task.status === "triage" && (
                          <button
                            className="btn-ghost kanban-card-action"
                            data-tooltip={t("kanban.cardSpecify")}
                            title={t("kanban.cardSpecify")}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSpecify(task);
                            }}
                            disabled={actionBusy === task.id}
                          >
                            <Sparkles size={14} />
                          </button>
                        )}
                        {!isHqActive && task.status === "ready" && (
                          <button
                            className="btn-ghost kanban-card-action"
                            data-tooltip={t("kanban.cardMarkDone")}
                            title={t("kanban.cardMarkDone")}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMove(task, "done");
                            }}
                            disabled={actionBusy === task.id}
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {!isHqActive && task.status === "running" && (
                          <button
                            className="btn-ghost kanban-card-action"
                            data-tooltip={t("kanban.cardReclaim")}
                            title={t("kanban.cardReclaim")}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReclaim(task);
                            }}
                            disabled={actionBusy === task.id}
                          >
                            <Alert size={14} />
                          </button>
                        )}
                        {!isHqActive && task.status === "blocked" && (
                          <button
                            className="btn-ghost kanban-card-action"
                            data-tooltip={t("kanban.cardUnblock")}
                            title={t("kanban.cardUnblock")}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMove(task, "ready");
                            }}
                            disabled={actionBusy === task.id}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {!isHqActive &&
                          (task.status === "todo" ||
                            task.status === "ready") && (
                            <button
                              className="btn-ghost kanban-card-action"
                              data-tooltip={t("kanban.cardBlock")}
                              title={t("kanban.cardBlock")}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMove(task, "blocked");
                              }}
                              disabled={actionBusy === task.id}
                            >
                              <Ban size={14} />
                            </button>
                          )}
                        {!isHqActive && (
                          <button
                            className="btn-ghost kanban-card-action kanban-card-action-danger"
                            data-tooltip={t("kanban.cardArchive")}
                            title={t("kanban.cardArchive")}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchive(task);
                            }}
                            disabled={actionBusy === task.id}
                          >
                            <Trash size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <div
          className="skills-detail-overlay"
          onClick={() => setShowCreate(false)}
        >
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <span>{t("kanban.createTitle")}</span>
              <button
                className="btn-ghost"
                onClick={() => setShowCreate(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldTitle")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t("kanban.titlePlaceholder")}
                  autoFocus
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldBody")}
                </label>
                <textarea
                  className="input schedules-textarea"
                  rows={4}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder={t("kanban.bodyPlaceholder")}
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldAssignee")}
                </label>
                <select
                  className="input"
                  aria-label="Assignee profile"
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                >
                  <option value="">{t("kanban.assigneeNone")}</option>
                  {profileOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldPriority")}
                </label>
                <div
                  className="kanban-prio-chips"
                  role="radiogroup"
                  aria-label={t("kanban.fieldPriority")}
                >
                  {PRIORITY_OPTIONS.map((opt) => {
                    const active = newPriority === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-prio={opt.tone || undefined}
                        className={`kanban-prio-chip${
                          active ? " kanban-prio-chip-active" : ""
                        }`}
                        onClick={() => setNewPriority(opt.value)}
                      >
                        <span
                          className="kanban-prio-bullet"
                          data-prio={opt.tone || undefined}
                        />
                        {t(opt.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldWorkspace")}
                </label>
                <select
                  className="input"
                  aria-label="Workspace"
                  value={newWorkspace}
                  onChange={(e) => setNewWorkspace(e.target.value)}
                >
                  <option value="scratch">
                    {t("kanban.workspaceScratch")}
                  </option>
                  <option value="worktree">
                    {t("kanban.workspaceWorktree")}
                  </option>
                  <option value="dir">{t("kanban.workspaceChoose")}</option>
                </select>
                {newWorkspace === "dir" && (
                  <div className="kanban-folder-picker">
                    <input
                      className="input"
                      type="text"
                      value={newWorkspaceDir}
                      onChange={(e) => setNewWorkspaceDir(e.target.value)}
                      placeholder={t("kanban.workspaceNoFolder")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handlePickWorkspaceFolder}
                    >
                      {t("kanban.browse")}
                    </button>
                  </div>
                )}
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label kanban-checkbox-label">
                  <input
                    type="checkbox"
                    checked={newTriage}
                    onChange={(e) => setNewTriage(e.target.checked)}
                  />
                  <span>{t("kanban.triageCheckbox")}</span>
                </label>
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreate(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newTitle.trim() || actionBusy === "create"}
              >
                {actionBusy === "create"
                  ? t("kanban.creating")
                  : t("kanban.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewBoard && (
        <div
          className="skills-detail-overlay"
          onClick={() => setShowNewBoard(false)}
        >
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <span>{t("kanban.newBoardTitle")}</span>
              <button
                className="btn-ghost"
                onClick={() => setShowNewBoard(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldSlug")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={newBoardSlug}
                  onChange={(e) => setNewBoardSlug(e.target.value)}
                  placeholder={t("kanban.slugPlaceholder")}
                  autoFocus
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("kanban.fieldDisplayName")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder={t("kanban.displayNamePlaceholder")}
                />
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowNewBoard(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateBoard}
                disabled={!newBoardSlug.trim() || actionBusy === "board-create"}
              >
                {actionBusy === "board-create"
                  ? t("kanban.creating")
                  : t("kanban.createBoard")}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailTaskId && (
        <div
          className="kanban-drawer-overlay"
          onClick={() => setDetailTaskId(null)}
        >
          <div
            className="kanban-detail-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <span>
                {detail?.task.title || t("kanban.detailFallbackTitle")}
              </span>
              <button
                className="btn-ghost"
                title={t("kanban.closeTaskDetails")}
                onClick={() => setDetailTaskId(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="schedules-modal-body">
              {detailLoading && <div className="loading-spinner" />}
              {detail && (
                <>
                  <div className="kanban-detail-meta">
                    <span className="kanban-pill kanban-pill-status">
                      <span
                        className="kanban-column-dot"
                        data-tone={STATUS_TONE[detail.task.status] || "neutral"}
                      />
                      {t(`kanban.status.${detail.task.status}`)}
                    </span>
                    {detail.task.assignee && (
                      <span className="kanban-pill">
                        @{detail.task.assignee}
                      </span>
                    )}
                    {detail.task.tenant && (
                      <span className="kanban-pill">{detail.task.tenant}</span>
                    )}
                    <span className="kanban-pill kanban-pill-id">
                      {detail.task.id}
                    </span>
                  </div>
                  {detail.task.body && (
                    <div className="kanban-detail-section">
                      <label>{t("kanban.detailBody")}</label>
                      <pre className="kanban-detail-pre">
                        {detail.task.body}
                      </pre>
                    </div>
                  )}
                  {detail.latest_summary && (
                    <div className="kanban-detail-section">
                      <label>{t("kanban.detailSummary")}</label>
                      <pre className="kanban-detail-pre">
                        {detail.latest_summary}
                      </pre>
                    </div>
                  )}
                  {detail.task.result && (
                    <div className="kanban-detail-section">
                      <label>{t("kanban.detailResult")}</label>
                      <pre className="kanban-detail-pre">
                        {detail.task.result}
                      </pre>
                    </div>
                  )}
                  {detail.comments.length > 0 && (
                    <div className="kanban-detail-section">
                      <label>
                        {t("kanban.detailComments", {
                          count: detail.comments.length,
                        })}
                      </label>
                      {detail.comments.map((c) => (
                        <div key={c.id} className="kanban-comment">
                          <div className="kanban-comment-author">
                            {c.author || t("kanban.commentAnon")}
                          </div>
                          <div className="kanban-comment-body">{c.body}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.events.length > 0 && (
                    <div className="kanban-detail-section">
                      <label>
                        {t("kanban.detailEvents", {
                          count: detail.events.length,
                        })}
                      </label>
                      <div className="kanban-events">
                        {detail.events
                          .slice(-12)
                          .reverse()
                          .map((ev) => (
                            <div key={ev.id} className="kanban-event">
                              <span className="kanban-pill">{ev.kind}</span>
                              <span className="kanban-event-time">
                                {ageLabel(ev.created_at)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Kanban;
