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

  return (
    <div className="app" data-rail={sidebar}>
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
              onOpenDiagnose={() => {}}
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
              {surface === "insights" && <Insights profile="default" visible />}
              {surface === "memory" && (
                <MemoryTimeline profile="default" onRefresh={() => {}} />
              )}
              {surface === "you" && <YouSurface profile="default" />}
              {surface === "graph" && <GraphView />}
              {surface === "equity" && <EquityResearch />}
            </div>
          )}
        </main>

        {/* The right panel (assistant/outline/comments/info) is doc-only. */}
        {panelOpen && surface === "doc" && <RightPanel />}
      </div>

      <Overlays />
      <Toast />
      <OcrStatus />
      {/* Phase 9: command palette, templates, trash, tweaks */}
    </div>
  );
}
