// HealthSurface.tsx — the vault "Lint" surface (Karpathy LLM-Wiki "Lint").
//
// Surfaces structural problems the note-index can derive deterministically:
//   • orphans     — pages with no inbound or outbound [[wikilinks]]
//   • broken links — [[wikilinks]] whose target page doesn't exist
//   • stale       — pages untouched for longer than the chosen window
// Read-only: it only reports. Clicking a page opens it so the user can fix it.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { pageIdFromPath } from "../lib/pageId";

interface HealthSurfaceProps {
  profile?: string;
  embedded?: boolean;
}

interface LintReport {
  orphans: string[];
  brokenLinks: Array<{ source: string; target: string }>;
  stale: string[];
}

const STALE_DAYS = 30;

export function HealthSurface({
  profile = "default",
  embedded = false,
}: HealthSurfaceProps): React.JSX.Element {
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const [report, setReport] = useState<LintReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState<boolean>(() => {
    const saved = localStorage.getItem("hermes_vault_health_help_visible");
    return saved !== "false";
  });

  const toggleHelp = (): void => {
    const next = !showHelp;
    setShowHelp(next);
    localStorage.setItem("hermes_vault_health_help_visible", String(next));
  };

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await window.hermesAPI.spsLintVault?.(STALE_DAYS, profile);
      if (!res) throw new Error("Lint is unavailable offline.");
      setReport(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [profile]);

  useEffect(() => {
    run();
  }, [run]);

  const open = (relPath: string): void => {
    selectPage(pageIdFromPath(relPath));
    setSurface("doc");
  };

  const total =
    (report?.orphans.length ?? 0) +
    (report?.brokenLinks.length ?? 0) +
    (report?.stale.length ?? 0);

  return (
    <div className={embedded ? "health-embedded" : "health-surface"}>
      <header className="health-header" style={embedded ? { marginTop: 0, border: "none" } : undefined}>
        {!embedded && (
          <h1 className="health-title">
            <Icon name="check" size={22} />
            Vault health
          </h1>
        )}
        <div className="health-header-actions" style={embedded ? { marginLeft: "auto" } : undefined}>
          <button
            className="health-help-btn"
            onClick={toggleHelp}
            title={showHelp ? "Hide Guide" : "Show Guide"}
          >
            <Icon name="info" size={15} style={{ strokeWidth: 2 }} />
            {showHelp ? "Hide Guide" : "Guide"}
          </button>
          <button
            className="health-recheck-btn"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "Checking…" : "Re-check"}
          </button>
        </div>
      </header>

      {showHelp && (
        <div className="health-help-card">
          <div className="health-help-card-header">
            <span className="health-help-card-title">
              <Icon name="info" size={16} />
              Vault Health Guide
            </span>
            <button
              className="health-help-card-close"
              onClick={toggleHelp}
              title="Close guide"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <p className="health-help-intro">
            A healthy knowledge vault has clear connections between ideas.
            Fixing issues on this page directly improves the accuracy of search
            results, semantic links, and your AI Agent&apos;s memory (RAG).
          </p>
          <div className="health-help-grid">
            <div className="health-help-item">
              <span className="health-help-item-title">Broken Links</span>
              <span className="health-help-item-desc">
                Links pointing to pages that don&apos;t exist. Fix them by
                creating the missing note or correcting the link text.
              </span>
            </div>
            <div className="health-help-item">
              <span className="health-help-item-title">Orphans</span>
              <span className="health-help-item-desc">
                Pages with zero incoming or outgoing links. Connect them to
                related topics so the AI and you can easily discover them.
              </span>
            </div>
            <div className="health-help-item">
              <span className="health-help-item-title">Stale Pages</span>
              <span className="health-help-item-desc">
                Pages untouched for over 30 days. Review them to decide if the
                information needs updating or is no longer relevant.
              </span>
            </div>
          </div>
        </div>
      )}

      {error && <div className="health-error">{error}</div>}

      {report && total === 0 && !error && (
        <div className="health-empty">
          Everything looks healthy — no orphans, broken links, or stale pages.
        </div>
      )}

      {report && (
        <>
          <LintGroup
            label="Broken links"
            hint="Wikilinks pointing at a page that doesn't exist"
            count={report.brokenLinks.length}
          >
            {report.brokenLinks.map((b, i) => (
              <li key={`${b.source}-${b.target}-${i}`} className="health-row">
                <button className="health-link" onClick={() => open(b.source)}>
                  {pageIdFromPath(b.source)}
                </button>
                <span className="health-arrow">→</span>
                <span className="health-mono-text">[[{b.target}]]</span>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Orphans"
            hint="Pages with no links in or out"
            count={report.orphans.length}
          >
            {report.orphans.map((p) => (
              <li key={p} className="health-row">
                <button className="health-link" onClick={() => open(p)}>
                  {pageIdFromPath(p)}
                </button>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label={`Stale (>${STALE_DAYS}d)`}
            hint="Pages not edited recently"
            count={report.stale.length}
          >
            {report.stale.map((p) => (
              <li key={p} className="health-row">
                <button className="health-link" onClick={() => open(p)}>
                  {pageIdFromPath(p)}
                </button>
              </li>
            ))}
          </LintGroup>
        </>
      )}
    </div>
  );
}

function LintGroup({
  label,
  hint,
  count,
  children,
}: {
  label: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="health-section">
      <div className="health-sec-header">
        <span className="health-sec-label">{label}</span>
        <span className="health-sec-count">{count}</span>
        <span className="health-sec-hint">{hint}</span>
      </div>
      {count === 0 ? (
        <div className="health-sec-hint">None</div>
      ) : (
        <ul className="health-list">{children}</ul>
      )}
    </section>
  );
}
