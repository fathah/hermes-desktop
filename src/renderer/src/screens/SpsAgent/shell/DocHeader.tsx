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
import { prettyDate } from "../lib/journalDates";

interface HealthErrors {
  isOrphan: boolean;
  isStale: boolean;
  brokenLinks: string[];
}

type HealthSeverity = "info" | "warning";

function isDraftLikeUntitledPage(title: string, contentEmpty: boolean) {
  if (!contentEmpty) return false;
  const normalized = title.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "untitled" ||
    normalized === "untitled page" ||
    normalized === "untitled entry"
  );
}

function HealthBadge({ errors }: { errors: HealthErrors }) {
  const [open, setOpen] = useState(false);

  const list: string[] = [];
  if (errors.isOrphan) {
    list.push(
      "This page is not connected to the graph yet. Add a wikilink when it belongs with other notes.",
    );
  }
  if (errors.isStale) {
    list.push("Stale page: this page has not been edited for over 30 days.");
  }
  errors.brokenLinks.forEach((target) => {
    list.push(`Broken link: points to non-existent page [[${target}]].`);
  });

  const severity: HealthSeverity =
    errors.isStale || errors.brokenLinks.length > 0 ? "warning" : "info";
  const label = severity === "warning" ? "Needs review" : "Unlinked";
  const popoverTitle =
    severity === "warning" ? "Vault Health Issues" : "Connection Suggestion";

  return (
    <div
      className="doc-health-badge-container"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="doc-health-badge"
        data-severity={severity}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon
          name={severity === "warning" ? "info" : "pageGraph"}
          size={13}
          stroke={1.9}
        />
        {label}
      </button>

      {open && (
        <div className="doc-health-popover" data-severity={severity}>
          <div className="doc-health-popover-title">{popoverTitle}</div>
          {list.map((msg, i) => (
            <div key={i} className="doc-health-issue-row">
              <span className="doc-health-issue-bullet">•</span>
              <span>{msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MOOD_LABELS: Record<string, string> = {
  "😄": "Happy",
  "🙂": "Good",
  "😐": "Neutral",
  "😔": "Sad",
  "😣": "Stressed",
  "😡": "Angry",
  "🥱": "Tired",
  "❤️": "Loved",
};

export function DocHeader({
  children,
  onOpenLiveNote,
}: {
  children?: ReactNode;
  onOpenLiveNote?: () => void;
}) {
  const page = useStore((s) => s.page);
  const pmeta = useStore(selectPmeta);
  const blocks = useStore(selectCurrentBlocks);
  const tree = useStore((s) => s.tree);
  const setPMeta = useStore((s) => s.setPMeta);
  const setCoverPick = useStore((s) => s.setCoverPick);
  const setResearchOpen = useStore((s) => s.setResearchOpen);

  const [lintErrors, setLintErrors] = useState<HealthErrors | null>(null);
  const isLiveNote = pmeta.properties?.kind === "live-note";

  // Empty page = no title and no real content (0–1 empty blocks). Mirror
  // Notion's empty-state launcher here, above the editor body.
  const titleEmpty = !(pmeta.title || "").trim();
  const contentEmpty =
    blocks.length === 0 ||
    (blocks.length === 1 && !(blocks[0].text || "").trim());
  const showGetStarted = titleEmpty && contentEmpty;
  const suppressOrphanOnly = isDraftLikeUntitledPage(
    pmeta.title || "",
    contentEmpty,
  );

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
            const isOrphan =
              (res.orphans || []).some((p) => pageIdFromPath(p) === page) &&
              !suppressOrphanOnly;
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
  }, [page, suppressOrphanOnly]);

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
          <div className="cover-fill" data-cover-bg={pmeta.cover} />
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
          <div className="doc-title-row">
            <div
              className="doc-title"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onInput={(e) =>
                setPMeta({ title: e.currentTarget.textContent || "" })
              }
              key={page}
            >
              {pmeta.title}
            </div>
            {lintErrors && <HealthBadge errors={lintErrors} />}
            {onOpenLiveNote && (
              <button
                type="button"
                className="cover-btn"
                title={
                  isLiveNote ? "Live note settings" : "Make this note live"
                }
                onClick={onOpenLiveNote}
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Icon name="sparkle" size={13} />
                {isLiveNote ? "Live" : "Live…"}
              </button>
            )}
          </div>
          {pmeta.journal ? (
            <div className="jr-entry-header">
              <div className="jr-meta-badge date-time">
                <Icon name="calendar" size={13} />
                <span>{pmeta.date ? prettyDate(pmeta.date) : "No date"}</span>
                {pmeta.time && (
                  <span className="jr-meta-time">at {pmeta.time}</span>
                )}
              </div>
              {pmeta.mood && (
                <div className="jr-meta-badge mood">
                  <span className="mood-emoji">{pmeta.mood}</span>
                  <span className="mood-label">
                    {MOOD_LABELS[pmeta.mood] || "Reflective"}
                  </span>
                </div>
              )}
              {pmeta.tags && pmeta.tags.length > 0 && (
                <div className="jr-meta-tags">
                  {pmeta.tags.map((tag) => (
                    <span key={tag} className="jr-meta-tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="doc-meta">
              <span>
                Edited <b>just now</b>
              </span>
              <span>Saved locally</span>
            </div>
          )}
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
