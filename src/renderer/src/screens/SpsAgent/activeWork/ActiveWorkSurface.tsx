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

function goalTitle(goal: string): string {
  return `Goal: ${goal.length > 60 ? `${goal.slice(0, 60)}...` : goal}`;
}

export function ActiveWorkSurface() {
  const [runs, setRuns] = useState<ActiveWorkRun[]>([]);
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<KanbanTaskDetail | null>(null);
  const [goalText, setGoalText] = useState("");
  const [startingGoal, setStartingGoal] = useState(false);
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

  async function startGoal(): Promise<void> {
    const goal = goalText.trim();
    if (!goal) return;
    setStartingGoal(true);
    const clientRunId = `goal-${Date.now().toString(36)}`;
    let activeId: string | null = null;
    try {
      const active = await window.hermesAPI.spsCreateActiveWorkRun({
        source: "goal",
        title: goalTitle(goal),
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
        lastTool: null,
      });
      setGoalText("");
      await refresh();
    } catch (err) {
      if (activeId) {
        await window.hermesAPI.spsUpdateActiveWorkRun(activeId, {
          status: "failed",
          error: err instanceof Error ? err.message : "Goal failed",
          completedAt: Date.now(),
          lastTool: null,
        });
      }
    } finally {
      setStartingGoal(false);
    }
  }

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
    if (!run.pageId) return;
    selectPage(run.pageId);
    setSurface("doc");
    await runWork();
  }

  return (
    <div className="active-work-surface">
      <div className="active-work-head">
        <div>
          <h1>Delegated</h1>
          <p>Goals, running work, and task board.</p>
        </div>
        <button
          className="cover-btn"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </div>

      {error && <div className="active-work-error">{error}</div>}

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

      <section className="active-work-section">
        <h2>Active Runs</h2>
        {runs.length === 0 ? (
          <div className="ck-empty">No active work yet.</div>
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
                  className="lst-row active-work-task"
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
          {taskDetail.task.body && <p>{taskDetail.task.body}</p>}
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
            <div className="active-work-detail-stack">
              <h3>Comments</h3>
              {taskDetail.comments.map((comment) => (
                <div key={comment.id} className="lst-row">
                  <strong>{comment.author || "worker"}</strong>
                  <span>{comment.body}</span>
                </div>
              ))}
            </div>
          )}
          {taskDetail.runs.length > 0 && (
            <div className="active-work-detail-stack">
              <h3>Runs</h3>
              {taskDetail.runs.map((run) => (
                <div key={run.id} className="lst-row">
                  <strong>{run.profile || "worker"}</strong>
                  <span>{run.status || run.outcome || "unknown"}</span>
                  <small>
                    Last heartbeat{" "}
                    {timeAgo(
                      run.last_heartbeat_at
                        ? run.last_heartbeat_at * 1000
                        : null,
                    )}
                  </small>
                  {run.error && <span>{run.error}</span>}
                  {run.summary && <span>{run.summary}</span>}
                </div>
              ))}
            </div>
          )}
          {taskDetail.events.length > 0 && (
            <div className="active-work-detail-stack">
              <h3>Events</h3>
              {taskDetail.events.slice(0, 10).map((event) => (
                <div key={event.id} className="lst-row">
                  <strong>{event.kind}</strong>
                  <code>{JSON.stringify(event.payload || {})}</code>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
