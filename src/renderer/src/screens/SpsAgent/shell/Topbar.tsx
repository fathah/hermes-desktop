// Topbar.tsx — document top bar: breadcrumbs, page menu, and a single side-panel
// toggle. Tab selection (Assistant/Outline/Notes/Info) lives in the panel itself,
// so the topbar carries one panel control, not three. Ported from app.jsx topbar.
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { Breadcrumbs } from "./Breadcrumbs";
import { PageMenu } from "./PageMenu";

export function Topbar() {
  const sidebar = useStore((s) => s.t.sidebar);
  const setTweak = useStore((s) => s.setTweak);
  const panelOpen = useStore((s) => s.panelOpen);
  const setPanelOpen = useStore((s) => s.setPanelOpen);
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
      <PageMenu
        onTemplate={() => setTemplatesOpen({ parent: page })}
        onDelete={() => deletePage(page)}
        onSub={() => newSubPage(page)}
        onCover={(r) => setCoverPick({ x: r.left - 200, y: r.bottom + 6 })}
      />
      <button
        className={`tb-btn ${panelOpen ? "on" : ""}`}
        onClick={() => setPanelOpen(!panelOpen)}
        title={
          panelOpen ? "Hide assistant panel (⌘J)" : "Show assistant panel (⌘J)"
        }
        aria-label="Toggle side panel"
      >
        <Icon name="panelRight" size={17} />
      </button>
    </div>
  );
}
