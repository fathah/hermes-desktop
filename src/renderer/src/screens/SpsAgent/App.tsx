// App.tsx — composition root. Phase 3 wires the sidebar + shell + doc header.
// The block editor (Phase 4), right panel (Phase 7), pickers/palette/modals/tweaks
// (Phases 5/9) slot into the marked placeholders.
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { useHotkeys } from "./hooks/useHotkeys";
import { setScrollContainer } from "./lib/scroll";
import { openSettings } from "../../lib/openSettings";
import { Sidebar } from "./sidebar/Sidebar";
import { Topbar } from "./shell/Topbar";
import { DocHeader } from "./shell/DocHeader";
import { Editor } from "./editor/Editor";
import { RightPanel } from "./panel/RightPanel";
import { Overlays } from "./shell/Overlays";
import { Toast } from "./components/Toast";
import { OcrStatus } from "./components/OcrStatus";
import Insights from "../Insights/Insights";
import { MemoryTimeline } from "../Memory/MemoryTimeline";
import Chat, { type ChatMessage } from "../Chat/Chat";
import { ChatSurface } from "./shell/ChatSurface";
import { AskPane } from "./panel/AskPane";
import { GraphView } from "./graph/GraphView";
import { EquityResearch } from "./equity/EquityResearch";
import { JournalSurface } from "./journal/JournalSurface";
import { YouSurface } from "./you/YouSurface";
import { CockpitSurface } from "./cockpit/CockpitSurface";
import { InboxSurface } from "./inbox/InboxSurface";
import { HealthSurface } from "./health/HealthSurface";
import { runAutoIngest } from "./inbox/ingestApply";
import {
  getAutoApply,
  getIngestIntervalMin,
  INGEST_PREFS_EVENT,
} from "./inbox/ingestPrefs";
import { ObsidianEditor } from "./editor/ObsidianEditor";
import { FirstRunChecklist } from "./components/FirstRunChecklist";

export function App() {
  useHotkeys();
  const sidebar = useStore((s) => s.t.sidebar);
  const page = useStore((s) => s.page);
  const panelOpen = useStore((s) => s.panelOpen);
  const surface = useStore((s) => s.surface);
  const chatNonce = useStore((s) => s.chatNonce);
  const docScrollRef = useRef<HTMLDivElement>(null);
  // Agent Console (tool-using Hermes chat) state — kept local to SPS.
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([]);
  const [agentSession, setAgentSession] = useState<string | null>(null);

  useEffect(() => {
    setScrollContainer(docScrollRef.current);
    return () => setScrollContainer(null);
  }, []);

  // Scheduled in-app ingest: while the app is open and auto-apply is on, run the
  // ingest loop every N minutes (0 = off). Reconfigures live on a prefs change.
  // (Truly headless scheduling needs the deferred direct-write agent mode.)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const configure = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const min = getIngestIntervalMin();
      if (min <= 0) return;
      timer = setInterval(
        () => {
          if (!getAutoApply()) return;
          const commitPage = useStore.getState().ingestCommitPage;
          void runAutoIngest(commitPage).then((res) => {
            if (res.ok && (res.pages || res.memory)) {
              useStore
                .getState()
                .flash(
                  `Auto-filed ${res.pages} page${res.pages === 1 ? "" : "s"}`,
                );
            }
          });
        },
        min * 60 * 1000,
      );
    };
    configure();
    window.addEventListener(INGEST_PREFS_EVENT, configure);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener(INGEST_PREFS_EVENT, configure);
    };
  }, []);

  return (
    <div
      className="app"
      data-rail={sidebar}
      data-panel={panelOpen && surface === "doc" ? "open" : "closed"}
    >
      <Sidebar />

      <div style={{ display: "flex", minWidth: 0 }}>
        <main className="main">
          {surface === "doc" ? (
            <>
              <Topbar />
              <div className="doc-scroll scroll" ref={docScrollRef}>
                <DocHeader>
                  {/* distinct key so the editor remounts (clean refs) on page switch */}
                  <Editor key={`ed-${page}`} />
                </DocHeader>
              </div>
            </>
          ) : surface === "agent" ? (
            // Agent Console: the tool-using Hermes chat (diffs/approval/gauge/
            // delegation) — distinct from the doc-editing assistant.
            <Chat
              messages={agentMessages}
              setMessages={setAgentMessages}
              sessionId={agentSession}
              profile="default"
              onNewChat={() => {
                setAgentMessages([]);
                setAgentSession(null);
              }}
              onOpenDiagnose={() => openSettings()}
            />
          ) : surface === "chats" ? (
            // AI Chats: recent sessions + guided new chats (shares <Chat>).
            <ChatSurface key={`chat-${chatNonce}`} />
          ) : surface === "ask" ? (
            <AskPane />
          ) : surface === "journal" ? (
            <JournalSurface />
          ) : (
            <div className="doc-scroll scroll">
              {surface === "cockpit" && <CockpitSurface />}
              {surface === "insights" && <Insights profile="default" visible />}
              {surface === "memory" && (
                <MemoryTimeline profile="default" onRefresh={() => {}} />
              )}
              {surface === "you" && <YouSurface profile="default" />}
              {surface === "inbox" && <InboxSurface profile="default" />}
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
      <OcrStatus />
      <FirstRunChecklist />
      {/* Phase 9: command palette, templates, trash, tweaks */}
    </div>
  );
}
