// Topbar.tsx — document top bar: breadcrumbs, comments + assistant toggles, page
// menu. Ported from app.jsx topbar block.
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { Breadcrumbs } from "./Breadcrumbs";
import { PageMenu } from "./PageMenu";

export function Topbar() {
  const sidebar = useStore((s) => s.t.sidebar);
  const setTweak = useStore((s) => s.setTweak);
  const panelOpen = useStore((s) => s.panelOpen);
  const rightTab = useStore((s) => s.rightTab);
  const openPanelTab = useStore((s) => s.openPanelTab);
  const page = useStore((s) => s.page);
  const deletePage = useStore((s) => s.deletePage);
  const newSubPage = useStore((s) => s.newSubPage);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setCoverPick = useStore((s) => s.setCoverPick);

  return (
    <div className="topbar">
      {sidebar === "hidden" && (
        <button
          className="tb-btn"
          title="Show sidebar"
          onClick={() => setTweak("sidebar", "full")}
        >
          <Icon name="panelLeft" size={17} />
        </button>
      )}
      <Breadcrumbs />
      <button
        className={`tb-btn ${panelOpen && rightTab === "comments" ? "on" : ""}`}
        onClick={() => openPanelTab("comments")}
        title="Notes"
      >
        <Icon name="comment" size={16} />
      </button>
      <button
        className={`tb-btn ${panelOpen && rightTab === "assistant" ? "on" : ""}`}
        onClick={() => openPanelTab("assistant")}
        title="Assistant (⌘J)"
      >
        <Icon name="sparkle" size={16} />{" "}
        <span className="tb-label">Assistant</span>
      </button>
      <PageMenu
        onTemplate={() => setTemplatesOpen({ parent: page })}
        onDelete={() => deletePage(page)}
        onSub={() => newSubPage(page)}
        onCover={(r) => setCoverPick({ x: r.left - 200, y: r.bottom + 6 })}
      />
    </div>
  );
}
