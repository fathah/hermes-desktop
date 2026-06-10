// AgentTasksModal.tsx — read-only oversight of the agent's Kanban board.
//
// Absorbs the viewing half of the deleted admin Kanban screen (P2.4). The board
// itself is owned and mutated by the Python agent (`hermes kanban` CLI); this is
// the human's window into agent-created work — every task grouped by status,
// read-only. Task creation / completion / blocking stay with the agent (and the
// kanban write IPC, retained but no longer surfaced in the GUI). Composes the
// existing read IPC only: kanbanListBoards + kanbanListTasks.
import { useEffect, useState, useCallback, useMemo } from "react";
import { useStore } from "../store";
import type { KanbanTask, KanbanBoard } from "../../../../../shared/kanban";

// Column order mirrors the old board; labels are the status keys themselves
// (the admin i18n `kanban.status.*` strings went with the deleted screen).
const COLUMNS: { key: string; label: string }[] = [
  { key: "triage", label: "Triage" },
  { key: "todo", label: "To do" },
  { key: "ready", label: "Ready" },
  { key: "running", label: "Running" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

function priorityLabel(p: number): string {
  if (p >= 10) return "P0";
  if (p >= 5) return "P1";
  if (p > 0) return "P2";
  return "";
}

function ageLabel(createdAt: number | null): string {
  if (!createdAt) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - createdAt));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function AgentTasksModal() {
  const setAgentTasksOpen = useStore((s) => s.setAgentTasksOpen);
  const onClose = () => setAgentTasksOpen(false);

  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remoteUnsupported, setRemoteUnsupported] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const boardsRes = await window.hermesAPI.kanbanListBoards(false);
      if (!boardsRes.success) {
        if (boardsRes.unsupportedMode) {
          setRemoteUnsupported(true);
          return;
        }
        setError(boardsRes.error || "Couldn't load boards.");
        return;
      }
      setRemoteUnsupported(false);
      setBoards(boardsRes.data || []);
      const tasksRes = await window.hermesAPI.kanbanListTasks({
        includeArchived: false,
      });
      if (!tasksRes.success) {
        setError(tasksRes.error || "Couldn't load tasks.");
        return;
      }
      setTasks(tasksRes.data || []);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // onClose is stable enough; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentBoard = useMemo(
    () => boards.find((b) => b.is_current) ?? boards[0] ?? null,
    [boards],
  );

  const byColumn = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const task of tasks) {
      const bucket = map[task.status];
      if (bucket) bucket.push(task);
      else (map[task.status] ??= []).push(task);
    }
    return map;
  }, [tasks]);

  return (
    <div
      className="scrim"
      onMouseDown={onClose}
      style={{ alignItems: "flex-start" }}
    >
      <div
        className="modal"
        style={{ width: 720, maxWidth: "94vw" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>📋 Agent tasks</h3>
          <button
            type="button"
            className="cover-btn"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            style={{ marginLeft: "auto" }}
          >
            ↻
          </button>
        </div>
        <div className="modal-body">
          <div
            className="c-name"
            style={{ marginBottom: 8, color: "var(--tx-3)" }}
          >
            {currentBoard
              ? `${currentBoard.name} · ${currentBoard.total} task${
                  currentBoard.total === 1 ? "" : "s"
                }`
              : "Agent-managed board (read-only)"}
          </div>

          {remoteUnsupported ? (
            <div className="c-name" style={{ color: "var(--tx-3)" }}>
              The task board isn&apos;t available over a plain remote HTTP
              connection. Switch to a local or SSH connection to view it.
            </div>
          ) : error ? (
            <div className="c-name" style={{ color: "var(--danger, #c00)" }}>
              {error}
            </div>
          ) : loading && tasks.length === 0 ? (
            <div className="c-name" style={{ color: "var(--tx-3)" }}>
              Loading…
            </div>
          ) : tasks.length === 0 ? (
            <div className="c-name" style={{ color: "var(--tx-3)" }}>
              No tasks on this board yet. The agent adds tasks here as it works.
            </div>
          ) : (
            <div
              className="scroll"
              style={{ maxHeight: "62vh", display: "flex", gap: 8 }}
            >
              {COLUMNS.map((col) => {
                const colTasks = byColumn[col.key] ?? [];
                return (
                  <div
                    key={col.key}
                    style={{ flex: 1, minWidth: 0 }}
                    aria-label={col.label}
                  >
                    <div
                      className="c-name"
                      style={{
                        marginBottom: 6,
                        textTransform: "uppercase",
                        fontSize: 11,
                        letterSpacing: 0.4,
                        color: "var(--tx-3)",
                      }}
                    >
                      {col.label} ({colTasks.length})
                    </div>
                    {colTasks.map((task) => {
                      const pr = priorityLabel(task.priority);
                      const age = ageLabel(task.created_at);
                      const isOpen = expanded === task.id;
                      return (
                        <button
                          type="button"
                          key={task.id}
                          className="lst-row"
                          onClick={() => setExpanded(isOpen ? null : task.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            marginBottom: 6,
                            display: "block",
                          }}
                          title={task.body || task.title}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "center",
                            }}
                          >
                            {pr && (
                              <span
                                className="c-tag"
                                style={{ flex: "0 0 auto" }}
                              >
                                {pr}
                              </span>
                            )}
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: isOpen ? "normal" : "nowrap",
                              }}
                            >
                              {task.title}
                            </span>
                            {age && (
                              <span
                                style={{
                                  flex: "0 0 auto",
                                  color: "var(--tx-3)",
                                  fontSize: 11,
                                }}
                              >
                                {age}
                              </span>
                            )}
                          </div>
                          {isOpen && task.body && (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 12,
                                color: "var(--tx-2)",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {task.body}
                            </div>
                          )}
                          {isOpen && task.assignee && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 11,
                                color: "var(--tx-3)",
                              }}
                            >
                              @{task.assignee}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
