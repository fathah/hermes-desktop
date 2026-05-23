/**
 * Kanban tab in remote mode — read-only board + column card
 * counts driven by GET /v1/telemetry/kanban, plus Create Board
 * and Create Task buttons (Phase-4 / PR-E2).
 *
 * Card *bodies* (which can contain user prompts and task
 * descriptions) are still NOT returned by the backend's read
 * endpoint — only structural counts reach the renderer. The
 * mutation side, in contrast, accepts a body on create: the
 * user types a prompt locally, ships it to the backend, and
 * subsequent reads omit it. That asymmetry is intentional.
 *
 * Delete / complete UI is intentionally deferred — the read
 * endpoint doesn't yet return individual tasks with IDs, only
 * per-column counts, so there's nothing to click. Will come in
 * PR-E2b once tasks are surfaced.
 */

import { useState } from "react";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type {
  KanbanBoardCreateRequest,
  KanbanTaskCreateRequest,
  KanbanTelemetry,
  MutationResult,
} from "../../../../shared/telemetry-types";

type ModalKind = null | "create-board" | "create-task";

function KanbanView({
  data,
  onMutated,
}: {
  data: KanbanTelemetry;
  onMutated: () => void;
}): React.JSX.Element {
  const [modal, setModal] = useState<ModalKind>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="telemetry-summary">
      <div className="telemetry-summary-header-row">
        <h2 className="telemetry-summary-title">
          Kanban — {data.totalCards} card
          {data.totalCards === 1 ? "" : "s"} across {data.boards.length}{" "}
          board{data.boards.length === 1 ? "" : "s"}
        </h2>
        <div className="telemetry-row-actions">
          <button onClick={() => { setError(null); setModal("create-task"); }}>
            New task
          </button>
          <button
            className="telemetry-button-primary"
            onClick={() => { setError(null); setModal("create-board"); }}
          >
            New board
          </button>
        </div>
      </div>

      {data.boards.length === 0 ? (
        <p className="telemetry-summary-hint">
          No kanban boards configured on this Hermes instance.
        </p>
      ) : (
        <ul className="telemetry-kanban-board-list">
          {data.boards.map((board) => (
            <li key={board.id}>
              <h3 className="telemetry-kanban-board-name">{board.name}</h3>
              {board.columns.length === 0 ? (
                <p className="telemetry-summary-hint">No tasks yet.</p>
              ) : (
                <ul className="telemetry-kanban-column-list">
                  {board.columns.map((col) => (
                    <li key={col.id}>
                      <span className="telemetry-kanban-column-name">
                        {col.name}
                      </span>
                      <span className="telemetry-kanban-column-count">
                        {col.cardCount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {modal === "create-task" && (
        <CreateTaskDialog
          boards={data.boards.map((b) => b.id)}
          onCancel={() => setModal(null)}
          onCreated={() => { setModal(null); onMutated(); }}
          onError={setError}
          error={error}
        />
      )}
      {modal === "create-board" && (
        <CreateBoardDialog
          onCancel={() => setModal(null)}
          onCreated={() => { setModal(null); onMutated(); }}
          onError={setError}
          error={error}
        />
      )}

      <p className="telemetry-summary-hint">
        Card body content is shipped to the backend on create but never
        returned by the read endpoint. Edit / delete / complete UI lives on the server (
        <code>hermes kanban</code>) for now.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create board
// ---------------------------------------------------------------------------

function CreateBoardDialog({
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
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    if (!slug.trim()) {
      onError("Slug is required.");
      return;
    }
    setSubmitting(true);
    onError(null);
    const input: KanbanBoardCreateRequest = {
      slug: slug.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
    };
    const result: MutationResult = await window.hermesAPI.kanban.createBoard(
      input,
    );
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
        <h3 className="telemetry-summary-subtitle">Create kanban board</h3>
        <label className="telemetry-form-row">
          <span>Slug</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="lowercase-with-dashes"
          />
        </label>
        <label className="telemetry-form-row">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="optional display name"
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
// Create task
// ---------------------------------------------------------------------------

function CreateTaskDialog({
  boards,
  onCancel,
  onCreated,
  onError,
  error,
}: {
  boards: string[];
  onCancel: () => void;
  onCreated: () => void;
  onError: (msg: string | null) => void;
  error: string | null;
}): React.JSX.Element {
  const [board, setBoard] = useState(boards[0] || "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    if (!title.trim()) {
      onError("Title is required.");
      return;
    }
    setSubmitting(true);
    onError(null);
    const input: KanbanTaskCreateRequest = {
      title: title.trim(),
      ...(body.trim() ? { body } : {}),
      ...(board.trim() ? { board: board.trim() } : {}),
    };
    const result: MutationResult = await window.hermesAPI.kanban.createTask(
      input,
    );
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
        <h3 className="telemetry-summary-subtitle">Create kanban task</h3>
        <label className="telemetry-form-row">
          <span>Board</span>
          <input
            value={board}
            onChange={(e) => setBoard(e.target.value)}
            placeholder={boards[0] || "default"}
          />
        </label>
        <label className="telemetry-form-row">
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
          />
        </label>
        <label className="telemetry-form-row">
          <span>Body</span>
          <textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional: details / acceptance criteria"
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

function KanbanTelemetryView(): React.JSX.Element {
  const [refetchKey, setRefetchKey] = useState(0);
  const state = useTelemetryQuery<KanbanTelemetry>(
    "kanban",
    () => window.hermesAPI.telemetry.kanban(),
    [refetchKey],
  );
  return (
    <TelemetryCard state={state} feature="Kanban">
      {(data) => (
        <KanbanView
          data={data}
          onMutated={() => setRefetchKey((k) => k + 1)}
        />
      )}
    </TelemetryCard>
  );
}

export default KanbanTelemetryView;
