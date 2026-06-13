// Sidebar.tsx — workspace rail. Notion-3.1 grammar: an always-visible top icon
// row, then named/toggleable/collapsible sections (Recents/Private), the
// Obsidian Vault explorer, a persistent "New chat" launcher, and the identity
// foot. Identity is derived from the active Hermes profile (demo fallback offline).
import { useEffect, useState, useRef } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { DropWhere } from "../lib/tree";
import type { TreeDnd } from "./dnd";
import { TreeNode } from "./TreeNode";
import { SidebarSection } from "./SidebarSection";
import { SidebarRecents } from "./SidebarRecents";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { INBOX_FOLDER } from "../inbox/capture";
import { ObsidianExplorer } from "./ObsidianExplorer";
import { StatusChip } from "./StatusChip";
import { openSettings } from "../../../lib/openSettings";

interface Identity {
  workspace: string;
  user: string;
  initial: string;
}

const DEMO_IDENTITY: Identity = {
  workspace: "SPS",
  user: "You",
  initial: "S",
};

/** Derive the rail identity from the active Hermes profile (fallback: demo). */
function useIdentity(): Identity {
  const [identity, setIdentity] = useState<Identity>(DEMO_IDENTITY);
  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.listProfiles) return;
    api
      .listProfiles()
      .then((rows) => {
        const active = rows.find((r) => r.isActive) ?? rows[0];
        if (!active || cancelled) return;
        const name = active.name;
        const pretty = name.charAt(0).toUpperCase() + name.slice(1);
        setIdentity({
          workspace: pretty,
          user: pretty,
          initial: pretty.charAt(0) || "H",
        });
      })
      .catch(() => {
        /* offline — keep demo identity */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return identity;
}

export function Sidebar() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const activeId = useStore((s) => s.page);
  const surface = useStore((s) => s.surface);
  const setSurface = useStore((s) => s.setSurface);
  const selectPage = useStore((s) => s.selectPage);
  const startNewChat = useStore((s) => s.startNewChat);
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const setAgentTasksOpen = useStore((s) => s.setAgentTasksOpen);
  const homeSurface = useStore((s) => s.t.homeSurface ?? "doc");
  // Selecting a page always returns to the document surface.
  const selectDoc = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };
  const newSubPage = useStore((s) => s.newSubPage);
  const renamePage = useStore((s) => s.renamePage);
  const deletePage = useStore((s) => s.deletePage);
  const movePage = useStore((s) => s.movePage);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);
  const setTweak = useStore((s) => s.setTweak);
  const importPdf = useStore((s) => s.importPdf);

  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: DropWhere } | null>(
    null,
  );
  const [obsidianOpen, setObsidianOpen] = useState(true);
  const dnd: TreeDnd = { drag, setDrag, over, setOver, onMove: movePage };
  const identity = useIdentity();
  const obsidianBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (obsidianBtnRef.current) {
      obsidianBtnRef.current.setAttribute("aria-expanded", String(obsidianOpen));
    }
  }, [obsidianOpen]);
  // Live count of unprocessed captures for the Inbox badge.
  const { rows: inboxRows } = useVaultQuery(INBOX_FOLDER, [
    { prop: "status", op: "eq", value: "unprocessed" },
  ]);
  const inboxCount = inboxRows.length;

  const openPalette = (): void => setPaletteOpen(true);
  const newPage = (): void => setTemplatesOpen({ parent: null });
  return (
    <nav className="rail">
      <div className="rail-top">
        <span className="wmark">
          <span>{identity.initial}</span>
        </span>
        <span className="wname">{identity.workspace}</span>
        <span className="rail-chev">
          <Icon name="chevD" size={15} />
        </span>
        <button
          className="rail-collapse"
          title="Hide sidebar"
          aria-label="Hide sidebar"
          onClick={(e) => {
            e.stopPropagation();
            setTweak("sidebar", "hidden");
          }}
        >
          <Icon name="panelLeft" size={16} />
        </button>
      </div>

      <div className="rail-scroll scroll">
        <button type="button" className="nav-item" onClick={openPalette}>
          <Icon name="search" size={17} />
          <span className="nav-label">Search</span>
          <span className="nav-kbd">⌘K</span>
        </button>

        {/* ==================== WING 1: MY LIBRARY ==================== */}
        <div className="wing-group">
          <div className="wing-header">
            <span className="wing-title">📖 My Library</span>
          </div>

          <button
            type="button"
            className={`nav-item ${
              (homeSurface === "doc" && activeId === "home" && surface === "doc")
                ? "active"
                : ""
            }`}
            onClick={() => selectDoc("home")}
          >
            <Icon name="home" size={17} />
            <span className="nav-label">Wiki Home</span>
          </button>

          <button
            type="button"
            className={`nav-item ${surface === "learning" ? "active" : ""}`}
            onClick={() => setSurface("learning")}
          >
            <Icon name="sparkle" size={17} />
            <span className="nav-label">Teach Me</span>
          </button>

          <button
            type="button"
            className={`nav-item ${surface === "graph" ? "active" : ""}`}
            onClick={() => setSurface("graph")}
          >
            <Icon name="pageGraph" size={17} />
            <span className="nav-label">Graph View</span>
          </button>

          {/* Quick Ingest Tray */}
          <div className="ingest-tray">
            <button
              type="button"
              className="ingest-btn"
              title="Import PDF"
              onClick={async () => {
                try {
                  await importPdf();
                } catch (err) {
                  console.error(err);
                }
              }}
            >
              <Icon name="doc" size={13} />
              <span>PDF</span>
            </button>
            <button
              type="button"
              className={`ingest-btn ${surface === "inbox" ? "active" : ""}`}
              title="Inbox / Captures"
              onClick={() => setSurface("inbox")}
            >
              <Icon name="inbox" size={13} />
              <span>Inbox {inboxCount > 0 ? `(${inboxCount})` : ""}</span>
            </button>
          </div>

          {/* Collapsible Sub-sections inside Library */}
          <SidebarSection id="recents" label="Recents">
            <SidebarRecents />
          </SidebarSection>

          <SidebarSection
            id="private"
            label="Notes"
            onAdd={newPage}
            addTitle="New page"
          >
            {tree
              .filter((n) => !meta[n.id]?.journal)
              .map((n) => (
                <TreeNode
                  key={n.id}
                  node={n}
                  depth={0}
                  meta={meta}
                  activeId={activeId}
                  onSelect={selectDoc}
                  onNewSubPage={newSubPage}
                  onRename={renamePage}
                  onDelete={deletePage}
                  dnd={dnd}
                />
              ))}
            {tree.length === 0 && (
              <div
                className="tree-row"
                style={{ color: "var(--tx-4)", cursor: "default" }}
              >
                <span className="tree-toggle leaf"></span>No pages
              </div>
            )}
            <div className="nav-item" onClick={newPage} style={{ paddingLeft: 12 }}>
              <Icon name="plus" size={14} />
              <span className="nav-label">Add page</span>
            </div>
          </SidebarSection>

          <div className="sec-group" style={{ marginTop: 4 }}>
            <div className="sec">
              <button
                ref={obsidianBtnRef}
                type="button"
                className="sec-head"
                onClick={() => setObsidianOpen(!obsidianOpen)}
              >
                <span className={`sec-chev ${obsidianOpen ? "open" : ""}`}>
                  <Icon name="chevR" size={12} />
                </span>
                <span className="sec-label">Obsidian Vault</span>
              </button>
            </div>
            {obsidianOpen && <ObsidianExplorer />}
          </div>
        </div>

        {/* ==================== WING 2: MY WORK ==================== */}
        <div className="wing-group">
          <div className="wing-header">
            <span className="wing-title">🛠️ My Work</span>
          </div>

          <button
            type="button"
            className={`nav-item ${surface === "work" ? "active" : ""}`}
            onClick={() => setSurface("work")}
          >
            <Icon name="board" size={17} />
            <span className="nav-label">My Work</span>
          </button>

          <button
            type="button"
            className="nav-item"
            onClick={() => setScheduledOpen(true)}
          >
            <Icon name="clock" size={17} />
            <span className="nav-label">Automations</span>
          </button>

          <button
            type="button"
            className="nav-item"
            onClick={() => setAgentTasksOpen(true)}
          >
            <Icon name="board" size={17} />
            <span className="nav-label">Active Tasks</span>
          </button>
        </div>

        {/* ==================== WING 3: MY ADVISOR ==================== */}
        <div className="wing-group">
          <div className="wing-header">
            <span className="wing-title">🎓 My Advisor</span>
          </div>

          <button
            type="button"
            className={`nav-item ${surface === "chats" ? "active" : ""}`}
            onClick={() => setSurface("chats")}
          >
            <Icon name="comment" size={17} />
            <span className="nav-label">Converse</span>
          </button>

          <button
            type="button"
            className={`nav-item ${surface === "you" ? "active" : ""}`}
            onClick={() => setSurface("you")}
            title="Personalize alignment settings"
          >
            <Icon name="wand" size={17} />
            <span className="nav-label">My Alignment</span>
          </button>
        </div>

        {/* ==================== WING 4: MY RESEARCH ==================== */}
        <div className="wing-group">
          <div className="wing-header">
            <span className="wing-title">🔭 My Research</span>
          </div>

          <button
            type="button"
            className="nav-item"
            onClick={() => setResearchOpen(true)}
          >
            <Icon name="doc" size={17} />
            <span className="nav-label">Deep Research</span>
          </button>

          <button
            type="button"
            className={`nav-item ${surface === "equity" ? "active" : ""}`}
            onClick={() => setSurface("equity")}
          >
            <Icon name="table" size={17} />
            <span className="nav-label">Equity Research</span>
          </button>

          <button
            type="button"
            className={`nav-item ${surface === "insights" ? "active" : ""}`}
            onClick={() => setSurface("insights")}
          >
            <Icon name="board" size={17} />
            <span className="nav-label">Insights</span>
          </button>
        </div>

        <div className="sec sec-static" style={{ marginTop: 12 }}>
          <span className="sec-label">More</span>
        </div>
        <div className="nav-item" onClick={() => setTrashOpen(true)}>
          <Icon name="trash" size={17} />
          <span className="nav-label">Trash</span>
        </div>
      </div>

      <div className="rail-newchat-bar">
        <button className="rail-newchat" onClick={() => startNewChat()}>
          <Icon name="sparkle" size={16} />
          <span>New chat</span>
          <span className="rail-newchat-kbd">⌘O</span>
        </button>
        <button className="rail-compose" title="New page" onClick={newPage}>
          <Icon name="callout" size={16} />
        </button>
      </div>

      <StatusChip />

      <div className="rail-foot">
        <span className="avatar">{identity.initial}</span>
        <span className="rail-foot-name">
          {identity.user}
          <small>SPS</small>
        </span>
        <button
          className="rail-foot-gear"
          title="Appearance"
          aria-label="Appearance"
          onClick={() => setTweaksOpen(true)}
        >
          <Icon name="sun" size={16} />
        </button>
        <button
          className="rail-foot-gear"
          title="Settings (⌘,)"
          aria-label="Settings"
          onClick={() => openSettings()}
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
    </nav>
  );
}
