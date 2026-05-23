/**
 * Schedules tab in remote mode — cron job summary + CRUD.
 *
 * Reads via GET /v1/telemetry/schedules. Writes via the
 * existing /api/jobs/* endpoints behind the new `cron.*` IPC
 * surface. Every mutation goes through an explicit confirm
 * dialog so the user can't fire a destructive action by
 * accident across the network.
 *
 * Job *payloads* (prompts) are still not returned by the
 * read endpoint — the resolver only exposes structural
 * metadata. Create / edit go the other way: the user types
 * a prompt locally, we ship it to the backend, the read
 * endpoint omits it on subsequent fetches. That asymmetry is
 * intentional and documented in the read DTO.
 */

import { useState } from "react";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type {
  CronJobInput,
  MutationResult,
  SchedulesTelemetry,
} from "../../../../shared/telemetry-types";

interface RowState {
  busy: boolean;
  error: string | null;
}

function SchedulesView({
  data,
  onMutated,
}: {
  data: SchedulesTelemetry;
  onMutated: () => void;
}): React.JSX.Element {
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const setRow = (id: string, patch: Partial<RowState>): void => {
    setRowState((prev) => {
      const current: RowState = prev[id] ?? { busy: false, error: null };
      return { ...prev, [id]: { ...current, ...patch } };
    });
  };

  const runMutation = async (
    id: string,
    label: string,
    fn: () => Promise<MutationResult>,
    requireConfirm = false,
  ): Promise<void> => {
    if (requireConfirm) {
      const ok = window.confirm(
        `${label} this job?\n\nThis fires against the remote Hermes backend.`,
      );
      if (!ok) return;
    }
    setRow(id, { busy: true, error: null });
    try {
      const result = await fn();
      if (!result.ok) {
        setRow(id, { busy: false, error: result.error });
        return;
      }
      setRow(id, { busy: false, error: null });
      onMutated();
    } catch (err) {
      setRow(id, {
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="telemetry-summary">
      <div className="telemetry-summary-header-row">
        <h2 className="telemetry-summary-title">Schedules</h2>
        <button
          className="telemetry-button-primary"
          onClick={() => {
            setCreateError(null);
            setShowCreate(true);
          }}
        >
          New job
        </button>
      </div>

      {data.jobs.length === 0 ? (
        <p className="telemetry-summary-hint">
          No scheduled jobs configured on this Hermes instance.
        </p>
      ) : (
        <table className="telemetry-schedules-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Schedule</th>
              <th>Next run</th>
              <th>Last status</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => {
              const s = rowState[job.id] || { busy: false, error: null };
              return (
                <tr key={job.id}>
                  <td>{job.name || job.id}</td>
                  <td>{job.kind}</td>
                  <td>
                    <code>{job.schedule}</code>
                  </td>
                  <td>{job.nextRunAt || "—"}</td>
                  <td>{job.lastStatus || "—"}</td>
                  <td>{job.enabled ? "enabled" : "paused"}</td>
                  <td>
                    <div className="telemetry-row-actions">
                      <button
                        disabled={s.busy}
                        title="Run now"
                        onClick={() =>
                          runMutation(job.id, "Run", () =>
                            window.hermesAPI.cron.run(job.id),
                          )
                        }
                      >
                        Run
                      </button>
                      {job.enabled ? (
                        <button
                          disabled={s.busy}
                          title="Pause"
                          onClick={() =>
                            runMutation(job.id, "Pause", () =>
                              window.hermesAPI.cron.pause(job.id),
                            )
                          }
                        >
                          Pause
                        </button>
                      ) : (
                        <button
                          disabled={s.busy}
                          title="Resume"
                          onClick={() =>
                            runMutation(job.id, "Resume", () =>
                              window.hermesAPI.cron.resume(job.id),
                            )
                          }
                        >
                          Resume
                        </button>
                      )}
                      <button
                        disabled={s.busy}
                        title="Delete"
                        className="telemetry-button-danger"
                        onClick={() =>
                          runMutation(
                            job.id,
                            "Delete",
                            () => window.hermesAPI.cron.remove(job.id),
                            true,
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                    {s.error && (
                      <p className="telemetry-row-error">{s.error}</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateJobDialog
          onCancel={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            onMutated();
          }}
          onError={setCreateError}
          error={createError}
        />
      )}

      <p className="telemetry-summary-hint">
        Manage cron jobs server-side. Job <code>prompt</code> bodies are
        shipped to the backend on create but never returned by the read
        endpoint.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

function CreateJobDialog({
  onCancel,
  onCreated,
  onError,
  error,
}: {
  onCancel: () => void;
  onCreated: () => void;
  onError: (msg: string | null) => void;
  error: string | null;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [deliver, setDeliver] = useState("local");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    if (!name.trim() || !schedule.trim()) {
      onError("Name and schedule are required.");
      return;
    }
    setSubmitting(true);
    onError(null);
    const input: CronJobInput = {
      name: name.trim(),
      schedule: schedule.trim(),
      prompt,
      deliver,
    };
    const result = await window.hermesAPI.cron.create(input);
    setSubmitting(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onCreated();
  };

  return (
    <div className="telemetry-dialog-backdrop" onClick={onCancel}>
      <div
        className="telemetry-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="telemetry-summary-subtitle">Create cron job</h3>
        <label className="telemetry-form-row">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly summary"
          />
        </label>
        <label className="telemetry-form-row">
          <span>Schedule</span>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * *  or  every 30m  or  2026-05-24T14:00"
          />
        </label>
        <label className="telemetry-form-row">
          <span>Prompt</span>
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do when this fires?"
          />
        </label>
        <label className="telemetry-form-row">
          <span>Deliver</span>
          <input
            value={deliver}
            onChange={(e) => setDeliver(e.target.value)}
            placeholder="local | origin | telegram:<chat_id>"
          />
        </label>
        {error && <p className="telemetry-row-error">{error}</p>}
        <div className="telemetry-dialog-actions">
          <button onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            className="telemetry-button-primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer
// ---------------------------------------------------------------------------

function SchedulesTelemetryView(): React.JSX.Element {
  const [refetchKey, setRefetchKey] = useState(0);
  const state = useTelemetryQuery<SchedulesTelemetry>(
    "schedules",
    () => window.hermesAPI.telemetry.schedules(),
    [refetchKey],
  );
  return (
    <TelemetryCard state={state} feature="Schedules">
      {(data) => (
        <SchedulesView
          data={data}
          onMutated={() => setRefetchKey((k) => k + 1)}
        />
      )}
    </TelemetryCard>
  );
}

export default SchedulesTelemetryView;
