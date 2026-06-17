import type {
  ContentEvidence,
  DraftClaim,
} from "../../../../../shared/content-studio";

interface Props {
  claims: DraftClaim[];
  evidenceUrl: string;
  evidenceSnippet: string;
  onEvidenceUrlChange: (value: string) => void;
  onEvidenceSnippetChange: (value: string) => void;
  onAttachEvidence: () => void;
}

export function EvidenceLedger({
  claims,
  evidenceUrl,
  evidenceSnippet,
  onEvidenceUrlChange,
  onEvidenceSnippetChange,
  onAttachEvidence,
}: Props): React.JSX.Element {
  return (
    <div className="content-studio-quality">
      <strong>Evidence ledger</strong>
      {claims.length === 0 ? (
        <p>No numeric or absolute claims detected yet.</p>
      ) : (
        <div className="content-studio-claim-list">
          {claims.map((claim) => (
            <div key={claim.claimId} className="content-studio-claim-row">
              <span>{claim.text}</span>
              <span>{claim.status}</span>
            </div>
          ))}
        </div>
      )}
      <div className="content-studio-grid">
        <label>
          <span>Evidence source URL</span>
          <input
            aria-label="Evidence source URL"
            className="inbox-input"
            value={evidenceUrl}
            onChange={(event) => onEvidenceUrlChange(event.target.value)}
            placeholder="https://example.com/proof"
          />
        </label>
        <label>
          <span>Evidence snippet</span>
          <input
            aria-label="Evidence snippet"
            className="inbox-input"
            value={evidenceSnippet}
            onChange={(event) => onEvidenceSnippetChange(event.target.value)}
            placeholder="Short quote or proof note"
          />
        </label>
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={onAttachEvidence}
      >
        Attach evidence
      </button>
    </div>
  );
}

export function buildLocalEvidence(input: {
  claim: DraftClaim;
  runId: string;
  draftId: string;
  sourceUrl: string;
  snippet: string;
}): ContentEvidence {
  const claimSlug = input.claim.claimId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    id: `evidence-${Date.now().toString(36)}-${claimSlug}`,
    claimId: input.claim.claimId,
    runId: input.runId,
    draftId: input.draftId,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceUrl,
    snippet: input.snippet,
    note: "Attached in Content Studio.",
    createdAt: new Date().toISOString(),
  };
}
