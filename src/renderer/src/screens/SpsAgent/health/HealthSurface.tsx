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
import { commitChangeset } from "../inbox/ingestApply";
import {
  getLintIntervalMin,
  refreshSpsAutomationPrefs,
  setLintIntervalMin,
} from "../inbox/ingestPrefs";
import { RoutinesStatusPanel } from "./RoutinesStatusPanel";
import type {
  VaultHealthReport,
  VaultLinkEdge,
} from "../../../../../shared/sps-types";

interface HealthSurfaceProps {
  profile?: string;
  embedded?: boolean;
}

/** The deep-lint result returned by spsLintWiki (mirrors the main LintResult). */
type DeepLint = NonNullable<
  Awaited<ReturnType<NonNullable<typeof window.hermesAPI.spsLintWiki>>>
>;

const STALE_DAYS = 30;

function brokenLinkLabel(link: VaultLinkEdge): string {
  const fragment = link.targetBlockId
    ? `#^${link.targetBlockId}`
    : link.targetHeading
      ? `#${link.targetHeading}`
      : "";
  const wikilink = `${link.kind === "embed" ? "!" : ""}[[${link.target}${fragment}]]`;
  return link.type && link.type !== "link" && link.type !== "embed"
    ? `${link.type}:: ${wikilink}`
    : wikilink;
}

