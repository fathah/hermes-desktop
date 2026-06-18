import { useState } from "react";
import type {
  LocalExpertCheckRunResult,
  LocalExpertPackDetailResult,
  LocalExpertPackSummary,
} from "../../../../../shared/local-experts";

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
  selectedPackId: string;
  selectExpert: (packId: string) => void;
  detail: LocalExpertPackDetailResult | null;
  installExpert: (packId: string) => void;
  uninstallExpert: (packId: string) => void;
  importPath: string;
  setImportPath: (value: string) => void;
  previewImport: () => void;
  importPack: () => void;
  exportPath: string;
  setExportPath: (value: string) => void;
  exportPack: (packId: string) => void;
  enableChecks: (packId: string) => void;
  runChecks: (packId: string) => void;
  checkRun: LocalExpertCheckRunResult | null;
  busy: string;
}): React.JSX.Element {
  const [topicFilter, setTopicFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const records = props.detail?.pack?.records || [];
  const topics = [...new Set(records.map((record) => record.topic))].sort();
  const filteredRecords = records.filter(
    (record) =>
      (topicFilter === "all" || record.topic === topicFilter) &&
      (riskFilter === "all" || record.risk === riskFilter),
  );

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
            <div
              key={pack.id}
              className={`memory-entry-card ${
                props.selectedPackId === pack.id ? "active" : ""
              }`}
            >
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
                  {pack.installed ? "Installed" : "Not installed"} - freshness{" "}
                  {pack.freshness.status} - guidance only
                </small>
                {pack.packHash && (
                  <small className="learning-surface-small-block">
                    Pack hash {pack.packHash.slice(0, 12)}
                  </small>
                )}
                {pack.recordsLeftInVault && (
                  <small className="learning-surface-small-block">
                    Vault records were preserved after uninstall.
                  </small>
                )}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => props.selectExpert(pack.id)}
              >
                View
              </button>
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
      {props.detail?.ok && props.detail.pack && (
        <div className="settings-section learning-surface-list-mt">
          <div className="settings-section-title">Pack detail</div>
          <div className="settings-field-hint learning-surface-hint">
            {props.detail.pack.title} - {props.detail.pack.version} -{" "}
            {props.detail.freshness?.status || "unknown"} freshness
          </div>
          <div className="you-rules-list learning-surface-list-mt">
            <div className="memory-entry-card">
              <span className="memory-entry-content">
                <strong>Install provenance</strong>
                <small className="learning-surface-small-block">
                  Recipe {props.detail.installState?.recipeId || "not created"}
                </small>
                <small className="learning-surface-small-block">
                  Skill {props.detail.installState?.skillPath || "not created"}
                </small>
                <small className="learning-surface-small-block">
                  Sources {props.detail.installState?.sourceCount || 0} -
                  records {props.detail.pack.records.length}
                </small>
              </span>
              {!props.detail.installState?.checksEnabled ? (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={props.busy === "enable-expert-checks"}
                  onClick={() => props.enableChecks(props.detail!.packId)}
                >
                  Enable checks
                </button>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={props.busy === "run-expert-checks"}
                  onClick={() => props.runChecks(props.detail!.packId)}
                >
                  Run checks
                </button>
              )}
            </div>
          </div>

          <div className="settings-grid learning-surface-list-mt">
            <label className="settings-field">
              <span>Import pack path</span>
              <input
                value={props.importPath}
                onChange={(event) => props.setImportPath(event.target.value)}
                placeholder="/path/to/expert-pack.json"
              />
            </label>
            <div className="learning-surface-inline-actions">
              <button
                className="btn btn-secondary btn-sm"
                disabled={
                  !props.importPath.trim() ||
                  props.busy === "preview-expert-import"
                }
                onClick={props.previewImport}
              >
                Preview import
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={
                  !props.importPath.trim() || props.busy === "import-expert"
                }
                onClick={props.importPack}
              >
                Import pack
              </button>
            </div>
            <label className="settings-field">
              <span>Export pack path</span>
              <input
                value={props.exportPath}
                onChange={(event) => props.setExportPath(event.target.value)}
                placeholder="/path/to/exported-pack.json"
              />
            </label>
            <button
              className="btn btn-secondary btn-sm"
              disabled={
                !props.exportPath.trim() || props.busy === "export-expert"
              }
              onClick={() => props.exportPack(props.detail!.packId)}
            >
              Export pack
            </button>
          </div>

          {props.checkRun && (
            <div className="memory-entry-card learning-surface-list-mt">
              <span className="memory-entry-content">
                <strong>Read-only check results</strong>
                {props.checkRun.results.map((result) => (
                  <small
                    key={result.id}
                    className="learning-surface-small-block"
                  >
                    {result.title}: {result.status}
                    {result.stdout ? ` - ${result.stdout}` : ""}
                  </small>
                ))}
              </span>
            </div>
          )}

          <div className="settings-grid learning-surface-list-mt">
            <label className="settings-field">
              <span>Topic filter</span>
              <select
                value={topicFilter}
                onChange={(event) => setTopicFilter(event.target.value)}
              >
                <option value="all">All topics</option>
                {topics.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Risk filter</span>
              <select
                value={riskFilter}
                onChange={(event) => setRiskFilter(event.target.value)}
              >
                <option value="all">All risks</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="you-rules-list learning-surface-list-mt">
            {filteredRecords.map((record) => (
              <div key={record.id} className="memory-entry-card">
                <span className="memory-entry-content">
                  <strong>{record.title}</strong>
                  <small className="learning-surface-small-block">
                    {record.topic} - {record.risk} risk -{" "}
                    {tierLabel(record.sourceTier)}
                  </small>
                  <small className="learning-surface-small-block">
                    {record.sourceUrls.join(", ")}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
