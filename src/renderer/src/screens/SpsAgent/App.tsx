// App.tsx — composition root. Phase 3 wires the sidebar + shell + doc header.
// The block editor (Phase 4), right panel (Phase 7), pickers/palette/modals/tweaks
// (Phases 5/9) slot into the marked placeholders.
import { useEffect, useRef } from "react";
import { useStore } from "./store";
import { useHotkeys } from "./hooks/useHotkeys";
import { setScrollContainer } from "./lib/scroll";
import { Sidebar } from "./sidebar/Sidebar";
import { Topbar } from "./shell/Topbar";
import { DocHeader } from "./shell/DocHeader";
import { Editor } from "./editor/Editor";
import { RightPanel } from "./panel/RightPanel";
import { Overlays } from "./shell/Overlays";
import { Toast } from "./components/Toast";

export function App() {
  useHotkeys();
  const sidebar = useStore((s) => s.t.sidebar);
  const page = useStore((s) => s.page);
  const panelOpen = useStore((s) => s.panelOpen);
  const docScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScrollContainer(docScrollRef.current);
    return () => setScrollContainer(null);
  }, []);

  return (
    <div className="app" data-rail={sidebar}>
      <Sidebar />

      <div style={{ display: "flex", minWidth: 0 }}>
        <main className="main">
          <Topbar />
          <div className="doc-scroll scroll" ref={docScrollRef}>
            <DocHeader>
              {/* distinct key so the editor remounts (clean refs) on page switch */}
              <Editor key={`ed-${page}`} />
            </DocHeader>
          </div>
        </main>

        {panelOpen && <RightPanel />}
      </div>

      <Overlays />
      <Toast />
      {/* Phase 9: command palette, templates, trash, tweaks */}
    </div>
  );
}
