import { useEffect, useRef, useState } from "react";
import { Search, X } from "../../assets/icons";

type WorkspaceSearchResult =
  | { kind: "workspace"; path: string; title: string; snippet: string }
  | { kind: "obsidian"; path: string; title: string; snippet: string }
  | {
      kind: "session";
      sessionId: string;
      title: string | null;
      snippet: string;
    }
  | { kind: "admin"; view: string; title: string }
  | { kind: "command"; command: string; title: string };

interface CommandPaletteProps {
  open: boolean;
  profile: string;
  onClose: () => void;
  onSelectWorkspace: (path: string) => void;
  onSelectAdmin: (view: string) => void;
  onSelectSession: (sessionId: string) => void;
  onRunCommand?: (command: string) => void;
  onOpenWorkspaceInTab?: (path: string) => void;
  onOpenWorkspaceInWindow?: (path: string) => void;
}

function resultLabel(result: WorkspaceSearchResult): string {
  if (result.kind === "workspace" || result.kind === "obsidian") {
    return result.title;
  }
  if (result.kind === "session") return result.title || "New conversation";
  if (result.kind === "command") return result.command;
  return result.title;
}

type PaletteFilter = "all" | WorkspaceSearchResult["kind"];

export default function CommandPalette({
  open,
  profile,
  onClose,
  onSelectWorkspace,
  onSelectAdmin,
  onSelectSession,
  onRunCommand,
  onOpenWorkspaceInTab,
  onOpenWorkspaceInWindow,
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [filter, setFilter] = useState<PaletteFilter>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setFilter("all");
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.hermesAPI
        .searchWorkspaceAndSessions(query, 12, profile)
        .then((next) => {
          if (!cancelled) {
            setResults(next);
            setSelectedIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, profile, query]);

  if (!open) return null;

  const visibleResults =
    filter === "all"
      ? results
      : results.filter((result) => result.kind === filter);

  function select(result: WorkspaceSearchResult): void {
    if (result.kind === "workspace" || result.kind === "obsidian") {
      onSelectWorkspace(result.path);
    }
    if (result.kind === "admin") onSelectAdmin(result.view);
    if (result.kind === "session") onSelectSession(result.sessionId);
    if (result.kind === "command") onRunCommand?.(result.command);
    onClose();
  }

  function copyLink(result: WorkspaceSearchResult): void {
    if (result.kind !== "workspace" && result.kind !== "obsidian") return;
    const scheme = result.kind === "obsidian" ? "obsidian" : "hermes-workspace";
    navigator.clipboard
      ?.writeText(`${scheme}://${encodeURIComponent(result.path)}`)
      .catch(() => undefined);
  }

  return (
    <div className="command-palette-backdrop" role="presentation">
      <div
        className="command-palette"
        role="dialog"
        aria-label="Command palette"
      >
        <div className="command-palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search pages, sessions, commands..."
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  Math.max(0, Math.min(visibleResults.length - 1, index + 1)),
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === "Enter" && visibleResults[selectedIndex]) {
                select(visibleResults[selectedIndex]);
              }
            }}
          />
          <button
            type="button"
            aria-label="Close command palette"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="command-palette-filters" aria-label="Search filters">
          {[
            ["all", "All"],
            ["workspace", "Pages"],
            ["session", "Sessions"],
            ["admin", "Admin"],
            ["command", "Commands"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => {
                setFilter(value as PaletteFilter);
                setSelectedIndex(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="command-palette-results">
          {visibleResults.map((result, index) => (
            <button
              key={`${result.kind}-${index}-${resultLabel(result)}`}
              type="button"
              className={index === selectedIndex ? "active" : ""}
              onClick={() => select(result)}
            >
              <span className="command-palette-kind">{result.kind}</span>
              <span>{resultLabel(result)}</span>
              {"snippet" in result && result.snippet && (
                <small>{result.snippet}</small>
              )}
              {(result.kind === "workspace" || result.kind === "obsidian") && (
                <span className="command-palette-actions">
                  <span
                    role="button"
                    tabIndex={-1}
                    className="command-palette-copy"
                    onClick={(event) => {
                      event.stopPropagation();
                      copyLink(result);
                    }}
                  >
                    Copy link
                  </span>
                  {result.kind === "workspace" && (
                    <>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="command-palette-copy"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenWorkspaceInTab?.(result.path);
                          onClose();
                        }}
                      >
                        Open tab
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="command-palette-copy"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenWorkspaceInWindow?.(result.path);
                          onClose();
                        }}
                      >
                        Open window
                      </span>
                    </>
                  )}
                </span>
              )}
            </button>
          ))}
          {visibleResults.length === 0 && (
            <div className="command-palette-empty">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
