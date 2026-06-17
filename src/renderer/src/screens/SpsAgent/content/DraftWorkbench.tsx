import type { DraftVariant } from "../../../../../shared/content-studio";

interface Props {
  draftText: string;
  variants: DraftVariant[];
  qualityMessage: string;
  onDraftTextChange: (value: string) => void;
  onApproveDraft: () => void;
  onApproveVariant: (variant: DraftVariant) => void;
}

export function DraftWorkbench({
  draftText,
  variants,
  qualityMessage,
  onDraftTextChange,
  onApproveDraft,
  onApproveVariant,
  children,
}: React.PropsWithChildren<Props>): React.JSX.Element {
  return (
    <section className="active-work-section" id="content-studio-panel-evidence">
      <h2>Draft Workbench</h2>
      {variants.length > 0 && (
        <div className="content-studio-variant-grid">
          {variants.map((variant) => (
            <article key={variant.id} className="content-studio-variant-card">
              <strong>{variant.title}</strong>
              <span>{variant.hookRoute}</span>
              <p>{variant.text}</p>
              {variant.assetBrief && <small>{variant.assetBrief}</small>}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onApproveVariant(variant)}
              >
                Approve variant
              </button>
            </article>
          ))}
        </div>
      )}
      <textarea
        className="memory-entry-textarea"
        aria-label="Final draft"
        rows={5}
        value={draftText}
        onChange={(event) => onDraftTextChange(event.target.value)}
        placeholder="Paste or merge the final approved draft here before publishing manually."
      />
      {children}
      <button className="btn btn-primary btn-sm" onClick={onApproveDraft}>
        Approve final draft
      </button>
      {qualityMessage && (
        <div className="content-studio-quality">{qualityMessage}</div>
      )}
    </section>
  );
}