export function HealthSurface({
  profile = "default",
  embedded = false,
}: HealthSurfaceProps): React.JSX.Element {
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const flash = useStore((s) => s.flash);
  const pendingApprovals = useStore((s) => s.workApprovals.queue.length);
  const [report, setReport] = useState<VaultHealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Deep (LLM) lint: contradictions / stale claims / gaps + a proposed fix set.
  const [deep, setDeep] = useState<DeepLint | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [lintEvery, setLintEvery] = useState(() => getLintIntervalMin());
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
      const res = await window.hermesAPI.spsHealthReport?.(STALE_DAYS, profile);
      if (!res) throw new Error("Vault health is unavailable offline.");
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

  useEffect(() => {
    let cancelled = false;
    void refreshSpsAutomationPrefs(profile).then((prefs) => {
      if (!cancelled) setLintEvery(prefs.lintIntervalMin);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const runDeep = useCallback(async () => {
    setDeepBusy(true);
    setApplied(false);
    setError("");
    try {
      const res = await window.hermesAPI.spsLintWiki?.(STALE_DAYS, profile);
      if (!res) throw new Error("Deep lint is unavailable offline.");
      if (!res.ok) throw new Error(res.error || "Deep lint failed.");
      setDeep(res);
      if (res.changeset?.pages.length) {
        await window.hermesAPI.spsCreateVaultProposal?.(
          {
            source: "health",
            title: "Vault health fixes",
            summary: res.changeset.summary,
            operations: res.changeset.pages.map((page) => ({
              id: `lint-${page.pageId}`,
              kind: "upsert-page" as const,
              pageId: page.pageId,
              title: page.title,
              markdown: page.markdown,
            })),
          },
          profile,
        );
        flash("Queued vault health fixes for review");
        setSurface("review");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeepBusy(false);
    }
  }, [profile, flash, setSurface]);

  const applyFixes = useCallback(async () => {
    if (!deep?.changeset) return;
    setApplying(true);
    try {
      const { pages } = await commitChangeset(
        deep.changeset,
        ingestCommitPage,
        {
          profile,
        },
      );
      await window.hermesAPI.spsAppendWikiLog?.(
        "lint",
        deep.changeset.summary,
        profile,
      );
      setApplied(true);
      flash(`Applied ${pages} lint fix${pages === 1 ? "" : "es"}`);
      void run(); // refresh the mechanical report after fixing
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't apply fixes", {
        tone: "warn",
      });
    } finally {
      setApplying(false);
    }
  }, [deep, ingestCommitPage, profile, flash, run]);

  const open = (relPath: string): void => {
    selectPage(pageIdFromPath(relPath));
    setSurface("doc");
  };

  const total =
    (report?.orphans.length ?? 0) +
    (report?.brokenLinks.length ?? 0) +
    (report?.stale.length ?? 0) +
    (report?.duplicateTitles.length ?? 0) +
    (report?.duplicateAliases.length ?? 0) +
    (report?.missingSchemaFields.length ?? 0) +
    (report?.staleCaptures.length ?? 0) +
    (report?.unprocessedPdfs.length ?? 0) +
    (report?.weaklyConnected.length ?? 0);

  return (
    <div className={embedded ? "health-embedded" : "health-surface"}>
      <header
        className="health-header"
        style={embedded ? { marginTop: 0, border: "none" } : undefined}
      >
        {!embedded && (
          <h1 className="health-title">
            <Icon name="check" size={22} />
            Vault health
          </h1>
        )}
        <div
          className="health-header-actions"
          style={embedded ? { marginLeft: "auto" } : undefined}
        >
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
          <button
            className="health-recheck-btn"
            disabled={deepBusy}
            onClick={() => void runDeep()}
            title="Use the AI to find contradictions, stale claims, and gaps — and propose fixes you can review"
          >
            <Icon name="sparkle" size={14} />
            {deepBusy ? "Analyzing…" : "Deep lint (AI)"}
          </button>
          <label
            className="health-sec-hint"
            style={{ display: "flex", alignItems: "center", gap: 4 }}
            title="Run deep lint automatically; it queues reviewable fixes and never auto-edits."
          >
            Auto
            <select
              value={lintEvery}
              onChange={(e) => {
                const m = Number(e.target.value);
                setLintIntervalMin(m, profile);
                setLintEvery(m);
              }}
            >
              <option value={0}>Off</option>
              <option value={60}>Hourly</option>
              <option value={360}>Every 6h</option>
              <option value={1440}>Daily</option>
            </select>
          </label>
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
            results, semantic links, and My Assistant&apos;s memory (RAG).
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

      <RoutinesStatusPanel
        profile={profile}
        pendingApprovals={pendingApprovals}
      />

      {report && total === 0 && !error && (
        <div className="health-empty">
          Everything looks healthy — no structural vault issues found.
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
                <span className="health-mono-text">{brokenLinkLabel(b)}</span>
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

          <LintGroup
            label="Duplicate titles"
            hint="Multiple notes with the same title"
            count={report.duplicateTitles.length}
          >
            {report.duplicateTitles.map((d) => (
              <li key={d.title} className="health-row">
                <span className="health-mono-text">{d.title}</span>
                <span className="health-arrow">·</span>
                <span>{d.paths.map(pageIdFromPath).join(", ")}</span>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Duplicate aliases"
            hint="Aliases shared by more than one note"
            count={report.duplicateAliases.length}
          >
            {report.duplicateAliases.map((d) => (
              <li key={d.alias} className="health-row">
                <span className="health-mono-text">{d.alias}</span>
                <span className="health-arrow">·</span>
                <span>{d.paths.map(pageIdFromPath).join(", ")}</span>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Missing schema fields"
            hint="Typed notes missing required properties"
            count={report.missingSchemaFields.length}
          >
            {report.missingSchemaFields.map((row) => (
              <li
                key={`${row.path}-${row.missing.join(",")}`}
                className="health-row"
              >
                <button className="health-link" onClick={() => open(row.path)}>
                  {pageIdFromPath(row.path)}
                </button>
                <span className="health-arrow">·</span>
                <span>
                  {row.schema}: {row.missing.join(", ")}
                </span>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Stale inbox captures"
            hint="Raw captures still waiting to become durable notes"
            count={report.staleCaptures.length}
          >
            {report.staleCaptures.map((row) => (
              <li key={row.path} className="health-row">
                <button className="health-link" onClick={() => open(row.path)}>
                  {row.title || pageIdFromPath(row.path)}
                </button>
                <span className="health-arrow">·</span>
                <span>{row.ageDays}d old</span>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Unprocessed PDFs"
            hint="PDF source notes that have not been processed"
            count={report.unprocessedPdfs.length}
          >
            {report.unprocessedPdfs.map((row) => (
              <li key={row.path} className="health-row">
                <button className="health-link" onClick={() => open(row.path)}>
                  {row.title || pageIdFromPath(row.path)}
                </button>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Weakly connected"
            hint="Notes with very few graph connections"
            count={report.weaklyConnected.length}
          >
            {report.weaklyConnected.map((row) => (
              <li key={row.path} className="health-row">
                <button className="health-link" onClick={() => open(row.path)}>
                  {pageIdFromPath(row.path)}
                </button>
                <span className="health-arrow">·</span>
                <span>degree {row.degree}</span>
              </li>
            ))}
          </LintGroup>
        </>
      )}

      {deep && (
        <section className="health-section">
          <div className="health-sec-header">
            <span className="health-sec-label">
              <Icon name="sparkle" size={13} /> AI findings
            </span>
            <span className="health-sec-count">{deep.findings.length}</span>
            <span className="health-sec-hint">
              contradictions, stale claims, gaps & missing links
            </span>
          </div>

          {deep.findings.length === 0 ? (
            <div className="health-sec-hint">
              No semantic issues found across {deep.pagesScanned} page
              {deep.pagesScanned === 1 ? "" : "s"}.
            </div>
          ) : (
            <ul className="health-list">
              {deep.findings.map((f, i) => (
                <li key={`${f.page}-${i}`} className="health-row">
                  <span className="health-mono-text">{f.kind}</span>
                  {f.page && (
                    <>
                      <span className="health-arrow">·</span>
                      <button
                        className="health-link"
                        onClick={() => open(f.page)}
                      >
                        {pageIdFromPath(f.page)}
                      </button>
                    </>
                  )}
                  <span className="health-arrow">—</span>
                  <span>{f.note}</span>
                </li>
              ))}
            </ul>
          )}

          {deep.changeset && deep.changeset.pages.length > 0 && (
            <div className="health-sec-fixes" style={{ marginTop: 8 }}>
              <div className="health-sec-hint">
                {deep.changeset.summary} — {deep.changeset.pages.length} page
                {deep.changeset.pages.length === 1 ? "" : "s"} would be updated:
              </div>
              <ul className="health-list">
                {deep.changeset.pages.map((p) => (
                  <li key={p.pageId} className="health-row">
                    <button
                      className="health-link"
                      onClick={() => open(p.pageId)}
                    >
                      {p.title || p.pageId}
                    </button>
                  </li>
                ))}
              </ul>
              {applied ? (
                <span className="applied-note">
                  <Icon name="check" size={14} /> Fixes applied
                </span>
              ) : (
                <button
                  className="health-recheck-btn"
                  disabled={applying}
                  onClick={() => void applyFixes()}
                >
                  {applying ? "Applying…" : "Review & apply fixes"}
                </button>
              )}
            </div>
          )}

          {deep.pagesDropped > 0 && (
            <div className="health-sec-hint" style={{ marginTop: 6 }}>
              Note: {deep.pagesDropped} page
              {deep.pagesDropped === 1 ? " was" : "s were"} not scanned this
              pass (coverage cap). Re-run after fixing to scan more.
            </div>
          )}
        </section>
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
