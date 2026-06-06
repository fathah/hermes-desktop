// PageMenu.tsx — the "…" page actions menu in the topbar. Ported from app.jsx.
import { useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

interface Props {
  onTemplate: () => void;
  onDelete: () => void;
  onSub: () => void;
  onCover: (rect: DOMRect) => void;
}

export function PageMenu({ onTemplate, onDelete, onSub, onCover }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const page = useStore((s) => s.page);
  const meta = useStore((s) => s.meta);
  const flash = useStore((s) => s.flash);

  // Copy an in-app wikilink to the current page — the app's native, resolvable
  // link format (the note-index graph links pages by [[Title]]).
  const copyLink = (): void => {
    const title = meta[page]?.title || "Untitled";
    const link = `[[${title}]]`;
    void navigator.clipboard
      ?.writeText(link)
      .then(() => flash("Link copied"))
      .catch(() => flash("Couldn't copy link", { tone: "warn" }));
    setOpen(false);
  };
  return (
    <>
      <button className="tb-btn" ref={ref} onClick={() => setOpen((v) => !v)}>
        <Icon name="dots" size={16} />
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 63 }}
            onMouseDown={() => setOpen(false)}
          />
          <div
            className="menu"
            style={{ right: 12, top: 46, zIndex: 64, minWidth: 210 }}
          >
            <div
              className="menu-mini"
              onClick={() => {
                onSub();
                setOpen(false);
              }}
            >
              <Icon name="plus" size={16} /> Add sub-page
            </div>
            <div
              className="menu-mini"
              onClick={() => {
                if (ref.current) onCover(ref.current.getBoundingClientRect());
                setOpen(false);
              }}
            >
              <Icon name="callout" size={16} /> Change cover
            </div>
            <div
              className="menu-mini"
              onClick={() => {
                onTemplate();
                setOpen(false);
              }}
            >
              <Icon name="doc" size={16} /> New from template
            </div>
            <div className="menu-mini" onClick={copyLink}>
              <Icon name="share" size={16} /> Copy link
            </div>
            <div className="menu-divider"></div>
            <div
              className="menu-mini danger"
              onClick={() => {
                onDelete();
                setOpen(false);
              }}
            >
              <Icon name="trash" size={16} /> Move to trash
            </div>
          </div>
        </>
      )}
    </>
  );
}
