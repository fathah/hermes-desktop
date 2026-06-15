import { useCallback, useEffect, useState } from "react";
import type { VaultProposal } from "../../../../../shared/sps-types";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { commitVaultProposal } from "./commitVaultProposal";

interface ReviewQueueSurfaceProps {
  profile?: string;
}

export function ReviewQueueSurface({
  profile = "default",
}: ReviewQueueSurfaceProps): React.JSX.Element {
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const flash = useStore((s) => s.flash);
  const setSurface = useStore((s) => s.setSurface);
  const selectPage = useStore((s) => s.selectPage);
  const [proposals, setProposals] = useState<VaultProposal[]>([]);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await window.hermesAPI.spsListVaultProposals?.(profile);
      setProposals(rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = proposals.filter((proposal) => proposal.status === "pending");

  const selectedFor = (proposal: VaultProposal): Set<string> =>
    selected[proposal.id] ?? new Set(proposal.operations.map((op) => op.id));

  const toggleOperation = (proposal: VaultProposal, operationId: string): void => {
    setSelected((prev) => {
      const next = new Set(selectedFor(proposal));
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return { ...prev, [proposal.id]: next };
    });
  };

  const apply = async (proposal: VaultProposal): Promise<void> => {
    setBusy(proposal.id);
    setError("");
    try {
      const picked = selectedFor(proposal);
      await commitVaultProposal(proposal, {
        profile,
        selectedOperationIds: picked,
        commitPage: ingestCommitPage,
      });
      flash(`Applied ${picked.size} vault operation${picked.size === 1 ? "" : "s"}`);
      await window.hermesAPI.spsAppendWikiLog?.(
        "ingest",
        proposal.summary,
        profile,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const dismiss = async (proposal: VaultProposal): Promise<void> => {
    setBusy(proposal.id);
    try {
      await window.hermesAPI.spsDismissVaultProposal?.(proposal.id, profile);
      await load();
    } finally {
      setBusy("");
    }
  };

  const openPage = (pageId: string): void => {
    selectPage(pageId);
    setSurface("doc");
  };

  return (
    <div className="inbox-surface">
      <header className="inbox-header-mb">
        <h1 className="inbox-title">
          <Icon name="check" size={22} />
          AI Review Queue
        </h1>
        <p className="inbox-subtitle">
          My Assistant can propose vault changes here. Nothing lands until you
          review and apply it.
        </p>
      </header>

      {error && <div className="inbox-error">{error}</div>}

      {pending.length === 0 ? (
        <div className="inbox-empty-notice">No pending vault proposals.</div>
      ) : (
        <ul className="inbox-card-list">
          {pending.map((proposal) => {
            const picked = selectedFor(proposal);
            return (
              <li key={proposal.id} className="inbox-proposed-page">
                <div className="inbox-flex-align-center-gap8-mb6">
                  <span className="inbox-card-badge">{proposal.source}</span>
                  <strong>{proposal.title}</strong>
                  <span className="flex-grow" />
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy === proposal.id}
                    onClick={() => void dismiss(proposal)}
                  >
                    Dismiss
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === proposal.id || picked.size === 0}
                    onClick={() => void apply(proposal)}
                  >
                    {busy === proposal.id ? "Applying..." : "Apply selected"}
                  </button>
                </div>
                <div className="inbox-proposal-summary">{proposal.summary}</div>
                <ul className="health-list">
                  {proposal.operations.map((operation) => (
                    <li key={operation.id} className="health-row">
                      <input
                        type="checkbox"
                        checked={picked.has(operation.id)}
                        onChange={() => toggleOperation(proposal, operation.id)}
                      />
                      <span className="health-mono-text">{operation.kind}</span>
                      {"pageId" in operation && (
                        <button
                          className="health-link"
                          onClick={() => openPage(operation.pageId)}
                        >
                          {operation.pageId}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
