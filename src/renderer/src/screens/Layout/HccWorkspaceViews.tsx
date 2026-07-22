import WarRoom from "../WarRoom/WarRoom";
import ControlPlane from "../ControlPlane/ControlPlane";
import Projects from "../Projects/Projects";
import ProjectDetail from "../Projects/ProjectDetail";
import Domains from "../Domains/Domains";
import DomainDetail from "../Domains/DomainDetail";
import MemoryCenter from "../MemoryCenter/MemoryCenter";
import ReviewCenter from "../ReviewCenter/ReviewCenter";
import RegistryManager from "../RegistryManager/RegistryManager";
import GraphCenter from "../GraphCenter/GraphCenter";
import CloneRemixStudio from "../CloneRemix/CloneRemixStudio";
import OpportunityRadar from "../OpportunityRadar/OpportunityRadar";
import LearningEngine from "../LearningEngine/LearningEngine";
import GatewayCapabilityMap from "../GatewayCapabilityMap/GatewayCapabilityMap";
import IntelligenceFabric from "../IntelligenceFabric/IntelligenceFabric";
import ExecutionCenter from "../ExecutionCenter/ExecutionCenter";
import CaptureInbox from "../CaptureInbox/CaptureInbox";
import DecisionCenter from "../DecisionCenter/DecisionCenter";
import RelationshipCenter from "../RelationshipCenter/RelationshipCenter";
import PersonalApiCenter from "../PersonalApi/PersonalApiCenter";

export type HccWorkspaceView =
  | "war-room"
  | "control-plane"
  | "projects"
  | "project-detail"
  | "domains"
  | "domain-detail"
  | "hcc-memory"
  | "review-center"
  | "registry-manager"
  | "graph-center"
  | "clone-remix"
  | "opportunity-radar"
  | "learning-engine"
  | "gateway-map"
  | "intelligence-fabric"
  | "execution-center"
  | "capture-inbox"
  | "decision-center"
  | "relationship-center"
  | "personal-api";

interface HccWorkspaceViewsProps {
  activeView: string;
  selectedProjectId: string | null;
  selectedDomainId: string | null;
  onOpenProject: (projectId: string) => void;
  onOpenDomain: (domainId: string) => void;
  onOpenMemory: () => void;
  onNavigateHccView?: (view: HccWorkspaceView) => void;
}

const HCC_VIEWS = new Set<string>([
  "war-room",
  "control-plane",
  "projects",
  "project-detail",
  "domains",
  "domain-detail",
  "hcc-memory",
  "review-center",
  "registry-manager",
  "graph-center",
  "clone-remix",
  "opportunity-radar",
  "learning-engine",
  "gateway-map",
  "intelligence-fabric",
  "execution-center",
  "capture-inbox",
  "decision-center",
  "relationship-center",
  "personal-api",
]);

function HccWorkspaceViews({
  activeView,
  selectedProjectId,
  selectedDomainId,
  onOpenProject,
  onOpenDomain,
  onOpenMemory,
  onNavigateHccView,
}: HccWorkspaceViewsProps): React.JSX.Element | null {
  if (!HCC_VIEWS.has(activeView)) {
    return null;
  }

  let content: React.JSX.Element;
  switch (activeView as HccWorkspaceView) {
    case "control-plane":
      content = <ControlPlane />;
      break;
    case "projects":
      content = <Projects selectedProjectId={selectedProjectId} onSelectProject={onOpenProject} />;
      break;
    case "project-detail":
      content = <ProjectDetail projectId={selectedProjectId} />;
      break;
    case "domains":
      content = <Domains selectedDomainId={selectedDomainId} onSelectDomain={onOpenDomain} />;
      break;
    case "domain-detail":
      content = <DomainDetail domainId={selectedDomainId} />;
      break;
    case "hcc-memory":
      content = <MemoryCenter />;
      break;
    case "review-center":
      content = (
        <ReviewCenter
          onOpenProject={onOpenProject}
          onOpenDomain={onOpenDomain}
          onOpenMemory={onOpenMemory}
        />
      );
      break;
    case "registry-manager":
      content = <RegistryManager />;
      break;
    case "graph-center":
      content = <GraphCenter />;
      break;
    case "clone-remix":
      content = <CloneRemixStudio />;
      break;
    case "opportunity-radar":
      content = <OpportunityRadar />;
      break;
    case "learning-engine":
      content = <LearningEngine />;
      break;
    case "gateway-map":
      content = <GatewayCapabilityMap />;
      break;
    case "intelligence-fabric":
      content = <IntelligenceFabric onOpenExecutionCenter={() => onNavigateHccView?.("execution-center")} />;
      break;
    case "personal-api":
      content = <PersonalApiCenter />;
      break;
    case "relationship-center":
      content = <RelationshipCenter />;
      break;
    case "decision-center":
      content = <DecisionCenter />;
      break;
    case "capture-inbox":
      content = <CaptureInbox />;
      break;
    case "execution-center":
      content = <ExecutionCenter />;
      break;
    case "war-room":
    default:
      content = (
        <WarRoom
          onOpenProject={onOpenProject}
          onOpenDomain={onOpenDomain}
          onOpenMemory={onOpenMemory}
        />
      );
  }

  return (
    <div className="hcc-workspace-view">
      {content}
    </div>
  );
}

export default HccWorkspaceViews;
