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
}

interface LintReport {
  orphans: string[];
  brokenLinks: Array<{ source: string; target: string }>;
  stale: string[];
}

const STALE_DAYS = 30;

export function HealthSurface({
  profile = "default",
}: HealthSurfaceProps): React.JSX.Element {
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const [report, setReport] = useState<LintReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <header
        style={{
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <h1
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 24,
            margin: 0,
            flex: 1,
          }}
        >
          <Icon name="check" size={22} />
          Vault health
        </h1>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => void run()}
          style={{
            padding: "7px 14px",
            borderRadius: 7,
            border: "none",
            background: "var(--accent, #2d7ff9)",
            color: "#fff",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Checking…" : "Re-check"}
        </button>
      </header>

      {error && (
        <div style={{ color: "var(--danger, #c0392b)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {report && total === 0 && !error && (
        <div style={{ color: "var(--tx-4)", padding: "24px 0" }}>
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
              <li key={`${b.source}-${b.target}-${i}`} style={rowStyle}>
                <button style={linkStyle} onClick={() => open(b.source)}>
                  {pageIdFromPath(b.source)}
                </button>
                <span style={{ color: "var(--tx-4)" }}>→</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  [[{b.target}]]
                </span>
              </li>
            ))}
          </LintGroup>

          <LintGroup
            label="Orphans"
            hint="Pages with no links in or out"
            count={report.orphans.length}
          >
            {report.orphans.map((p) => (
              <li key={p} style={rowStyle}>
                <button style={linkStyle} onClick={() => open(p)}>
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
              <li key={p} style={rowStyle}>
                <button style={linkStyle} onClick={() => open(p)}>
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
    <section style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span
          style={{
            background: "var(--bd-1, rgba(0,0,0,0.06))",
            borderRadius: 10,
            padding: "1px 8px",
            fontSize: 12,
          }}
        >
          {count}
        </span>
        <span style={{ color: "var(--tx-4)", fontSize: 12 }}>{hint}</span>
      </div>
      {count === 0 ? (
        <div style={{ color: "var(--tx-4)", fontSize: 13 }}>None</div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {children}
        </ul>
      )}
    </section>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const linkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--accent, #2d7ff9)",
  cursor: "pointer",
  padding: 0,
  fontSize: 14,
};
