import { useState } from "react";
import HccWorkspaceViews, { type HccWorkspaceView } from "./HccWorkspaceViews";

const HCC_NAV: Array<{ view: HccWorkspaceView; label: string }> = [
  { view: "war-room", label: "War Room" },
  { view: "control-plane", label: "Control Plane" },
  { view: "intelligence-fabric", label: "Intelligence" },
  { view: "execution-center", label: "Executions" },
  { view: "capture-inbox", label: "Capture" },
  { view: "decision-center", label: "Decisions" },
  { view: "relationship-center", label: "Relationships" },
  { view: "gateway-map", label: "Gateway Map" },
  { view: "opportunity-radar", label: "Opportunities" },
  { view: "learning-engine", label: "Learning" },
  { view: "projects", label: "Projects" },
  { view: "domains", label: "Domains" },
  { view: "hcc-memory", label: "Memory" },
  { view: "personal-api", label: "Personal API" },
  { view: "plugin-center", label: "Plugins" },
  { view: "review-center", label: "Review" },
  { view: "registry-manager", label: "Registry" },
  { view: "graph-center", label: "Graph" },
  { view: "clone-remix", label: "Clone / Remix" },
];

function HccOsWorkspace(): React.JSX.Element {
  const [view, setView] = useState<HccWorkspaceView>("war-room");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);

  const openProject = (id: string): void => {
    setProjectId(id);
    setView("project-detail");
  };
  const openDomain = (id: string): void => {
    setDomainId(id);
    setView("domain-detail");
  };

  return (
    <section className="hcc-os-shell" aria-label="HCC OS native control center">
      <nav className="hcc-os-nav" aria-label="HCC OS views">
        {HCC_NAV.map((item) => (
          <button
            key={item.view}
            className={view === item.view ? "active" : ""}
            onClick={() => setView(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="hcc-os-content">
        <HccWorkspaceViews
          activeView={view}
          selectedProjectId={projectId}
          selectedDomainId={domainId}
          onOpenProject={openProject}
          onOpenDomain={openDomain}
          onOpenMemory={() => setView("hcc-memory")}
          onNavigateHccView={setView}
        />
      </div>
    </section>
  );
}

export default HccOsWorkspace;
