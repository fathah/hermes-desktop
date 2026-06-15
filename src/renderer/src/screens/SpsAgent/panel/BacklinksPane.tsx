import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { useVaultBacklinks } from "../hooks/useNoteIndex";

export function BacklinksPane() {
  const currentPageId = useStore((s) => s.page);
  const selectPage = useStore((s) => s.selectPage);
  const meta = useStore((s) => s.meta);
  const backlinks = useVaultBacklinks(currentPageId);

  return (
    <div className="rp-body scroll">
      <div className="backlinks-container">
        <div className="backlinks-header">
          <Icon name="share" size={16} />
          <div className="type-section-label backlinks-title">
            Backlinks
          </div>
        </div>
        <p className="backlinks-description">
          The following pages link back to the current note using wikilinks. Click on any reference to jump to it.
        </p>

        {backlinks.length === 0 ? (
          <div className="backlinks-empty">
            <Icon name="info" size={18} className="backlinks-empty-icon" />
            <div>No backlinks found</div>
          </div>
        ) : (
          <div className="backlinks-list">
            {backlinks.map((id) => (
              <button
                key={id}
                type="button"
                className="nav-item backlinks-item"
                onClick={() => selectPage(id)}
              >
                <span className="backlinks-item-icon">{meta[id]?.icon || "📄"}</span>
                <span className="nav-label backlinks-item-label">
                  {meta[id]?.title || "Untitled"}
                </span>
                <Icon name="chevR" size={12} className="backlinks-item-chevron" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
