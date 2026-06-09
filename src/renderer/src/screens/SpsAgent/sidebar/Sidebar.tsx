// Sidebar.tsx — workspace rail. Notion-3.1 grammar: an always-visible top icon
// row, then named/toggleable/collapsible sections (Meetings/Recents/Agents/
// Shared/Private/Apps), a persistent "New chat" launcher, and the identity foot.
// Identity is derived from the active Hermes profile (demo fallback offline).
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { DropWhere } from "../lib/tree";
import type { TreeDnd } from "./dnd";
import { TreeNode } from "./TreeNode";
import { SidebarSection } from "./SidebarSection";
import { SidebarRecents } from "./SidebarRecents";
import { SidebarAgents } from "./SidebarAgents";
import { SidebarApps, SidebarMeetings, SidebarShared } from "./SidebarStubs";
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
  workspace: "SPS Agent",
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
  const openJournal = useStore((s) => s.openJournal);
  const startNewChat = useStore((s) => s.startNewChat);
  const setResearchOpen = useStore((s) => s.setResearchOpen);
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

  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: DropWhere } | null>(
    null,
  );
  const [obsidianOpen, setObsidianOpen] = useState(true);
  const dnd: TreeDnd = { drag, setDrag, over, setOver, onMove: movePage };
  const identity = useIdentity();
  // Live count of unprocessed captures for the Inbox badge.
  const { rows: inboxRows } = useVaultQuery(INBOX_FOLDER, [
    { prop: "status", op: "eq", value: "unprocessed" },
  ]);
  const inboxCount = inboxRows.length;

  const openPalette = (): void => setPaletteOpen(true);
  const newPage = (): void => setTemplatesOpen({ parent: null });
  // Agents are Hermes profiles; profile creation lives in the admin panel (⌘,).
  // Start a guided chat that walks the user through setting one up.
  const newAgent = (): void =>
    startNewChat(
      "Help me set up a new agent (Hermes profile): pick a name, model, and the tools it should have.",
    );

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
        <button
          type="button"
          className={`nav-item ${
            (homeSurface === "doc" &&
              activeId === "home" &&
              surface === "doc") ||
            (homeSurface !== "doc" && surface === homeSurface)
              ? "active"
              : ""
          }`}
          onClick={() => {
            if (homeSurface === "doc") {
              selectDoc("home");
            } else {
              setSurface(homeSurface);
            }
          }}
        >
          <Icon name="home" size={17} />
          <span className="nav-label">Home</span>
        </button>
        <button
          type="button"
          className={`nav-item ${surface === "inbox" ? "active" : ""}`}
          onClick={() => setSurface("inbox")}
        >
          <Icon name="inbox" size={17} />
          <span className="nav-label">Inbox</span>
          {inboxCount > 0 && <span className="nav-kbd">{inboxCount}</span>}
        </button>
        <button
          type="button"
          className={`nav-item ${surface === "journal" ? "active" : ""}`}
          onClick={() => openJournal()}
        >
          <Icon name="calendar" size={17} />
          <span className="nav-label">Journal</span>
        </button>

        <SidebarSection id="aiAssistant" label="AI Assistant">
          <button
            type="button"
            className={`nav-item ${surface === "chats" ? "active" : ""}`}
            onClick={() => setSurface("chats")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="comment" size={17} />
            <span className="nav-label">AI Chats</span>
          </button>
          <button
            type="button"
            className={`nav-item ${surface === "ask" ? "active" : ""}`}
            onClick={() => setSurface("ask")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="sparkle" size={17} />
            <span className="nav-label">Ask</span>
          </button>
          <button
            type="button"
            className={`nav-item ${surface === "agent" ? "active" : ""}`}
            onClick={() => setSurface("agent")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="code" size={17} />
            <span className="nav-label">Agent Console</span>
          </button>
          <button
            type="button"
            className={`nav-item ${surface === "you" ? "active" : ""}`}
            onClick={() => setSurface("you")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="wand" size={17} />
            <span className="nav-label">You</span>
          </button>
        </SidebarSection>

        <SidebarSection id="workspaceTools" label="Workspace Tools">
          <button
            type="button"
            className={`nav-item ${surface === "cockpit" ? "active" : ""}`}
            onClick={() => setSurface("cockpit")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="board" size={17} />
            <span className="nav-label">Cockpit</span>
          </button>
          <button
            type="button"
            className={`nav-item ${surface === "graph" ? "active" : ""}`}
            onClick={() => setSurface("graph")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="pageGraph" size={17} />
            <span className="nav-label">Graph</span>
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => setResearchOpen(true)}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="doc" size={17} />
            <span className="nav-label">Research</span>
          </button>
          <button
            type="button"
            className={`nav-item ${surface === "equity" ? "active" : ""}`}
            onClick={() => setSurface("equity")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="table" size={17} />
            <span className="nav-label">Equity</span>
          </button>
          <button
            type="button"
            className={`nav-item ${surface === "insights" ? "active" : ""}`}
            onClick={() => setSurface("insights")}
            style={{ paddingLeft: 24 }}
          >
            <Icon name="board" size={17} />
            <span className="nav-label">Insights</span>
          </button>
        </SidebarSection>

        <SidebarSection id="meetings" label="Meetings">
          <SidebarMeetings />
        </SidebarSection>

        <SidebarSection id="recents" label="Recents">
          <SidebarRecents />
        </SidebarSection>

        <SidebarSection
          id="agents"
          label="Agents"
          onAdd={newAgent}
          addTitle="New agent"
        >
          <SidebarAgents />
        </SidebarSection>

        <SidebarSection id="shared" label="Shared">
          <SidebarShared />
        </SidebarSection>

        <SidebarSection
          id="private"
          label="Private"
          onAdd={newPage}
          addTitle="New page"
        >
          {/* Journal entries are pages too, but they live behind the calendar
              surface — keep them out of the Private tree to avoid clutter. */}
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
          <div className="nav-item" onClick={newPage}>
            <Icon name="plus" size={17} />
            <span className="nav-label">Add new</span>
          </div>
        </SidebarSection>

        <div className="sec-group">
          <div className="sec">
            <button
              type="button"
              className="sec-head"
              onClick={() => setObsidianOpen(!obsidianOpen)}
              aria-expanded={obsidianOpen}
            >
              <span className={`sec-chev ${obsidianOpen ? "open" : ""}`}>
                <Icon name="chevR" size={12} />
              </span>
              <span className="sec-label">Obsidian Vault</span>
            </button>
          </div>
          {obsidianOpen && <ObsidianExplorer />}
        </div>

        <SidebarSection id="apps" label="Apps">
          <SidebarApps />
        </SidebarSection>

        <div className="sec sec-static">
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
          <small>Hermes Agent</small>
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
