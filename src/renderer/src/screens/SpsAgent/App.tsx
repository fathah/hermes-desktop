// App.tsx — composition root. Phase 3 wires the sidebar + shell + doc header.
// The block editor (Phase 4), right panel (Phase 7), pickers/palette/modals/tweaks
// (Phases 5/9) slot into the marked placeholders.
import { useEffect, useRef, useState } from "react";
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
import { OnboardingChecklist } from "./components/OnboardingChecklist";
import { SaveStatus } from "./components/SaveStatus";
import { OcrStatus } from "./components/OcrStatus";
import Insights from "../Insights/Insights";
import { MemoryTimeline } from "./you/MemoryTimeline";
import { ChatSurface } from "./shell/ChatSurface";
import { AskPane } from "./panel/AskPane";
import { GraphView } from "./graph/GraphView";
import { EquityResearch } from "./equity/EquityResearch";
import { JournalSurface } from "./journal/JournalSurface";
import { MyWorkSurface } from "./journal/MyWorkSurface";
import { YouSurface } from "./you/YouSurface";
import { LearningSurface } from "./learning/LearningSurface";
import { ActiveWorkSurface } from "./activeWork/ActiveWorkSurface";
import { CockpitSurface } from "./cockpit/CockpitSurface";
import { InboxSurface } from "./inbox/InboxSurface";
import { HealthSurface } from "./health/HealthSurface";
import { ReviewQueueSurface } from "./review/ReviewQueueSurface";
import { ObsidianEditor } from "./editor/ObsidianEditor";
import { PersonalHealthDashboard } from "./health/PersonalHealthDashboard";
import { RssReaderDashboard } from "./research/RssReaderDashboard";
import { Dashboard } from "./components/Dashboard";
import { ContentStudioSurface } from "./content/ContentStudioSurface";
import { DeckStudioSurface } from "./deck/DeckStudioSurface";
import { WhatsNewPanel } from "./updates/WhatsNewPanel";
import { openSettings } from "../../lib/openSettings";
import type { ReleaseAffordanceAction } from "../../../../shared/update-affordances";
import type { Surface } from "./store/storeTypes";

const NARROW_WORKSPACE_QUERY = "(max-width: 900px)";

function isNarrowWorkspace(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(NARROW_WORKSPACE_QUERY).matches;
}

export function App() {
  useHotkeys();
  const sidebar = useStore((s) => s.t.sidebar);
  const page = useStore((s) => s.page);
  const panelOpen = useStore((s) => s.panelOpen);
  const setPanelOpen = useStore((s) => s.setPanelOpen);
  const surface = useStore((s) => s.surface);
  const chatNonce = useStore((s) => s.chatNonce);
  const setSurface = useStore((s) => s.setSurface);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);
  const docScrollRef = useRef<HTMLDivElement>(null);
  const [narrowWorkspace, setNarrowWorkspace] = useState(isNarrowWorkspace);
  const wasNarrowRef = useRef(narrowWorkspace);

  const runReleaseAffordance = (action: ReleaseAffordanceAction): void => {
    if (action.kind === "surface") {
      setSurface(action.surface as Surface);
      return;
    }
    if (action.kind === "settings") {
      openSettings(action.view);
      return;
    }
    if (action.modal === "research") {
      setResearchOpen(true);
    } else if (action.modal === "scheduled") {
      setScheduledOpen(true);
    } else if (action.modal === "templates") {
      setTemplatesOpen({ parent: null });
    } else if (action.modal === "palette") {
      setPaletteOpen(true);
    } else {
      setTweaksOpen(true);
    }
  };

  useEffect(() => {
    setScrollContainer(docScrollRef.current);
    return () => setScrollContainer(null);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia(NARROW_WORKSPACE_QUERY);
    const update = (): void => setNarrowWorkspace(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const enteredNarrow = narrowWorkspace && !wasNarrowRef.current;
    wasNarrowRef.current = narrowWorkspace;
    if (enteredNarrow && surface === "doc" && panelOpen) {
      setPanelOpen(false);
    }
  }, [narrowWorkspace, panelOpen, setPanelOpen, surface]);

  // Track recently visited pages
  useEffect(() => {
    if (page && page !== "dashboard_scratchpad" && page !== "home") {
      try {
        const stored = localStorage.getItem("sps-recent-visited-pages");
        const list: string[] = stored ? JSON.parse(stored) : [];
        const filtered = list.filter((id) => id !== page);
        filtered.unshift(page);
        localStorage.setItem(
          "sps-recent-visited-pages",
          JSON.stringify(filtered.slice(0, 10)),
        );
      } catch (err) {
        console.error("Failed to track visited page:", err);
      }
    }
  }, [page]);

  return (
    <div
      className="app"
      data-rail={sidebar}
      data-panel={panelOpen && surface === "doc" ? "open" : "closed"}
      data-workspace-width={narrowWorkspace ? "narrow" : "wide"}
    >
      <Sidebar />

      <div className="sps-main-layout">
        <main className="main">
          {surface === "doc" ? (
            <>
              <Topbar />
              <div className="doc-scroll scroll" ref={docScrollRef}>
                <div className="home-affordance-strip">
                  <OnboardingChecklist variant="compact" />
                  <WhatsNewPanel
                    onRunAction={runReleaseAffordance}
                    variant="compact"
                  />
                </div>
                <DocHeader>
                  {/* distinct key so the editor remounts (clean refs) on page switch */}
                  <Editor key={`ed-${page}`} />
                </DocHeader>
              </div>
            </>
          ) : surface === "dashboard" ? (
            <Dashboard />
          ) : surface === "chats" ? (
            // The single Chat surface — session-backed (Recents + persistence).
            // Tool-use/approvals/diffs are gateway-driven, so there's no separate
            // "agent" surface; developer-only controls hide behind Developer mode.
            <ChatSurface key={`chat-${chatNonce}`} />
          ) : surface === "ask" ? (
            <AskPane />
          ) : surface === "work" ? (
            <MyWorkSurface />
          ) : surface === "journal" ? (
            <JournalSurface />
          ) : surface === "personal-health" ? (
            <PersonalHealthDashboard />
          ) : surface === "rss-reader" ? (
            <RssReaderDashboard />
          ) : surface === "contentStudio" ? (
            <ContentStudioSurface />
          ) : surface === "deckStudio" ? (
            <DeckStudioSurface />
          ) : (
            <div className="doc-scroll scroll">
              {surface === "cockpit" && <CockpitSurface />}
              {surface === "insights" && <Insights profile="default" visible />}
              {surface === "memory" && (
                <MemoryTimeline profile="default" onRefresh={() => {}} />
              )}
              {surface === "you" && <YouSurface profile="default" />}
              {surface === "learning" && <LearningSurface profile="default" />}
              {surface === "activeWork" && <ActiveWorkSurface />}
              {surface === "inbox" && <InboxSurface profile="default" />}
              {surface === "review" && <ReviewQueueSurface profile="default" />}
              {surface === "health" && <HealthSurface profile="default" />}
              {surface === "graph" && <GraphView />}
              {surface === "equity" && <EquityResearch />}
              {surface === "obsidian-note" && <ObsidianEditor />}
            </div>
          )}
        </main>

        {/* The right panel (assistant/outline/comments/info) is doc-only. */}
        {panelOpen && surface === "doc" && <RightPanel />}
      </div>

      <Overlays />
      <Toast />
      <SaveStatus />
      <OcrStatus />
      {/* Phase 9: command palette, templates, trash, tweaks */}
    </div>
  );
}
