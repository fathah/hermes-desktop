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
import { runAutoIngest } from "./inbox/ingestApply";
import {
  getAutoApply,
  getIngestIntervalMin,
  getLintIntervalMin,
  INGEST_PREFS_EVENT,
} from "./inbox/ingestPrefs";
import { ObsidianEditor } from "./editor/ObsidianEditor";
import { PersonalHealthDashboard } from "./health/PersonalHealthDashboard";
import { RssReaderDashboard } from "./research/RssReaderDashboard";
import { Dashboard } from "./components/Dashboard";

type TaskAutomationRule = {
  id: string;
  title: string;
  interval: "minute" | "hourly" | "daily" | "weekly";
  template: "quick" | "routine" | "project";
  lastTriggered: number;
};

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

  // Task automation scheduler (Step 4)
  useEffect(() => {
    const key = "sps_task_automations";
    if (!localStorage.getItem(key)) {
      const defaultRules: TaskAutomationRule[] = [
        {
          id: "rule-minute-check",
          title: "⚡ Quick Checkin",
          interval: "minute",
          template: "quick",
          lastTriggered: 0
        },
        {
          id: "rule-daily-standup",
          title: "🔁 Daily Standup SOP",
          interval: "daily",
          template: "routine",
          lastTriggered: 0
        },
        {
          id: "rule-weekly-review",
          title: "🏗️ Weekly Review & Planning",
          interval: "weekly",
          template: "project",
          lastTriggered: 0
        }
      ];
      localStorage.setItem(key, JSON.stringify(defaultRules));
    }

    const timer = setInterval(() => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const rules = JSON.parse(raw) as TaskAutomationRule[];
        let updated = false;
        const now = Date.now();

        const triggerRule = (rule: TaskAutomationRule) => {
          const setBlocks = useStore.getState().setBlocks;
          const flash = useStore.getState().flash;
          const uid = () => Math.random().toString(36).substring(2, 9);
          
          setBlocks((blocks) => {
            let hasDb = false;
            const nextBlocks = blocks.map((block) => {
              if (block.type === "database") {
                hasDb = true;
                const rows = block.rows || [];
                const newTask = {
                  id: `t-${uid()}`,
                  title: rule.title,
                  status: "inbox" as const,
                  prio: "med" as const,
                  who: "you",
                  due: "",
                  est: "",
                  custom: { label: rule.template === "quick" ? "Quick Win" : rule.template === "project" ? "Project" : "Routine" },
                  ...(rule.template === "project" ? {
                    desc: "Definition of Done:\n",
                    checklist: [
                      { id: `item-${uid()}`, text: "Prerequisite: What do I need to buy/find?", checked: false },
                      { id: `item-${uid()}`, text: "Action Step: First micro-task (15 min)", checked: false }
                    ]
                  } : rule.template === "routine" ? {
                    desc: "Links/Resources:\n",
                    checklist: [
                      { id: `item-${uid()}`, text: "SOP Step 1: Start process", checked: false },
                      { id: `item-${uid()}`, text: "SOP Step 2: Complete routine", checked: false }
                    ]
                  } : {})
                };
                return {
                  ...block,
                  rows: [...rows, newTask]
                };
              }
              return block;
            });
            if (hasDb) {
              flash(`Automation triggered: "${rule.title}" added to inbox`);
            }
            return nextBlocks;
          });
        };

        const nextRules = rules.map((rule) => {
          let shouldTrigger = false;
          const last = rule.lastTriggered || 0;
          const diffMs = now - last;

          if (rule.interval === "minute" && diffMs >= 60 * 1000) {
            shouldTrigger = true;
          } else if (rule.interval === "hourly" && diffMs >= 60 * 60 * 1000) {
            shouldTrigger = true;
          } else if (rule.interval === "daily" && diffMs >= 24 * 60 * 60 * 1000) {
            shouldTrigger = true;
          } else if (rule.interval === "weekly" && diffMs >= 7 * 24 * 60 * 60 * 1000) {
            shouldTrigger = true;
          }

          if (shouldTrigger) {
            triggerRule(rule);
            updated = true;
            return { ...rule, lastTriggered: now };
          }
          return rule;
        });

        if (updated) {
          localStorage.setItem(key, JSON.stringify(nextRules));
        }
      } catch (err) {
        console.error("Task automation runner error:", err);
      }
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  // Track recently visited pages
  useEffect(() => {
    if (page && page !== "dashboard_scratchpad" && page !== "home") {
      try {
        const stored = localStorage.getItem("sps-recent-visited-pages");
        const list: string[] = stored ? JSON.parse(stored) : [];
        const filtered = list.filter((id) => id !== page);
        filtered.unshift(page);
        localStorage.setItem("sps-recent-visited-pages", JSON.stringify(filtered.slice(0, 10)));
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
    >
      <Sidebar />

      <div className="sps-main-layout">
        <main className="main">
          {surface === "doc" ? (
            <>
              <Topbar />
              <div className="doc-scroll scroll" ref={docScrollRef}>
                <OnboardingChecklist />
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
