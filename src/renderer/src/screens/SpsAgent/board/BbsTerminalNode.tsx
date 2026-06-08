import { useState, useRef, useEffect, useMemo } from "react";
import type { PageMeta, Block } from "../types";
import { useStore } from "../store";
import { useVaultQuery } from "../hooks/useNoteIndex";

interface BbsTerminalNodeProps {
  activeTheme: "green" | "amber";
  onThemeToggle: () => void;
  homeSurface: string;
  onSetHomeToggle: () => void;
  allPages: { id: string; meta: PageMeta }[];
}

type BbsMode = "home" | "tasks" | "calendar" | "inbox" | "journal" | "chat" | "files" | "settings";

interface ChatMessage {
  sender: "Operator" | "Louis";
  text: string;
  time: string;
}

export function BbsTerminalNode({
  activeTheme,
  onThemeToggle,
  homeSurface,
  onSetHomeToggle,
  allPages,
}: BbsTerminalNodeProps) {
  const [currentMode, setCurrentMode] = useState<BbsMode>("home");
  const [inputVal, setInputVal] = useState("");
  const [port, setPort] = useState(8642);

  // Zustand Store integrations
  const docs = useStore((s) => s.docs);
  const meta = useStore((s) => s.meta);
  const activePageId = useStore((s) => s.page);
  const setPageDoc = useStore((s) => s.setPageDoc);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const createJournalEntry = useStore((s) => s.createJournalEntry);
  const flash = useStore((s) => s.flash);

  // Inbox capture hook (real captured workspace notes)
  const { rows: inboxRows } = useVaultQuery("_inbox");

  // Profile status info
  const [profileInfo, setProfileInfo] = useState({
    profileName: "default",
    model: "Llama-3-Hermes",
    gatewayRunning: true,
  });

  // Local calendar event schedule state
  const [scheduledEvents] = useState<{ date: string; time: string; title: string }[]>([
    { date: "2026-06-08", time: "19:30", title: "AI meeting note prep" },
    { date: "2026-06-10", time: "14:00", title: "Swarm synchronization" },
    { date: "2026-06-12", time: "10:00", title: "Weekly status sync" },
  ]);

  // Local interactive states
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [chatLogs, setChatLogs] = useState<ChatMessage[]>([
    {
      sender: "Louis",
      text: "Greetings Operator. I am ready to process your instructions.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [chatLoading, setChatLoading] = useState(false);

  const outputEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when modes or logs change
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMode, chatLogs]);

  // Load Hermes profile telemetry on launch
  useEffect(() => {
    const api = window.hermesAPI;
    if (!api?.listProfiles) return;
    api
      .listProfiles()
      .then((profiles) => {
        const active = profiles.find((p) => p.isActive) || profiles[0];
        if (active) {
          setProfileInfo({
            profileName: active.name,
            model: active.model,
            gatewayRunning: active.gatewayRunning,
          });
          if (active.name && active.name !== "default" && api.getConfig) {
            api
              .getConfig("platforms.api_server.extra.port", active.name)
              .then((pStr: string | null) => {
                const pNum = pStr ? parseInt(pStr, 10) : null;
                if (pNum) setPort(pNum);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  // Aggregated Workspace Tasks (Scans checklist blocks and DB tasks)
  const allWorkspaceTasks = useMemo(() => {
    const list: { id: string; text: string; done: boolean; pageId: string; pageTitle: string; index: number; isDb: boolean }[] = [];
    let idx = 1;
    for (const [pageId, blocks] of Object.entries(docs)) {
      const pageTitle = meta[pageId]?.title || "Untitled";
      for (const block of blocks) {
        if (block.type === "todo") {
          list.push({
            id: block.id,
            text: block.text,
            done: !!block.done,
            pageId,
            pageTitle,
            index: idx++,
            isDb: false,
          });
        } else if (block.type === "database" && block.rows) {
          for (const row of block.rows) {
            list.push({
              id: row.id,
              text: row.title,
              done: row.status === "done",
              pageId,
              pageTitle,
              index: idx++,
              isDb: true,
            });
          }
        }
      }
    }
    return list;
  }, [docs, meta]);

  // Aggregated Journal Entries
  const journalEntries = useMemo(() => {
    return Object.entries(meta)
      .filter(([_, m]) => m.journal && m.date)
      .map(([id, m]) => ({
        id,
        date: m.date!,
        title: m.title || `Journal Log (${m.date})`,
        mood: m.mood || "📝",
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [meta]);

  // Toggle Task Completion
  const handleToggleTask = (taskIndex: number) => {
    const task = allWorkspaceTasks.find((t) => t.index === taskIndex);
    if (!task) return;

    const pageBlocks = docs[task.pageId] || [];
    if (task.isDb) {
      const updated = pageBlocks.map((b) => {
        if (b.type === "database" && b.rows) {
          return {
            ...b,
            rows: b.rows.map((r) =>
              r.id === task.id
                ? { ...r, status: r.status === "done" ? ("todo" as const) : ("done" as const) }
                : r
            ),
          };
        }
        return b;
      });
      setPageDoc(task.pageId, updated);
    } else {
      const updated = pageBlocks.map((b) =>
        b.id === task.id ? { ...b, done: !b.done } : b
      );
      setPageDoc(task.pageId, updated);
    }
    flash(`Task "${task.text.slice(0, 15)}..." updated`);
  };

  // Add Task Block to Active Page
  const handleAddTask = (text: string) => {
    if (!text.trim()) return;
    const pageId = activePageId || "home";
    const pageBlocks = docs[pageId] || [];
    const newBlock: Block = {
      id: "blk-" + Math.random().toString(36).slice(2, 9),
      type: "todo",
      text: text.trim(),
      done: false,
    };
    setPageDoc(pageId, [...pageBlocks, newBlock]);
    flash(`Added task to "${meta[pageId]?.title || "active page"}"`);
  };

  // Log today's journal entry text
  const handleAddJournalLog = (text: string) => {
    if (!text.trim()) return;
    const todayStr = new Date().toISOString().split("T")[0];
    const existing = Object.entries(meta).find(([_, m]) => m.journal && m.date === todayStr);
    let targetPageId = existing ? existing[0] : null;

    if (!targetPageId) {
      targetPageId = createJournalEntry(todayStr);
    }

    const pageBlocks = docs[targetPageId] || [];
    const newBlock: Block = {
      id: "blk-" + Math.random().toString(36).slice(2, 9),
      type: "p",
      text: text.trim(),
    };
    setPageDoc(targetPageId, [...pageBlocks, newBlock]);
    flash("Logged today's journal entry");
  };

  // Process AI Assistant Stream
  const handleSendAiMessage = async (messageText: string) => {
    if (!messageText.trim()) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatLogs((prev) => [...prev, { sender: "Operator", text: messageText, time: timeStr }]);
    setChatLoading(true);

    try {
      const api = window.hermesAPI;
      if (api?.spsAssistant) {
        const response = await api.spsAssistant(messageText, { blocks: [], pageTitle: "SPS Terminal" }) as { reply?: string[] };
        const reply = response?.reply?.join("\n") || "No reply received.";
        setChatLogs((prev) => [...prev, { sender: "Louis", text: reply, time: timeStr }]);
      } else {
        throw new Error("Assistant API offline");
      }
    } catch {
      // Fallback response from Louis AI Principal
      let responseText = "Ready to catalog your notes, operator. Place them on the grid.";
      const cleanLower = messageText.toLowerCase();
      if (cleanLower.includes("major system") || cleanLower.includes("memory")) {
        responseText = "Louis: The Major System maps numerals to consonant sounds, converting abstract numbers into vivid visual narratives for your Memory Palace.";
      } else if (cleanLower.includes("standard 21") || cleanLower.includes("jazz") || cleanLower.includes("song")) {
        responseText = "Louis: Our Standard 21 curriculum tracks legendary performances. 'Nardis' occupies #19 as our key Phrygian Dominant vocal study.";
      } else if (cleanLower.includes("cognitive") || cleanLower.includes("framework") || cleanLower.includes("latticework")) {
        responseText = "Louis: The AI Cognitive Framework integrates hallucination checking, RLHF audits, and prompt security to harden our operations.";
      } else if (cleanLower.includes("help")) {
        responseText = "Louis: I can help you query tasks, view calendars, or search files. Type '/back' to return to the home screen.";
      } else {
        responseText = "Louis: Understood. Let's document these developments in the vault files.";
      }
      setTimeout(() => {
        setChatLogs((prev) => [...prev, { sender: "Louis", text: responseText, time: timeStr }]);
      }, 500);
    } finally {
      setChatLoading(false);
    }
  };

  // Command Shell Processor
  const executeCommand = (cmd: string) => {
    const cleanCmd = cmd.trim();
    if (!cleanCmd) return;

    if (currentMode === "chat") {
      handleSendAiMessage(cleanCmd);
      return;
    }

    const parts = cleanCmd.split(" ");
    const action = parts[0].toLowerCase();
    const argsText = parts.slice(1).join(" ");

    switch (action) {
      case "help":
        flash("Shortcut commands: todo <text>, log <text>, toggle <num>");
        break;
      case "todo":
        if (argsText) {
          handleAddTask(argsText);
        } else {
          setCurrentMode("tasks");
        }
        break;
      case "log":
        if (argsText) {
          handleAddJournalLog(argsText);
        } else {
          setCurrentMode("journal");
        }
        break;
      case "toggle":
        const idx = parseInt(argsText, 10);
        if (!isNaN(idx)) {
          handleToggleTask(idx);
        } else {
          flash("Usage: toggle [number]");
        }
        break;
      case "chat":
        if (argsText) {
          handleSendAiMessage(argsText);
        }
        setCurrentMode("chat");
        break;
      case "open": {
        const targetId = argsText.trim().toLowerCase();
        const matched = allPages.find((p) => p.id.toLowerCase().endsWith(targetId));
        if (matched) {
          selectPage(matched.id);
          setSurface("doc");
          flash(`Opened ${matched.meta.title} in document editor`);
        } else {
          flash("Page matching ID suffix not found");
        }
        break;
      }
      case "clear":
        setChatLogs([]);
        break;
      case "back":
      case "home":
        setCurrentMode("home");
        break;
      default:
        flash(`Unknown command: ${action}`);
        break;
    }
  };

  // Handle Enter Form Submits
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = inputVal.trim();
    if (!cmd) return;
    executeCommand(cmd);
    setInputVal("");
  };

  // Dynamic ASCII Calendar for June 2026 (or active system month)
  const renderCalendar = () => {
    const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    // June 2026 starts on Monday (1st), has 30 days.
    const monthWeeks: (number | null)[][] = [
      [null, 1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12, 13],
      [14, 15, 16, 17, 18, 19, 20],
      [21, 22, 23, 24, 25, 26, 27],
      [28, 29, 30, null, null, null, null],
    ];

    const todayObj = new Date();
    const currentYear = todayObj.getFullYear();
    const currentMonth = todayObj.getMonth() + 1; // 1-indexed
    const currentDay = todayObj.getDate();

    return (
      <div className="bbs-calendar-container">
        <div style={{ textAlign: "center", fontWeight: "bold", marginBottom: "12px", color: "var(--phosphor-glow)", fontSize: "18px" }}>
          JUNE 2026
        </div>
        <div className="bbs-calendar-grid">
          {days.map((d) => (
            <div key={d} className="bbs-calendar-day-header">
              {d}
            </div>
          ))}
          {monthWeeks.flat().map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="bbs-calendar-cell" />;
            const isToday = currentYear === 2026 && currentMonth === 6 && day === currentDay;
            const hasEvent = scheduledEvents.some((e) => e.date === `2026-06-${day.toString().padStart(2, "0")}`);
            return (
              <div
                key={day}
                className={`bbs-calendar-cell ${isToday ? "today" : ""} ${hasEvent ? "has-event" : ""}`}
                title={hasEvent ? "Event scheduled" : undefined}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className="ansi-card bbs-node"
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 50,
      }}
    >
      {/* Draggable Terminal Window Header */}
      <div className="ansi-card-header" style={{ cursor: "default" }}>
        {/* Preserving spaces in SPS BBS via non-breaking spaces */}
        <span style={{ fontFamily: "monospace", whiteSpace: "pre" }}>
          ┌─── S P S{"\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0"}B B S ───┐
        </span>

        {/* Integrated HUD Controls inside the terminal header */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            className="bbs-tui-btn"
            onClick={onThemeToggle}
            title="Toggle Color Theme"
            style={{ fontSize: "10px", padding: "0 4px" }}
          >
            [{activeTheme.toUpperCase()}]
          </button>
          <button
            type="button"
            className={`bbs-tui-btn ${homeSurface === "board" ? "active" : ""}`}
            onClick={onSetHomeToggle}
            title={homeSurface === "board" ? "Board set as home" : "Set Board as Home"}
            style={{ fontSize: "10px", padding: "0 4px" }}
          >
            [SET AS HOME]
          </button>
          <span style={{ fontSize: "10px", opacity: 0.8, marginLeft: "8px" }}>ONLINE [{port}]</span>
        </div>
      </div>

      {/* Modern Dashboard Tab Controls Row */}
      <div className="bbs-tabs-row">
        {(["home", "tasks", "calendar", "inbox", "journal", "chat", "files", "settings"] as BbsMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`bbs-tui-btn ${currentMode === m ? "active" : ""}`}
            onClick={() => {
              setCurrentMode(m);
              setSelectedJournalId(null);
            }}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Scrollable Terminal Screen Content Area */}
      <div className="ansi-card-body scroll">
        {currentMode === "home" && (
          <div>
            <div className="bbs-ansi-banner glow-text">
              {` ___  ___  ___      ___  ___  ___ 
/ __|| _ \\/ __|    | _ \\| _ \\/ __|
\\__ \\|  _/\\__ \\    | _ <| _ <\\__ \\
|___/|_|  |___/    |___/|___/|___/`}
            </div>
            <div style={{ fontSize: "11px", lineHeight: "1.4", color: "var(--phosphor-text)" }}>
              WELCOME TO THE SPS WORKSPACE TERMINAL v3.0.0
              <br />
              ESTABLISHED: 2026-06-08 LOCAL
              <br />
              GATEWAY LIFE CYCLE: ONLINE ON PORT {port}
              <br />
              --------------------------------------------------
              <br />
              <div style={{ margin: "6px 0", color: "var(--phosphor-glow)", fontWeight: "bold" }}>
                ACTIVE SERVICES SUMMARY:
              </div>
              - Tasks: {allWorkspaceTasks.filter(t => !t.done).length} active todo items
              <br />
              - Inbox Capture: {inboxRows.length} unprocessed clips
              <br />
              - Journal Log: {journalEntries.length} entries indexed
              <br />
              - Swarm Profile: {profileInfo.profileName} ({profileInfo.model})
              <br />
              --------------------------------------------------
              <br />
              Type shortcuts directly or select a tab menu above.
            </div>
          </div>
        )}

        {currentMode === "tasks" && (
          <div>
            <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "6px" }}>
              ACTIVE TASKS CHECKLIST
            </div>
            <div className="bbs-list-container">
              {allWorkspaceTasks.length === 0 ? (
                <div style={{ fontSize: "11px", opacity: 0.5 }}>No tasks found in vault files.</div>
              ) : (
                allWorkspaceTasks.map((t) => (
                  <div key={`${t.pageId}-${t.id}`} className="bbs-list-item">
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div
                        className={`bbs-todo-checkbox ${t.done ? "checked" : ""}`}
                        onClick={() => handleToggleTask(t.index)}
                      >
                        {t.done ? "X" : ""}
                      </div>
                      <span className="bbs-item-text" style={{ textDecoration: t.done ? "line-through" : "none" }}>
                        [{t.index}] {t.text}
                      </span>
                    </div>
                    <span className="bbs-action-link" style={{ fontSize: "10px", opacity: 0.5 }} onClick={() => { selectPage(t.pageId); setSurface("doc"); }}>
                      {t.pageTitle}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "8px" }}>
              * Type 'toggle [number]' to flip status. Type 'todo [text]' to create a new task.
            </div>
          </div>
        )}

        {currentMode === "calendar" && (
          <div>
            <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold" }}>WORKSPACE CALENDAR SCHEDULE</div>
            {renderCalendar()}
            <div style={{ fontSize: "11px", color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "4px" }}>
              UPCOMING EVENTS:
            </div>
            <div className="bbs-list-container">
              {scheduledEvents.map((evt, idx) => (
                <div key={idx} className="bbs-list-item" style={{ fontSize: "11px" }}>
                  <span>{evt.date} {evt.time} | {evt.title}</span>
                  <span className="bbs-action-link" onClick={() => { selectPage("home"); setSurface("doc"); }}>
                    Open Setup
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentMode === "inbox" && (
          <div>
            <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "6px" }}>
              INBOX CAPTURE DECK
            </div>
            <div className="bbs-list-container">
              {inboxRows.length === 0 ? (
                <div style={{ fontSize: "11px", opacity: 0.5 }}>No unprocessed capture items in Inbox.</div>
              ) : (
                inboxRows.map((row) => (
                  <div key={row.path} className="bbs-list-item">
                    <span className="bbs-item-text">📥 {row.title || "Untitled Capture"}</span>
                    <span className="bbs-action-link" onClick={() => { setSurface("inbox"); }}>
                      Process Item
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {currentMode === "journal" && (
          <div>
            {selectedJournalId ? (
              <div>
                <button
                  type="button"
                  className="bbs-tui-btn"
                  onClick={() => setSelectedJournalId(null)}
                  style={{ marginBottom: "6px" }}
                >
                  &lt; Back to Logs
                </button>
                <div style={{ border: "1px dashed var(--phosphor-border)", padding: "6px", background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ fontWeight: "bold", color: "var(--phosphor-glow)", marginBottom: "4px" }}>
                    {meta[selectedJournalId]?.mood} {meta[selectedJournalId]?.title}
                  </div>
                  <div style={{ fontSize: "11px", lineHeight: "1.4", color: "var(--phosphor-text)" }}>
                    {(docs[selectedJournalId] || []).map((b) => (
                      <div key={b.id} style={{ marginBottom: "4px" }}>
                        {b.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "6px" }}>
                  DAILY JOURNAL LOGS
                </div>
                <div className="bbs-list-container">
                  {journalEntries.length === 0 ? (
                    <div style={{ fontSize: "11px", opacity: 0.5 }}>No journal pages found in vault.</div>
                  ) : (
                    journalEntries.map((e) => (
                      <div key={e.id} className="bbs-list-item">
                        <span>{e.mood} {e.date} | {e.title}</span>
                        <div className="bbs-item-actions">
                          <span className="bbs-action-link" onClick={() => setSelectedJournalId(e.id)}>
                            [Read Log]
                          </span>
                          <span className="bbs-action-link" onClick={() => { selectPage(e.id); setSurface("doc"); }}>
                            [Edit]
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "8px" }}>
                  * Type 'log [text]' to quick append notes to today's log entries.
                </div>
              </div>
            )}
          </div>
        )}

        {currentMode === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "4px" }}>
              AI ASSISTANT TERMINAL
            </div>
            <div className="bbs-chat-log">
              {chatLogs.map((log, idx) => (
                <div key={idx} className={`bbs-chat-msg ${log.sender.toLowerCase()}`}>
                  <span className="chat-sender" style={{ fontWeight: "bold", marginRight: "8px" }}>
                    {log.sender.toUpperCase()}&gt;
                  </span>
                  <span className="chat-text" style={{ whiteSpace: "pre-wrap" }}>
                    {log.text}
                  </span>
                </div>
              ))}
              {chatLoading && <div style={{ fontSize: "15px", opacity: 0.5 }}>Louis thinking...</div>}
              <div ref={outputEndRef} />
            </div>
          </div>
        )}

        {currentMode === "files" && (
          <div>
            <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "6px" }}>
              WORKSPACE FILES DIRECTORY
            </div>
            <div className="bbs-list-container">
              {allPages.map((p) => {
                return (
                  <div key={p.id} className="bbs-list-item">
                    <span className="bbs-item-text" style={{ fontWeight: p.id === "home" ? "bold" : "normal" }}>
                      {p.meta.icon} {p.meta.title}
                    </span>
                    <div className="bbs-item-actions">
                      <span className="bbs-action-link" onClick={() => { selectPage(p.id); setSurface("doc"); }}>
                        [OPEN EDITOR]
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {currentMode === "settings" && (
          <div style={{ fontSize: "11px", lineHeight: "1.4" }}>
            <div style={{ color: "var(--phosphor-glow)", fontWeight: "bold", marginBottom: "6px" }}>
              SYSTEM DIAGNOSTICS & TELEMETRY
            </div>
            Active Telemetry Profile: {profileInfo.profileName}
            <br />
            Gateway Lifecycle Host: localhost:{port}
            <br />
            Database Note Indexer status: Rebuilt (.note-index.db)
            <br />
            Active Themes: monochrome-{activeTheme}
            <br />
            --------------------------------------------------
            <div style={{ marginTop: "8px", display: "flex", gap: "10px" }}>
              <button type="button" className="bbs-tui-btn" onClick={() => setChatLogs([])}>
                Wipe Chat History
              </button>
            </div>
          </div>
        )}
        <div ref={outputEndRef} />
      </div>

      {/* Interactive Command Prompt Line */}
      <form onSubmit={handleFormSubmit} className="ansi-card-prompt">
        <span>
          {currentMode === "chat" ? "LOUIS" : currentMode.toUpperCase()}&gt;
        </span>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder={
            currentMode === "chat"
              ? "Ask Louis something..."
              : currentMode === "tasks"
              ? "type add [task], toggle [num]..."
              : currentMode === "journal"
              ? "type log [text]..."
              : "type command or select tab..."
          }
          autoComplete="off"
          autoCapitalize="off"
        />
      </form>
    </div>
  );
}
