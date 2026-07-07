import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { VaultRow } from "../hooks/useNoteIndex";
import { vaultRowToTask } from "../tasks/vaultRowToTask";
import { WhatsNewPanel } from "../updates/WhatsNewPanel";
import { openSettings } from "../../../lib/openSettings";
import {
  summarizeNag,
  type TaskNagRecord,
} from "../../../../../shared/tasks-dump";
import type { EquityAlert } from "../../../../../shared/equity";
import type { RoutinesStatusReport } from "../../../../../shared/routines-status";
import type { ReleaseAffordanceAction } from "../../../../../shared/update-affordances";
import type { StatusKey } from "../types";

const PROFILE = "default";
const DONE_STATUS: StatusKey = "done";

interface IndexQuery {
  scope: string;
  filters?: Array<{
    prop: string;
    op: "eq" | "neq" | "contains" | "exists";
    value?: unknown;
  }>;
  sort?: { prop: string; dir: "asc" | "desc" };
  limit?: number;
}

interface AsyncRowsState<T> {
  rows: T[];
  loading: boolean;
  error: string;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

function rowIdFromPath(path: string): string {
  return path.replace(/\.md$/, "").split("/").pop() ?? path;
}

function parseDueMs(value: string): number | null {
  const due = value.trim();
  if (!due) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T23:59:59` : due;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatWhen(value: string | number | null | undefined): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDue(value: string): string {
  const ms = parseDueMs(value);
  if (ms == null) return value;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function routineLine(
  report: RoutinesStatusReport | null,
  namePart: string,
): string {
  const job = report?.ownerRoutineJobs.find((item) =>
    item.name.includes(namePart),
  );
  if (!job) return "not created yet";
  return job.lastError ?? job.lastStatus ?? job.state;
}

function useIndexRows(query: IndexQuery): AsyncRowsState<VaultRow> {
  const [state, setState] = useState<AsyncRowsState<VaultRow>>({
    rows: [],
    loading: true,
    error: "",
  });
  const key = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.spsIndexQuery) {
      setState({
        rows: [],
        loading: false,
        error: "Vault index is unavailable.",
      });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    api
      .spsIndexQuery(query, PROFILE)
      .then((rows) => {
        if (cancelled) return;
        setState({
          rows: rows as VaultRow[],
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          rows: [],
          loading: false,
          error: errorMessage(err, "Could not load vault rows."),
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

function useRoutinesStatus(): {
  report: RoutinesStatusReport | null;
  loading: boolean;
  error: string;
} {
  const [report, setReport] = useState<RoutinesStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.getRoutinesStatus) {
      setLoading(false);
      setError("Routines status is unavailable.");
      return;
    }
    api
      .getRoutinesStatus(PROFILE)
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Could not load routines status."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { report, loading, error };
}

function operatorStatusClass(status: string | undefined): string {
  if (status === "failed" || status === "error") return "danger";
  if (status === "warning" || status === "attention") return "warn";
  return "ok";
}

export function OperatorTasksWidget() {
  const { rows, loading, error } = useIndexRows({
    scope: "tasks",
    sort: { prop: "due", dir: "asc" },
    limit: 80,
  });
  const [nags, setNags] = useState<Record<string, TaskNagRecord | null>>({});
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const overdue = useMemo(() => {
    if (!nowMs) return [];
    return rows
      .map((row) => ({ row, task: vaultRowToTask(row) }))
      .filter(({ task }) => {
        if (task.status === DONE_STATUS) return false;
        const dueMs = parseDueMs(task.due);
        return dueMs != null && dueMs <= nowMs;
      })
      .slice(0, 5);
  }, [nowMs, rows]);
  const nagKey = overdue.map(({ row }) => rowIdFromPath(row.path)).join("|");

  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.spsNagGet || !nagKey) {
      setNags({});
      return;
    }
    void Promise.all(
      overdue.map(async ({ row }) => {
        const rowId = rowIdFromPath(row.path);
        const record = await api.spsNagGet(rowId, PROFILE).catch(() => null);
        return [rowId, record] as const;
      }),
    ).then((records) => {
      if (!cancelled) setNags(Object.fromEntries(records));
    });
    return () => {
      cancelled = true;
    };
  }, [nagKey, overdue]);

  if (loading || !nowMs) {
    return <div className="ck-empty">Loading overdue tasks...</div>;
  }
  if (error) return <div className="ck-inline-error">{error}</div>;
  if (!overdue.length) {
    return <div className="ck-empty">No overdue tasks or active nags.</div>;
  }

  return (
    <div className="ck-list">
      {overdue.map(({ row, task }) => {
        const rowId = rowIdFromPath(row.path);
        const nag = summarizeNag(nags[rowId], nowMs);
        return (
          <div key={row.path} className="ck-row ck-operator-row">
            <span className="ck-row-t">{task.title}</span>
            <span className="ck-row-q">
              Due {formatDue(task.due)}
              {nag.active ? ` · ${nag.label}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function OperatorInboxWidget() {
  const { rows, loading, error } = useIndexRows({
    scope: "_inbox",
    filters: [{ prop: "status", op: "eq", value: "unprocessed" }],
    sort: { prop: "capturedAt", dir: "desc" },
    limit: 100,
  });
  const digest = rows.filter(
    (row) => row.props.digest === true || row.props.digest === "true",
  ).length;
  const email = rows.filter((row) => row.props.source === "email").length;

  if (loading) return <div className="ck-empty">Loading inbox...</div>;
  if (error) return <div className="ck-inline-error">{error}</div>;

  return (
    <div className="ck-operator-summary">
      <div className="ck-operator-number">{rows.length}</div>
      <div className="ck-operator-label">unprocessed captures</div>
      {rows.length === 0 ? (
        <div className="ck-empty">Inbox triage is clear.</div>
      ) : (
        <div className="ck-operator-chips">
          <span>{email} email</span>
          <span>{digest} digest</span>
        </div>
      )}
    </div>
  );
}

export function MorningBriefWidget() {
  const { report, loading, error } = useRoutinesStatus();
  const job = report?.ownerRoutineJobs.find((item) =>
    item.name.includes("morning-brief"),
  );

  if (loading) return <div className="ck-empty">Loading brief status...</div>;
  if (error) return <div className="ck-inline-error">{error}</div>;
  if (!job) {
    return (
      <div className="ck-empty">Morning brief job has not been created.</div>
    );
  }

  return (
    <div className="ck-operator-summary">
      <span
        className={`ck-status-pill ${operatorStatusClass(
          job.lastStatus ?? undefined,
        )}`}
      >
        {job.lastError ? "error" : (job.lastStatus ?? job.state)}
      </span>
      <div className="ck-operator-label">
        Last {formatWhen(job.lastRunAt)} · next {formatWhen(job.nextRunAt)}
      </div>
      {job.lastError && <div className="ck-inline-error">{job.lastError}</div>}
    </div>
  );
}

export function PendingApprovalsWidget() {
  const queue = useStore((s) => s.workApprovals.queue);
  if (!queue.length) {
    return <div className="ck-empty">No pending workspace approvals.</div>;
  }

  return (
    <div className="ck-list">
      <div className="ck-operator-summary compact">
        <div className="ck-operator-number">{queue.length}</div>
        <div className="ck-operator-label">waiting for owner decision</div>
      </div>
      {queue.slice(0, 4).map((approval) => (
        <div key={approval.id} className="ck-row ck-operator-row">
          <span className="ck-row-t">
            {approval.toolName ?? approval.command ?? "Approval requested"}
          </span>
          {approval.description && (
            <span className="ck-row-q">{approval.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function EngineUpdatesWidget() {
  const { report, loading, error } = useRoutinesStatus();
  const setSurface = useStore((s) => s.setSurface);
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);

  const runAction = useCallback(
    (action: ReleaseAffordanceAction): void => {
      if (action.kind === "surface") {
        setSurface(action.surface);
        return;
      }
      if (action.kind === "settings") {
        openSettings(action.view);
        return;
      }
      if (action.modal === "research") {
        setResearchOpen(true);
      } else if (action.modal === "scheduled") {
        setScheduledOpen(true);
      } else if (action.modal === "templates") {
        setTemplatesOpen({ parent: null });
      } else if (action.modal === "palette") {
        setPaletteOpen(true);
      } else {
        setTweaksOpen(true);
      }
    },
    [
      setPaletteOpen,
      setResearchOpen,
      setScheduledOpen,
      setSurface,
      setTemplatesOpen,
      setTweaksOpen,
    ],
  );

  return (
    <div className="ck-operator-stack">
      <WhatsNewPanel onRunAction={runAction} variant="compact" />
      {loading && <div className="ck-empty">Loading update status...</div>}
      {error && <div className="ck-inline-error">{error}</div>}
      {report && (
        <div className="ck-list">
          {report.updateRoutines.map((routine) => (
            <div key={routine.id} className="ck-row ck-operator-row">
              <span className="ck-row-t">{routine.label}</span>
              <span className="ck-row-q">
                {routine.lastError ??
                  routine.lastStatus ??
                  (routine.enabled ? "not checked yet" : "disabled")}
              </span>
            </div>
          ))}
          <div className="ck-row ck-operator-row">
            <span className="ck-row-t">Owner routines</span>
            <span className="ck-row-q">
              morning brief: {routineLine(report, "morning-brief")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function EquityAlertsWidget() {
  const [state, setState] = useState<AsyncRowsState<EquityAlert>>({
    rows: [],
    loading: true,
    error: "",
  });

  const refresh = useCallback(() => {
    const api = window.hermesAPI;
    if (!api?.equityListAlerts) {
      setState({
        rows: [],
        loading: false,
        error: "Equity alerts are unavailable.",
      });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    void api
      .equityListAlerts(20, PROFILE)
      .then((rows) => {
        setState({
          rows: ((rows as EquityAlert[]) ?? []).slice().reverse(),
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        setState({
          rows: [],
          loading: false,
          error: errorMessage(err, "Could not load equity alerts."),
        });
      });
  }, []);

  useEffect(() => {
    refresh();
    const off = window.hermesAPI?.onEquityAlert?.(() => refresh());
    return typeof off === "function" ? off : undefined;
  }, [refresh]);

  if (state.loading) {
    return <div className="ck-empty">Loading equity alerts...</div>;
  }
  if (state.error) return <div className="ck-inline-error">{state.error}</div>;

  const unread = state.rows.filter((row) => !row.read).length;
  if (!state.rows.length) {
    return <div className="ck-empty">No equity alerts yet.</div>;
  }

  return (
    <div className="ck-list">
      <div className="ck-operator-summary compact">
        <div className="ck-operator-number">{unread}</div>
        <div className="ck-operator-label">unread equity alerts</div>
      </div>
      {state.rows.slice(0, 3).map((alert) => (
        <div key={alert.id} className="ck-row ck-operator-row">
          <span className="ck-row-t">
            {alert.ticker ? `${alert.ticker} · ` : ""}
            {alert.trigger}
          </span>
          <span className="ck-row-q">{alert.message}</span>
        </div>
      ))}
    </div>
  );
}

export function OperatorWidgetLegend() {
  return (
    <div className="ck-operator-legend" aria-hidden="true">
      <Icon name="flag" size={13} /> operator feeds
    </div>
  );
}
