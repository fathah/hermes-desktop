// DocHeader.tsx — page cover, icon, editable title and meta row, wrapping the
// document body (the Editor) inside the same .doc-head-inner as the prototype.
// Emoji/cover pickers render in Phase 5; here the buttons set picker coordinates.
import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { GetStarted } from "../components/GetStarted";
import { useStore } from "../store";
import { treeFind } from "../lib/tree";
import { selectCurrentBlocks, selectPmeta } from "../store/selectors";

export function DocHeader({ children }: { children?: ReactNode }) {
  const page = useStore((s) => s.page);
  const pmeta = useStore(selectPmeta);
  const blocks = useStore(selectCurrentBlocks);
  const tree = useStore((s) => s.tree);
  const setPMeta = useStore((s) => s.setPMeta);
  const setCoverPick = useStore((s) => s.setCoverPick);
  const setResearchOpen = useStore((s) => s.setResearchOpen);

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
            <div className="cover-fill" style={{ background: "var(--sunk)" }} />
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
