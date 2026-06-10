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
import { SaveStatus } from "./components/SaveStatus";
import { OcrStatus } from "./components/OcrStatus";
import Insights from "../Insights/Insights";
import { MemoryTimeline } from "../Memory/MemoryTimeline";
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
  getLintIntervalMin,
  INGEST_PREFS_EVENT,
} from "./inbox/ingestPrefs";
import { ObsidianEditor } from "./editor/ObsidianEditor";

export function App() {
  useHotkeys();
  const sidebar = useStore((s) => s.t.sidebar);
  const page = useStore((s) => s.page);
  const panelOpen = useStore((s) => s.panelOpen);
  const surface = useStore((s) => s.surface);
  const chatNonce = useStore((s) => s.chatNonce);
  const docScrollRef = useRef<HTMLDivElement>(null);

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

  // Scheduled in-app deep-lint: every N minutes (0 = off), run the LLM lint and
  // NOTIFY when it finds semantic issues. Notify-only by design — a background
  // pass never auto-edits existing pages; the user reviews fixes in Vault health.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const configure = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const min = getLintIntervalMin();
      if (min <= 0) return;
      timer = setInterval(
        () => {
          void window.hermesAPI.spsLintWiki?.(30).then((res) => {
            if (res?.ok && res.findings.length > 0) {
              const n = res.findings.length;
              useStore
                .getState()
                .flash(
                  `Vault lint: ${n} issue${n === 1 ? "" : "s"} found — open Vault health to review`,
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
          ) : surface === "chats" ? (
            // The single Chat surface — session-backed (Recents + persistence).
            // Tool-use/approvals/diffs are gateway-driven, so there's no separate
            // "agent" surface; developer-only controls hide behind Developer mode.
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
      <SaveStatus />
      <OcrStatus />
      {/* Phase 9: command palette, templates, trash, tweaks */}
    </div>
  );
}
