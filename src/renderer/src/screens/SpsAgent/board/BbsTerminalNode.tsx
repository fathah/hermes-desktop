import { useState, useRef, useEffect } from "react";
import type { PageMeta } from "../types";

interface BbsTerminalNodeProps {
  x: number;
  y: number;
  activeTheme: "green" | "amber";
  onThemeToggle: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onEjectPage: (pageId: string) => void;
  allPages: { id: string; meta: PageMeta }[];
}

export function BbsTerminalNode({
  x,
  y,
  activeTheme,
  onThemeToggle,
  onDragStart,
  onEjectPage,
  allPages,
}: BbsTerminalNodeProps) {
  const [inputVal, setInputVal] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([
    "WELCOME TO NOUS HERMES BBS v1.5.0",
    "ESTABLISHED: 2026-06-07 20:49 LOCAL",
    "SPAWNING GATEWAY LIFE CYCLE: ONLINE ON PORT 8642",
    "TYPE 'help' FOR A LIST OF SHELL COMMANDS.",
    "--------------------------------------------------",
    "CHOOSE MENU OPTION OR TYPE COMMAND AT PROMPT:",
  ]);

  const [profileInfo, setProfileInfo] = useState<{
    profileName: string;
    model: string;
    gatewayRunning: boolean;
  }>({
    profileName: "default",
    model: "Llama-3-Hermes",
    gatewayRunning: true,
  });

  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLines]);

  useEffect(() => {
    const api = (window as any).hermesAPI;
    if (!api?.listProfiles) return;
    api
      .listProfiles()
      .then((profiles: any[]) => {
        const active = profiles.find((p) => p.isActive) || profiles[0];
        if (active) {
          setProfileInfo({
            profileName: active.name,
            model: active.model,
            gatewayRunning: active.gatewayRunning,
          });
        }
      })
      .catch(() => {});
  }, []);

  const printLine = (msg: string) => {
    setTerminalLines((prev) => [...prev, msg]);
  };

  const executeCommand = (cmd: string) => {
    const cleanCmd = cmd.trim();
    if (!cleanCmd) return;

    printLine(`> ${cleanCmd}`);

    const parts = cleanCmd.toLowerCase().split(" ");
    const action = parts[0];

    switch (action) {
      case "help":
        setTerminalLines((prev) => [
          ...prev,
          "BBS Keyboard Shortcuts / Shell Commands:",
          "  [m]essage - List agent messages & profiles",
          "  [f]iles   - List all vault pages for ejection",
          "  [s]ysop   - Trigger SysOp Assistant consultation",
          "  [u]ser    - Toggle monochrome screen theme (green/amber)",
          "  help      - Print this guide",
          "  eject <id>- Place page <id> onto the canvas grid",
          "  clear     - Wipe shell logs",
        ]);
        break;
      case "m":
      case "message":
      case "messages":
        setTerminalLines((prev) => [
          ...prev,
          "--- ACTIVE SWARM DIRECTORY ---",
          `[PROFILE] ${profileInfo.profileName}: Running model ${profileInfo.model}`,
          `[GATEWAY] Status: ${profileInfo.gatewayRunning ? "ONLINE" : "OFFLINE"}`,
          "[AGENT] Louis (Principal) - STATUS: Idle, monitoring vault",
          "[AGENT] Researcher - STATUS: Ingestion pipeline active",
          "[SYSTEM] SQLite Note Indexer - Rebuilt successfully",
        ]);
        break;
      case "f":
      case "files":
      case "list":
        if (allPages.length === 0) {
          printLine("No files found in active vault.");
        } else {
          setTerminalLines((prev) => [
            ...prev,
            "--- VAULT PAGES AVAILABLE FOR EJECTION ---",
            ...allPages.map(
              (p) => `  [ID: ${p.id.slice(-6)}] ${p.meta.title || "Untitled"}`,
            ),
            "Type 'eject <id>' to spawn page onto corkboard grid.",
          ]);
        }
        break;
      case "s":
      case "sysop":
        setTerminalLines((prev) => [
          ...prev,
          "SysOp: Louis AI Principal has been alerted.",
          "Louis: 'Ready to catalog your notes, operator. Place them on the grid.'",
        ]);
        break;
      case "u":
      case "theme":
      case "user":
        onThemeToggle();
        printLine(
          `Monochrome display theme toggled. Active: ${
            activeTheme === "green" ? "Amber" : "Green"
          }`,
        );
        break;
      case "eject": {
        const targetIdSlug = parts[1];
        if (!targetIdSlug) {
          printLine("Usage: eject <page_id_suffix>");
          break;
        }
        const matchedPage = allPages.find(
          (p) =>
            p.id.toLowerCase().endsWith(targetIdSlug) ||
            p.id.toLowerCase() === targetIdSlug,
        );
        if (matchedPage) {
          onEjectPage(matchedPage.id);
          printLine(
            `Ejected file: ${matchedPage.meta.title} onto board coordinate center.`,
          );
        } else {
          printLine(`Error: Page matching suffix '${targetIdSlug}' not found.`);
        }
        break;
      }
      case "clear":
        setTerminalLines([]);
        break;
      default:
        printLine(
          `Unknown terminal command: ${action}. Type 'help' for support.`,
        );
        break;
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = inputVal.trim();
    if (!cmd) return;
    executeCommand(cmd);
    setInputVal("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const clean = val.trim().toLowerCase();
    if (clean === "m" || clean === "f" || clean === "s" || clean === "u") {
      executeCommand(clean);
      setInputVal("");
    } else {
      setInputVal(val);
    }
  };

  return (
    <div
      className="ansi-card bbs-node"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        width: 380,
        height: 350,
        zIndex: 50,
      }}
    >
      <div className="ansi-card-header" onPointerDown={onDragStart}>
        <span>┌─── H E R M E S B B S ───┐</span>
        <span style={{ fontSize: "10px", opacity: 0.8 }}>ONLINE [8642]</span>
      </div>

      <div className="ansi-card-body scroll">
        <div className="bbs-ansi-banner glow-text">
          {` _  _ ___ ___ _  _ ___ ___
| || | __| _ \\ \\/ | __/ __|
| __ | _||   /\\  /| _|\\__ \\
|_||_|___|_|_\\_\\/ |___|___/ BBS`}
        </div>

        <div
          style={{
            flex: 1,
            fontSize: "11px",
            lineHeight: "1.3",
            color: "var(--phosphor-text)",
          }}
        >
          {terminalLines.map((line, idx) => (
            <div key={idx} style={{ marginBottom: "2px" }}>
              {line}
            </div>
          ))}
          <div ref={outputEndRef} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          padding: "4px 8px",
          borderTop: "1px dashed var(--phosphor-border)",
          fontSize: "11px",
          fontFamily: "monospace",
          background: "rgba(0, 0, 0, 0.2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--phosphor-text)", opacity: 0.6 }}>
          TUI:
        </span>
        <button
          type="button"
          onClick={() => executeCommand("message")}
          className="bbs-tui-btn"
        >
          [M]essages
        </button>
        <button
          type="button"
          onClick={() => executeCommand("files")}
          className="bbs-tui-btn"
        >
          [F]iles
        </button>
        <button
          type="button"
          onClick={() => executeCommand("sysop")}
          className="bbs-tui-btn"
        >
          [S]ysop
        </button>
        <button
          type="button"
          onClick={() => executeCommand("user")}
          className="bbs-tui-btn"
        >
          [U]ser Theme
        </button>
        <button
          type="button"
          onClick={() => executeCommand("clear")}
          className="bbs-tui-btn"
        >
          [C]lear
        </button>
      </div>

      <form onSubmit={handleFormSubmit} className="ansi-card-prompt">
        <span>BBS&gt;</span>
        <input
          type="text"
          value={inputVal}
          onChange={handleInputChange}
          placeholder="type m, f, s, u or command..."
          autoComplete="off"
          autoCapitalize="off"
        />
      </form>
    </div>
  );
}
