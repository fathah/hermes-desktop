// DocHeader.tsx — page cover, icon, editable title and meta row, wrapping the
// document body (the Editor) inside the same .doc-head-inner as the prototype.
// Emoji/cover pickers render in Phase 5; here the buttons set picker coordinates.
import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { selectPmeta } from "../store/selectors";

export function DocHeader({ children }: { children?: ReactNode }) {
  const page = useStore((s) => s.page);
  const pmeta = useStore(selectPmeta);
  const setPMeta = useStore((s) => s.setPMeta);
  const setCoverPick = useStore((s) => s.setCoverPick);

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
            <span>
              <b>4</b> contributors
            </span>
            <span>Saved locally</span>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
