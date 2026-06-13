// DocHeader.tsx — page cover, icon, editable title and meta row, wrapping the
// document body (the Editor) inside the same .doc-head-inner as the prototype.
// Emoji/cover pickers render in Phase 5; here the buttons set picker coordinates.
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { GetStarted } from "../components/GetStarted";
import { useStore } from "../store";
import { treeFind } from "../lib/tree";
import { selectCurrentBlocks, selectPmeta } from "../store/selectors";

interface HealthErrors {
  isOrphan: boolean;
  isStale: boolean;
  brokenLinks: string[];
}

function HealthBadge({ errors }: { errors: HealthErrors }) {
  const [open, setOpen] = useState(false);

  const list: string[] = [];
  if (errors.isOrphan) {
    list.push("Orphan page: this page has no inbound/outbound links.");
  }
  if (errors.isStale) {
    list.push(
      "Stale page: this page has not been edited for over 30 days.",
    );
  }
  errors.brokenLinks.forEach((target) => {
    list.push(`Broken link: points to non-existent page [[${target}]].`);
  });

  return (
    <div
      className="doc-health-badge-container"
      style={{ position: "relative" }}
    >
      <button
        type="button"
        className="doc-health-badge"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          background: "rgba(229, 72, 77, 0.15)",
          color: "#e5484d",
          border: "1px solid rgba(229, 72, 77, 0.3)",
          borderRadius: "12px",
          padding: "4px 8px",
          fontSize: "12px",
          fontWeight: "600",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ fontSize: "14px" }}>⚠️</span> Warning
      </button>

      {open && (
        <div
          className="doc-health-popover"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "280px",
            background: "var(--surface)",
            border: "1px solid var(--hair-strong)",
            borderRadius: "8px",
            padding: "12px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
            zIndex: 100,
            fontSize: "12px",
            color: "var(--tx-1)",
            lineHeight: "1.4",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontWeight: "600",
              borderBottom: "1px solid var(--hair-soft)",
              paddingBottom: "6px",
              marginBottom: "4px",
            }}
          >
            Vault Health Issues
          </div>
          {list.map((msg, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
            >
              <span style={{ color: "#e5484d" }}>•</span>
              <span>{msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocHeader({ children }: { children?: ReactNode }) {
  const page = useStore((s) => s.page);
  const pmeta = useStore(selectPmeta);
  const blocks = useStore(selectCurrentBlocks);
  const tree = useStore((s) => s.tree);
  const setPMeta = useStore((s) => s.setPMeta);
  const setCoverPick = useStore((s) => s.setCoverPick);
  const setResearchOpen = useStore((s) => s.setResearchOpen);

  const [lintErrors, setLintErrors] = useState<HealthErrors | null>(null);

  // Fetch page lint errors on load / page switch
  useEffect(() => {
    let active = true;
    if (window.hermesAPI?.spsLintVault) {
      window.hermesAPI
        .spsLintVault(30)
        .then((res) => {
          if (!active) return;
          if (res) {
            const pageIdFromPath = (path: string): string => {
              const basename = path.split("/").pop() ?? "";
              return basename.replace(/\.md$/, "");
            };
            const isOrphan = (res.orphans || []).some(
              (p) => pageIdFromPath(p) === page,
            );
            const isStale = (res.stale || []).some(
              (p) => pageIdFromPath(p) === page,
            );
            const myBrokenLinks = (res.brokenLinks || [])
              .filter((b) => pageIdFromPath(b.source) === page)
              .map((b) => b.target);

            if (isOrphan || isStale || myBrokenLinks.length > 0) {
              setLintErrors({ isOrphan, isStale, brokenLinks: myBrokenLinks });
            } else {
              setLintErrors(null);
            }
          } else {
            setLintErrors(null);
          }
        })
        .catch((err) => {
          console.error("spsLintVault error in DocHeader", err);
          if (active) setLintErrors(null);
        });
    }
    return () => {
      active = false;
    };
  }, [page]);

  // Empty page = no title and no real content (0–1 empty blocks). Mirror
  // Notion's empty-state launcher here, above the editor body.
  const titleEmpty = !(pmeta.title || "").trim();
  const contentEmpty =
    blocks.length === 0 ||
    (blocks.length === 1 && !(blocks[0].text || "").trim());
  const showGetStarted = titleEmpty && contentEmpty;

  // Research folder with no saved papers yet → an on-ramp that teaches its own
  // use (mirrors the GetStarted launcher, but specific to the Research surface).
  const node = treeFind(tree, page);
  const showResearchNudge =
    (pmeta.title || "").trim() === "Research" &&
    !!node &&
    node.children.length === 0;

  return (
    <>
      {pmeta.cover && (
        <div className="doc-cover">
          {pmeta.cover === "image" ? (
            <div
              className="cover-fill"
              style={{ background: "var(--sunk)" }}
            />
          ) : (
            <div className="cover-fill" style={{ background: pmeta.cover }} />
          )}
          <div className="cover-tools">
            <button
              className="cover-btn"
              onClick={(e) =>
                setCoverPick({
                  x: e.currentTarget.getBoundingClientRect().left - 180,
                  y: e.currentTarget.getBoundingClientRect().bottom + 6,
                })
              }
            >
              <Icon name="callout" size={13} /> Change cover
            </button>
            <button
              className="cover-btn"
              onClick={() => setPMeta({ cover: null })}
            >
              Remove
            </button>
          </div>
        </div>
      )}
      <div className={`doc ${pmeta.cover ? "has-cover" : ""}`}>
        <div className="doc-head-inner">
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              className="doc-title"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onInput={(e) =>
                setPMeta({ title: e.currentTarget.textContent || "" })
              }
              key={page}
              style={{ flex: 1 }}
            >
              {pmeta.title}
            </div>
            {lintErrors && <HealthBadge errors={lintErrors} />}
          </div>
          <div className="doc-meta">
            <span>
              Edited <b>just now</b>
            </span>
            <span>Saved locally</span>
          </div>
          {showGetStarted && <GetStarted />}
          {showResearchNudge && (
            <div className="gs-row">
              <div className="gs-label">No papers yet</div>
              <div className="gs-chips">
                <button
                  className="gs-chip"
                  onClick={() => setResearchOpen(true)}
                  title="Search OpenAlex"
                >
                  <Icon name="search" size={15} />
                  <span>Search for papers</span>
                </button>
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </>
  );
}

