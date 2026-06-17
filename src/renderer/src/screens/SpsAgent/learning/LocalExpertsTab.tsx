import type { LocalExpertPackSummary } from "../../../../../shared/local-experts";

function tierLabel(tier: string): string {
  const labels: Record<string, string> = {
    apple_official: "Apple official",
    developer_official: "Apple developer",
    standards_project: "Standards project",
    mac_admin: "Mac admin",
    community_reference: "Community reference",
  };
  return labels[tier] || tier;
}

export function LocalExpertsTab(props: {
  packs: LocalExpertPackSummary[];
  installExpert: (packId: string) => void;
  uninstallExpert: (packId: string) => void;
  busy: string;
}): React.JSX.Element {
  return (
    <section className="settings-section">
      <div className="settings-section-title">Local experts</div>
      <div className="settings-field-hint learning-surface-hint">
        Install source-backed expert packs for My Assistant. V1 experts are
        guidance-only and write cited records into your local workspace.
      </div>
      {props.packs.length === 0 ? (
        <div className="memory-empty learning-surface-empty-mt">
          No local expert packs available.
        </div>
      ) : (
        <div className="you-rules-list learning-surface-list-mt">
          {props.packs.map((pack) => (
            <div key={pack.id} className="memory-entry-card">
              <span className="memory-entry-content">
                <strong>{pack.title}</strong>
                <small className="learning-surface-small-block">
                  {pack.description}
                </small>
                <small className="learning-surface-small-block">
                  {pack.recordCount} records -{" "}
                  {pack.sourceTiers.map(tierLabel).join(", ")}
                </small>
                <small className="learning-surface-small-block">
                  {pack.installed ? "Installed" : "Not installed"} - guidance
                  only
                </small>
                {pack.recordsLeftInVault && (
                  <small className="learning-surface-small-block">
                    Vault records were preserved after uninstall.
                  </small>
                )}
              </span>
              {pack.installed ? (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={props.busy === `expert-${pack.id}`}
                  onClick={() => props.uninstallExpert(pack.id)}
                >
                  Remove
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={props.busy === `expert-${pack.id}`}
                  onClick={() => props.installExpert(pack.id)}
                >
                  Install
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
