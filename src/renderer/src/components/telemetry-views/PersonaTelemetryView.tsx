/**
 * Persona (SOUL) tab in remote mode — read + edit + reset
 * driven by `/api/profiles/{profile}/soul`.
 *
 * Plan v10 / PR-4 / γ. CodeMirror 6 editor for the edit
 * modal; ConfirmDialog gates destructive actions
 * (replace-with-shrink, replace-with-empty, reset).
 *
 * Write gate: only `profile === "mira-uitest"` enables the
 * edit / reset buttons. Adapter (subsystem-mutations.ts) is
 * the second line of defence with the same strict allowlist.
 *
 * Backend caveat (plan v10): `_handle_get_soul` is pass-through
 * — SOUL.md is NOT structurally sanitised on the wire.
 * Anything pasted into SOUL.md (stray API key, etc.) will
 * leak to Remote Bearer holders until the follow-up
 * sanitiser slice (Open Question #4) lands.
 *
 * Backend refetch limitation: PUT/POST responses don't
 * include a fresh `last_modified`. The drift-check's only
 * source of truth is the `useTelemetryQuery` refetch
 * triggered by `onMutated()`.
 */

import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import ConfirmDialog from "../ConfirmDialog";
import type {
  MutationResult,
  PersonaTelemetry,
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

function formatEpoch(epoch: number | null | undefined): string | null {
  if (!epoch) return null;
  try {
    return new Date(epoch * 1000).toLocaleString();
  } catch {
    return null;
  }
}

type ModalKind = null | { kind: "edit" } | { kind: "reset" };
type ConfirmKind =
  | null
  | {
      kind: "save";
      newContent: string;
      variant: "empty" | "shrink";
      previousLength: number;
    };

function PersonaView({
  data,
  profile,
  writeAllowed,
  onMutated,
}: {
  data: PersonaTelemetry;
  profile?: string;
  writeAllowed: boolean;
  onMutated: () => void;
}): React.JSX.Element {
  const [modal, setModal] = useState<ModalKind>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const profileName = data.profileName || profile || "?";

  return (
    <div className="telemetry-summary">
      <div className="telemetry-summary-header-row">
        <h2 className="telemetry-summary-title">
          Persona — profile '{profileName}'
        </h2>
        {writeAllowed && (
          <div className="telemetry-row-actions">
            <button
              onClick={() => {
                setError(null);
                setModal({ kind: "edit" });
              }}
            >
              Edit
            </button>
            <button
              className="telemetry-button-danger"
              onClick={() => {
                setError(null);
                setModal({ kind: "reset" });
              }}
            >
              Reset to default
            </button>
          </div>
        )}
      </div>

      {!writeAllowed && (
        <p
          className="telemetry-row-error"
          data-testid="persona-write-block-banner"
        >
          {blockBannerText(profile)}
        </p>
      )}

      <dl className="telemetry-summary-list">
        <div>
          <dt>Size</dt>
          <dd>
            {data.content?.length.toLocaleString() ?? "0"} chars
            {data.sizeBytes !== undefined && (
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                ({data.sizeBytes.toLocaleString()} bytes)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Last modified</dt>
          <dd>{formatEpoch(data.soulLastModified) ?? "—"}</dd>
        </div>
      </dl>

      {data.configured ? (
        <pre
          style={{
            background: "rgba(255, 255, 255, 0.03)",
            padding: "12px 16px",
            borderRadius: 6,
            overflowX: "auto",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            margin: 0,
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          {data.content}
        </pre>
      ) : (
        <p className="telemetry-summary-hint">
          No <code>SOUL.md</code> configured for this profile.
        </p>
      )}

      {data.truncated && (
        <p className="telemetry-summary-hint">
          ⚠ Content truncated at 16 KB. Full file ({data.sizeBytes} bytes)
          lives at <code>~/.hermes/profiles/{profileName}/SOUL.md</code>.
        </p>
      )}

      {modal?.kind === "edit" && (
        <EditSoulDialog
          profileName={profileName}
          initialContent={data.content || ""}
          previousLastModified={data.soulLastModified ?? null}
          submitting={submitting}
          error={error}
          onError={setError}
          onCancel={() => {
            setModal(null);
            setError(null);
          }}
          onRequestConfirm={(newContent, variant, previousLength) =>
            setConfirm({ kind: "save", newContent, variant, previousLength })
          }
          onDirectSave={async (newContent) => {
            setSubmitting(true);
            setError(null);
            const result: MutationResult =
              await window.hermesAPI.soulEdit.write(profileName, newContent);
            setSubmitting(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setModal(null);
            onMutated();
          }}
        />
      )}

      {modal?.kind === "reset" && (
        <ConfirmDialog
          title={`Reset SOUL.md for profile '${profileName}'?`}
          body={
            <>
              The current SOUL.md will be overwritten with the
              default persona. Any concurrent changes made from
              other sessions since this dialog opened will ALSO
              be lost (reset bypasses the drift-check
              intentionally).
              <br />
              Cannot be undone from this UI.
            </>
          }
          confirmLabel="Reset"
          destructive
          pending={submitting}
          onCancel={() => {
            setModal(null);
            setError(null);
          }}
          onConfirm={async () => {
            setSubmitting(true);
            setError(null);
            const result: MutationResult =
              await window.hermesAPI.soulEdit.reset(profileName);
            setSubmitting(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setModal(null);
            onMutated();
          }}
        />
      )}

      {confirm?.kind === "save" && (
        <ConfirmDialog
          title={
            confirm.variant === "empty"
              ? `Clear SOUL.md for profile '${profileName}' to empty?`
              : `Replace SOUL.md for profile '${profileName}'?`
          }
          body={
            confirm.variant === "empty"
              ? `Submit will CLEAR SOUL.md to empty. Original ${confirm.previousLength.toLocaleString()}-char persona will be lost. Continue?`
              : `Replace SOUL.md with ${confirm.newContent.length.toLocaleString()} characters (was ${confirm.previousLength.toLocaleString()}, shrunk by more than 50%). This will overwrite the persona. Cannot be undone from this UI.`
          }
          confirmLabel={confirm.variant === "empty" ? "Clear" : "Replace"}
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
              await window.hermesAPI.soulEdit.write(
                profileName,
                confirm.newContent,
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

      <p className="telemetry-summary-hint">
        ⚠ SOUL.md content is NOT sanitised on the wire today
        (see Open Question #4 in the project plan). Do not paste
        credentials into the persona.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditSoulDialog — CodeMirror 6 editor with drift check +
// empty/shrink guard
// ---------------------------------------------------------------------------

function EditSoulDialog({
  profileName,
  initialContent,
  previousLastModified,
  submitting,
  error,
  onError,
  onCancel,
  onRequestConfirm,
  onDirectSave,
}: {
  profileName: string;
  initialContent: string;
  previousLastModified: number | null;
  submitting: boolean;
  error: string | null;
  onError: (msg: string | null) => void;
  onCancel: () => void;
  onRequestConfirm: (
    newContent: string,
    variant: "empty" | "shrink",
    previousLength: number,
  ) => void;
  onDirectSave: (newContent: string) => Promise<void>;
}): React.JSX.Element {
  const [content, setContent] = useState(initialContent);

  const submit = async (): Promise<void> => {
    onError(null);

    // Drift check: re-fetch persona, compare soulLastModified.
    const env = await window.hermesAPI.telemetry.persona(profileName);
    if (!env.available) {
      onError("Could not re-verify SOUL.md before save. Reload and retry.");
      return;
    }
    const liveMtime = env.data.soulLastModified ?? null;
    if (liveMtime !== previousLastModified) {
      onError(
        "SOUL.md changed on the server while you were editing. Reload and retry.",
      );
      return;
    }

    // Guard precedence (plan v10 N9.3): empty-check FIRST.
    // The edge case previousLength=1, newContent="" triggers
    // both empty and shrink; empty wins.
    const previousLength = initialContent.length;
    if (content.trim().length === 0) {
      onRequestConfirm(content, "empty", previousLength);
      return;
    }
    if (content.length < previousLength / 2) {
      onRequestConfirm(content, "shrink", previousLength);
      return;
    }
    // Above the empty + shrink thresholds — fire directly.
    await onDirectSave(content);
  };

  return (
    <div className="telemetry-dialog-backdrop" onClick={onCancel}>
      <div
        className="telemetry-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(900px, 92vw)" }}
      >
        <h3 className="telemetry-summary-subtitle">
          Edit SOUL.md — profile '{profileName}'
        </h3>
        <CodeMirror
          value={content}
          extensions={[markdown()]}
          theme={oneDark}
          height="60vh"
          onChange={(v) => setContent(v)}
        />
        {error && (
          <p className="telemetry-row-error" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
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
// Outer
// ---------------------------------------------------------------------------

interface Props {
  profile?: string;
}

function PersonaTelemetryView({ profile }: Props): React.JSX.Element {
  const [refetchKey, setRefetchKey] = useState(0);
  const profileValid = Boolean((profile || "").trim());
  const writeAllowed = isWriteAllowed(profile);

  // Hooks unconditionally; early-return handles no-profile.
  const state = useTelemetryQuery<PersonaTelemetry>(
    "persona",
    () =>
      profileValid
        ? window.hermesAPI.telemetry.persona(profile)
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
        <h2 className="telemetry-summary-title">Persona</h2>
        <p
          className="telemetry-row-error"
          data-testid="persona-write-block-banner"
        >
          No profile selected. Pick a profile in the header.
        </p>
      </div>
    );
  }

  return (
    <TelemetryCard state={state} feature="Persona">
      {(data) => (
        <PersonaView
          data={data}
          profile={profile}
          writeAllowed={writeAllowed}
          onMutated={() => setRefetchKey((k) => k + 1)}
        />
      )}
    </TelemetryCard>
  );
}

export default PersonaTelemetryView;
