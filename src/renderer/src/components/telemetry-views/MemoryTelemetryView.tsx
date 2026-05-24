/**
 * Memory tab in remote mode — summary card + editable entries
 * list + USER.md edit-target.
 *
 * Plan v10 / PR-4 / β. Read-data comes from
 * `/api/memory?profile=<active>` via the adapter in
 * `subsystems.ts:fetchMemory()`. Writes go through the
 * memoryEdit IPC family with the strict-allowlist guard
 * (only `mira-uitest` accepted tonight).
 *
 * The component is a strict gate: write buttons are
 * `disabled` unless `profile === "mira-uitest"`. The adapter
 * is a second line of defence. Both layers must agree before
 * an HTTP PUT fires.
 */

import { useState } from "react";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import ConfirmDialog from "../ConfirmDialog";
import type {
  MemoryTelemetry,
  MutationResult,
} from "../../../../shared/telemetry-types";

const ALLOWED_PROFILE = "mira-uitest";

function isWriteAllowed(profile?: string): boolean {
  return (profile || "").trim().toLowerCase() === ALLOWED_PROFILE;
}

function blockBannerText(profile?: string): string {
  const p = (profile || "").trim().toLowerCase();
  if (!p) return "No profile selected. Pick a profile in the header.";
  if (p === "default" || p === "current")
    return "Write actions on the default profile require backend stale-write protection (not yet available).";
  return `Write actions enabled only for the '${ALLOWED_PROFILE}' disposable profile tonight (current: '${profile}').`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatEpoch(epoch: number | null | undefined): string | null {
  if (!epoch) return null;
  try {
    return new Date(epoch * 1000).toLocaleString();
  } catch {
    return null;
  }
}

type ModalKind =
  | null
  | { kind: "add" }
  | { kind: "edit"; index: number; original: string }
  | { kind: "edit-user" };

type ConfirmKind =
  | null
  | { kind: "delete-entry"; index: number; snippet: string }
  | { kind: "user-replace"; newContent: string; isEmpty: boolean };

function MemoryView({
  data,
  profile,
  writeAllowed,
  onMutated,
}: {
  data: MemoryTelemetry;
  profile?: string;
  writeAllowed: boolean;
  onMutated: () => void;
}): React.JSX.Element {
  const [modal, setModal] = useState<ModalKind>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const entries = data.entries ?? [];

  return (
    <div className="telemetry-summary">
      <div className="telemetry-summary-header-row">
        <h2 className="telemetry-summary-title">
          Memory{profile ? ` — profile '${profile}'` : ""}
        </h2>
        {writeAllowed && (
          <div className="telemetry-row-actions">
            <button
              className="telemetry-button-primary"
              onClick={() => {
                setError(null);
                setModal({ kind: "add" });
              }}
            >
              + Add entry
            </button>
          </div>
        )}
      </div>

      {!writeAllowed && (
        <p
          className="telemetry-row-error"
          data-testid="memory-write-block-banner"
        >
          {blockBannerText(profile)}
        </p>
      )}

      <dl className="telemetry-summary-list">
        <div>
          <dt>Provider</dt>
          <dd>{data.provider}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{data.configured ? "Configured" : "Not configured"}</dd>
        </div>
        {data.itemCount !== undefined && (
          <div>
            <dt>Entries</dt>
            <dd>{data.itemCount.toLocaleString()}</dd>
          </div>
        )}
        {data.sizeBytes !== undefined && (
          <div>
            <dt>Total size</dt>
            <dd>{formatBytes(data.sizeBytes)}</dd>
          </div>
        )}
        {data.lastUpdatedAt && (
          <div>
            <dt>Updated</dt>
            <dd>{data.lastUpdatedAt}</dd>
          </div>
        )}
      </dl>

      <h3 className="telemetry-summary-subtitle">Memory entries</h3>
      {entries.length === 0 ? (
        <p className="telemetry-summary-hint">No entries yet.</p>
      ) : (
        <ul className="telemetry-events-list">
          {entries.map((entry) => (
            <li key={entry.index}>
              <span className="telemetry-event-kind">#{entry.index}</span>
              <span
                className="telemetry-event-summary"
                style={{ whiteSpace: "pre-wrap" }}
              >
                {entry.content}
              </span>
              {writeAllowed && (
                <span className="telemetry-row-actions">
                  <button
                    onClick={() => {
                      setError(null);
                      setModal({
                        kind: "edit",
                        index: entry.index,
                        original: entry.content,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="telemetry-button-danger"
                    onClick={() =>
                      setConfirm({
                        kind: "delete-entry",
                        index: entry.index,
                        snippet: entry.content.slice(0, 80),
                      })
                    }
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="telemetry-summary-subtitle">USER.md profile</h3>
      <dl className="telemetry-summary-list">
        <div>
          <dt>Size</dt>
          <dd>
            {data.userCharCount != null
              ? `${data.userCharCount.toLocaleString()} chars`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Last modified</dt>
          <dd>{formatEpoch(data.userLastModified) ?? "—"}</dd>
        </div>
      </dl>
      <p className="telemetry-summary-hint">
        Current USER.md content is redacted on the wire for security.
        The edit dialog replaces the file with new content.
      </p>
      {writeAllowed && (
        <div className="telemetry-row-actions">
          <button
            onClick={() => {
              setError(null);
              setModal({ kind: "edit-user" });
            }}
          >
            Edit USER.md
          </button>
        </div>
      )}

      {modal?.kind === "add" && (
        <AddEntryDialog
          profile={profile}
          submitting={submitting}
          error={error}
          onError={setError}
          onSubmittingChange={setSubmitting}
          onCancel={() => {
            setModal(null);
            setError(null);
          }}
          onDone={() => {
            setModal(null);
            setError(null);
            onMutated();
          }}
        />
      )}

      {modal?.kind === "edit" && (
        <EditEntryDialog
          index={modal.index}
          original={modal.original}
          profile={profile}
          submitting={submitting}
          error={error}
          onError={setError}
          onSubmittingChange={setSubmitting}
          onCancel={() => {
            setModal(null);
            setError(null);
          }}
          onDone={() => {
            setModal(null);
            setError(null);
            onMutated();
          }}
        />
      )}

      {modal?.kind === "edit-user" && (
        <EditUserProfileDialog
          profile={profile}
          previousLastModified={data.userLastModified ?? null}
          previousCharCount={data.userCharCount ?? 0}
          submitting={submitting}
          error={error}
          onError={setError}
          onSubmittingChange={setSubmitting}
          onCancel={() => {
            setModal(null);
            setError(null);
          }}
          onDone={() => {
            setModal(null);
            setError(null);
            onMutated();
          }}
          onRequestConfirm={(newContent) =>
            setConfirm({
              kind: "user-replace",
              newContent,
              isEmpty: newContent.trim().length === 0,
            })
          }
        />
      )}

      {confirm?.kind === "delete-entry" && (
        <ConfirmDialog
          title={`Delete memory entry #${confirm.index}?`}
          body={
            <>
              The entry will be permanently removed.
              <br />
              <code style={{ display: "block", marginTop: 8 }}>
                {confirm.snippet}
                {confirm.snippet.length === 80 ? "…" : ""}
              </code>
            </>
          }
          confirmLabel="Delete"
          destructive
          pending={submitting}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }}
          onConfirm={async () => {
            setSubmitting(true);
            setError(null);
            const result: MutationResult =
              await window.hermesAPI.memoryEdit.deleteEntry(
                confirm.index,
                profile,
              );
            setSubmitting(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setConfirm(null);
            onMutated();
          }}
        />
      )}

      {confirm?.kind === "user-replace" && (
        <ConfirmDialog
          title={
            confirm.isEmpty
              ? "Clear USER.md to empty?"
              : "Replace USER.md content?"
          }
          body={
            confirm.isEmpty
              ? `Submit will CLEAR USER.md to empty. Original ${(data.userCharCount ?? 0).toLocaleString()}-char content will be lost. Continue?`
              : `Replace USER.md with ${confirm.newContent.length.toLocaleString()} new characters (was ${(data.userCharCount ?? 0).toLocaleString()}). The previous content cannot be recovered from this UI. Continue?`
          }
          confirmLabel={confirm.isEmpty ? "Clear" : "Replace"}
          destructive
          pending={submitting}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }}
          onConfirm={async () => {
            setSubmitting(true);
            setError(null);
            const result: MutationResult =
              await window.hermesAPI.memoryEdit.writeUserProfile(
                confirm.newContent,
                profile,
              );
            setSubmitting(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setConfirm(null);
            setModal(null);
            onMutated();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddEntryDialog
// ---------------------------------------------------------------------------

function AddEntryDialog({
  profile,
  submitting,
  error,
  onError,
  onSubmittingChange,
  onCancel,
  onDone,
}: {
  profile?: string;
  submitting: boolean;
  error: string | null;
  onError: (msg: string | null) => void;
  onSubmittingChange: (v: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [content, setContent] = useState("");

  const submit = async (): Promise<void> => {
    if (!content.trim()) {
      onError("Entry must not be empty.");
      return;
    }
    onSubmittingChange(true);
    onError(null);
    const result: MutationResult =
      await window.hermesAPI.memoryEdit.addEntry(content, profile);
    onSubmittingChange(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onDone();
  };

  return (
    <div className="telemetry-dialog-backdrop" onClick={onCancel}>
      <div
        className="telemetry-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="telemetry-summary-subtitle">
          Add memory entry — profile '{profile || "?"}'
        </h3>
        <label className="telemetry-form-row">
          <span>Content</span>
          <textarea
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="A new memory fact …"
            autoFocus
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
            {submitting ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditEntryDialog (with race protection)
// ---------------------------------------------------------------------------

function EditEntryDialog({
  index,
  original,
  profile,
  submitting,
  error,
  onError,
  onSubmittingChange,
  onCancel,
  onDone,
}: {
  index: number;
  original: string;
  profile?: string;
  submitting: boolean;
  error: string | null;
  onError: (msg: string | null) => void;
  onSubmittingChange: (v: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [content, setContent] = useState(original);

  const submit = async (): Promise<void> => {
    if (!content.trim()) {
      onError("Entry must not be empty.");
      return;
    }
    onSubmittingChange(true);
    onError(null);

    // Race protection: re-fetch /api/memory, check that entry
    // at our index still has the same content the user saw
    // when they clicked Edit. If it shifted (parallel add /
    // delete), refuse and tell them to reload.
    const env = await window.hermesAPI.telemetry.memory();
    if (!env.available) {
      onSubmittingChange(false);
      onError("Could not re-verify entry before edit. Reload and retry.");
      return;
    }
    const live = (env.data.entries || []).find((e) => e.index === index);
    if (!live || live.content !== original) {
      onSubmittingChange(false);
      onError(
        "Entry changed on the server while you were editing. Cancel and reopen the Memory tab to re-pick the target row.",
      );
      return;
    }

    const result: MutationResult =
      await window.hermesAPI.memoryEdit.updateEntry(
        index,
        content,
        profile,
      );
    onSubmittingChange(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onDone();
  };

  return (
    <div className="telemetry-dialog-backdrop" onClick={onCancel}>
      <div
        className="telemetry-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="telemetry-summary-subtitle">
          Edit memory entry #{index} — profile '{profile || "?"}'
        </h3>
        <label className="telemetry-form-row">
          <span>Content</span>
          <textarea
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
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
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditUserProfileDialog (drift check + destructive confirm)
// ---------------------------------------------------------------------------

function EditUserProfileDialog({
  profile,
  previousLastModified,
  previousCharCount,
  submitting,
  error,
  onError,
  onSubmittingChange,
  onCancel,
  onDone,
  onRequestConfirm,
}: {
  profile?: string;
  previousLastModified: number | null;
  previousCharCount: number;
  submitting: boolean;
  error: string | null;
  onError: (msg: string | null) => void;
  onSubmittingChange: (v: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
  onRequestConfirm: (newContent: string) => void;
}): React.JSX.Element {
  // Touch onSubmittingChange + onDone so the lint stays happy
  // even though the post-confirm submit lives in MemoryView.
  void onSubmittingChange;
  void onDone;

  const [content, setContent] = useState("");

  const submit = async (): Promise<void> => {
    onError(null);
    // Drift check: re-fetch /api/memory, compare userLastModified.
    const env = await window.hermesAPI.telemetry.memory();
    if (!env.available) {
      onError("Could not re-verify USER.md before save. Reload and retry.");
      return;
    }
    const liveMtime = env.data.userLastModified ?? null;
    if (liveMtime !== previousLastModified) {
      onError(
        "USER.md changed on the server while you were editing. Reload and retry.",
      );
      return;
    }
    // Defer to the parent's ConfirmDialog for the destructive step.
    onRequestConfirm(content);
  };

  return (
    <div className="telemetry-dialog-backdrop" onClick={onCancel}>
      <div
        className="telemetry-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="telemetry-summary-subtitle">
          Edit USER.md — profile '{profile || "?"}'
        </h3>
        <p className="telemetry-summary-hint">
          Current USER.md: {previousCharCount.toLocaleString()} chars,
          last modified{" "}
          {formatEpoch(previousLastModified) ?? "—"}. Content is
          hidden in remote mode for security; submit replaces it
          with what you type below.
        </p>
        <label className="telemetry-form-row">
          <span>New content</span>
          <textarea
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="(typing replaces USER.md entirely)"
            autoFocus
          />
        </label>
        {error && <p className="telemetry-row-error">{error}</p>}
        <div className="telemetry-dialog-actions">
          <button onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            className="telemetry-button-danger"
            onClick={submit}
            disabled={submitting}
          >
            Continue…
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer — gates read + write on the profile prop
// ---------------------------------------------------------------------------

interface Props {
  profile?: string;
}

function MemoryTelemetryView({ profile }: Props): React.JSX.Element {
  const [refetchKey, setRefetchKey] = useState(0);
  const profileValid = Boolean((profile || "").trim());
  const writeAllowed = isWriteAllowed(profile);
  // Hooks must be called unconditionally — even when we have
  // no profile (in which case the fetcher returns a quick
  // upstream-error and we ignore the result in the early-return
  // branch below).
  const state = useTelemetryQuery<MemoryTelemetry>(
    "memory",
    () =>
      profileValid
        ? window.hermesAPI.telemetry.memory(profile)
        : Promise.resolve({
          available: false as const,
          reason: "not-configured" as const,
          detail: "no-profile",
        }),
    [refetchKey, profile],
  );

  if (!profileValid) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Memory</h2>
        <p
          className="telemetry-row-error"
          data-testid="memory-write-block-banner"
        >
          No profile selected. Pick a profile in the header.
        </p>
      </div>
    );
  }

  return (
    <TelemetryCard state={state} feature="Memory">
      {(data) => (
        <MemoryView
          data={data}
          profile={profile}
          writeAllowed={writeAllowed}
          onMutated={() => setRefetchKey((k) => k + 1)}
        />
      )}
    </TelemetryCard>
  );
}

export default MemoryTelemetryView;
