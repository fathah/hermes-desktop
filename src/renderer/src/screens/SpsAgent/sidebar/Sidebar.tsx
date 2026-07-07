// Sidebar.tsx — workspace rail. Notion-3.1 grammar: an always-visible top icon
// row, then named/toggleable/collapsible sections (Recents/Private), the
// Obsidian Vault explorer, a persistent "New chat" launcher, and the identity
// foot. Identity is derived from the active Hermes profile (demo fallback offline).
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/iconPaths";
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
import brandLogo from "../../../assets/icon.png";
import type { Surface } from "../store/storeTypes";

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

type PackId =
  | "learning"
  | "research"
  | "health"
  | "equity"
  | "content"
  | "deck"
  | "obsidian"
  | "graph";

const PACKS_KEY = "sps-agent-enabled-packs-v1";
const DEFAULT_PACKS: Record<PackId, boolean> = {
  learning: false,
  research: false,
  health: false,
  equity: false,
  content: false,
  deck: false,
  obsidian: false,
  graph: false,
};

function loadPacks(): Record<PackId, boolean> {
  try {
    const raw = localStorage.getItem(PACKS_KEY);
    if (!raw) return DEFAULT_PACKS;
    return { ...DEFAULT_PACKS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PACKS;
  }
}

function savePacks(packs: Record<PackId, boolean>): void {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
  } catch {
    /* non-fatal UI preference */
  }
}

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
        const pretty =
          name === "default"
            ? "SPS Agent"
            : name.charAt(0).toUpperCase() + name.slice(1);
        const user = name === "default" ? "Default" : pretty;
        const initial = name === "default" ? "S" : pretty.charAt(0) || "H";
        setIdentity({
          workspace: pretty,
          user: user,
          initial: initial,
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
  const tweaksOpen = useStore((s) => s.tweaksOpen);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);
  const setTweak = useStore((s) => s.setTweak);
  const importPdf = useStore((s) => s.importPdf);

  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: DropWhere } | null>(
    null,
  );
  const dnd: TreeDnd = { drag, setDrag, over, setOver, onMove: movePage };
  const identity = useIdentity();

  const sidebar = useStore((s) => s.t.sidebar);
  const isIconsMode = sidebar === "icons";

  const [libraryOpen, setLibraryOpen] = useState(
    () => localStorage.getItem("sps-wing-core-library") !== "false",
  );
  const [packsOpen, setPacksOpen] = useState(
    () => localStorage.getItem("sps-wing-packs") === "true",
  );
  const [packs, setPacks] = useState<Record<PackId, boolean>>(loadPacks);

  const toggleLibrary = (): void => {
    const next = !libraryOpen;
    setLibraryOpen(next);
    localStorage.setItem("sps-wing-core-library", String(next));
  };
  const togglePacksOpen = (): void => {
    const next = !packsOpen;
    setPacksOpen(next);
    localStorage.setItem("sps-wing-packs", String(next));
  };
  const setPackEnabled = (id: PackId, enabled: boolean): void => {
    const next = { ...packs, [id]: enabled };
    setPacks(next);
    savePacks(next);
  };

  // Live count of unprocessed captures for the Inbox badge.
  const { rows: inboxRows } = useVaultQuery(INBOX_FOLDER, [
    { prop: "status", op: "eq", value: "unprocessed" },
  ]);
  const inboxCount = inboxRows.length;

  const openPalette = (): void => setPaletteOpen(true);
  const newPage = (): void => setTemplatesOpen({ parent: null });
  const openSurface = (next: Surface): void => setSurface(next);
  const renderPackToggle = (id: PackId, label: string): React.JSX.Element => (
    <button
      key={`${id}-enable`}
      type="button"
      className="nav-item pack-toggle-row"
      onClick={() => setPackEnabled(id, !packs[id])}
      title={label}
      aria-label={`${packs[id] ? "Disable" : "Enable"} ${label}`}
    >
      <Icon name={packs[id] ? "check" : "plus"} size={17} />
      <span className="nav-label">{label}</span>
      <span className="pack-state">{packs[id] ? "On" : "Enable"}</span>
    </button>
  );
  const renderPackNav = (
    id: PackId,
    label: string,
    icon: IconName,
    onClick: () => void,
    active = false,
  ): React.JSX.Element | null =>
    packs[id] ? (
      <div key={label} className={`nav-item ${active ? "active" : ""}`}>
        <button
          type="button"
          className="nav-item-main"
          onClick={onClick}
          title={label}
          aria-label={label}
        >
          <Icon name={icon} size={17} />
          <span className="nav-label">{label}</span>
        </button>
        <button
          type="button"
          className="nav-add"
          title={`Disable ${label}`}
          aria-label={`Disable ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setPackEnabled(id, false);
          }}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    ) : null;

  return (
    <nav className="rail">
      <div className="rail-top">
        <span className="wmark">
          <img src={brandLogo} alt="SPS" className="wmark-img" />
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
        <button
          type="button"
          className="nav-item"
          onClick={openPalette}
          title="Search"
          aria-label="Search"
        >
          <Icon name="search" size={17} />
          <span className="nav-label">Search</span>
          <span className="nav-kbd">⌘K</span>
        </button>

        <button
          type="button"
          className={`nav-item ${
            homeSurface === "doc" && activeId === "home" && surface === "doc"
              ? "active"
              : ""
          }`}
          onClick={() => selectDoc("home")}
          title="Home"
          aria-label="Home"
        >
          <Icon name="home" size={17} />
          <span className="nav-label">Home</span>
        </button>

        <button
          type="button"
          className={`nav-item ${surface === "cockpit" ? "active" : ""}`}
          onClick={() => openSurface("cockpit")}
          title="Cockpit"
          aria-label="Cockpit"
        >
          <Icon name="board" size={17} />
          <span className="nav-label">Cockpit</span>
        </button>

        <div className={`nav-item ${surface === "inbox" ? "active" : ""}`}>
          <button
            type="button"
            className="nav-item-main"
            onClick={() => openSurface("inbox")}
            title="Capture"
            aria-label="Capture"
          >
            <Icon name="inbox" size={17} />
            <span className="nav-label">
              Capture {inboxCount > 0 ? `(${inboxCount})` : ""}
            </span>
          </button>
          <button
            type="button"
            className="nav-add"
            title="Import PDF"
            aria-label="Import PDF"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await importPdf();
              } catch (err) {
                console.error(err);
              }
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>

        <button
          type="button"
          className={`nav-item ${surface === "work" ? "active" : ""}`}
          onClick={() => openSurface("work")}
          title="Work"
          aria-label="Work"
        >
          <Icon name="board" size={17} />
          <span className="nav-label">Work</span>
        </button>

        <button
          type="button"
          className={`nav-item ${surface === "chats" ? "active" : ""}`}
          onClick={() => openSurface("chats")}
          title="Assistant"
          aria-label="Assistant"
        >
          <Icon name="comment" size={17} />
          <span className="nav-label">Assistant</span>
        </button>

        <button
          type="button"
          className={`wing-header wing-header-button ${libraryOpen ? "open" : ""}`}
          onClick={toggleLibrary}
        >
          <span className={`wing-chev ${libraryOpen ? "open" : ""}`}>
            <Icon name="chevR" size={11} />
          </span>
          <span className="wing-title">Library</span>
        </button>

        {(libraryOpen || isIconsMode) && (
          <>
            <SidebarSection id="recents" label="Recents">
              <SidebarRecents />
            </SidebarSection>

            <SidebarSection
              id="private"
              label="Pages"
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
                <div className="tree-row color-tx-4-cursor-default">
                  <span className="tree-toggle leaf"></span>No pages
                </div>
              )}
              <button
                type="button"
                className="nav-item pl-12"
                onClick={newPage}
              >
                <Icon name="plus" size={14} />
                <span className="nav-label">Add page</span>
              </button>
            </SidebarSection>
          </>
        )}

        <button
          type="button"
          className={`wing-header wing-header-button ${packsOpen ? "open" : ""}`}
          onClick={togglePacksOpen}
        >
          <span className={`wing-chev ${packsOpen ? "open" : ""}`}>
            <Icon name="chevR" size={11} />
          </span>
          <span className="wing-title">Workspace packs</span>
        </button>

        {(packsOpen || isIconsMode) && (
          <div className="pack-list">
            {renderPackNav(
              "learning",
              "Learning",
              "sparkle",
              () => openSurface("learning"),
              surface === "learning",
            ) ?? renderPackToggle("learning", "Learning")}
            {renderPackNav("research", "Deep Research", "doc", () =>
              setResearchOpen(true),
            ) ?? renderPackToggle("research", "Research")}
            {packs.research && (
              <button
                type="button"
                className={`nav-item ${surface === "rss-reader" ? "active" : ""}`}
                onClick={() => openSurface("rss-reader")}
                title="RSS Reader"
                aria-label="RSS Reader"
              >
                <Icon name="doc" size={17} />
                <span className="nav-label">RSS Reader</span>
              </button>
            )}
            {renderPackNav(
              "graph",
              "Graph",
              "pageGraph",
              () => openSurface("graph"),
              surface === "graph",
            ) ?? renderPackToggle("graph", "Graph")}
            {renderPackNav(
              "health",
              "Health & Ledger",
              "heart",
              () => openSurface("personal-health"),
              surface === "personal-health",
            ) ?? renderPackToggle("health", "Health")}
            {renderPackNav(
              "equity",
              "Equity Research",
              "table",
              () => openSurface("equity"),
              surface === "equity",
            ) ?? renderPackToggle("equity", "Equity")}
            {renderPackNav(
              "content",
              "Content Studio",
              "sparkle",
              () => openSurface("contentStudio"),
              surface === "contentStudio",
            ) ?? renderPackToggle("content", "Content")}
            {renderPackNav(
              "deck",
              "Deck Studio",
              "board",
              () => openSurface("deckStudio"),
              surface === "deckStudio",
            ) ?? renderPackToggle("deck", "Deck")}
            {packs.obsidian ? (
              <div className="sec-group mt-4">
                <div className="sec sec-static">
                  <span className="sec-label">Obsidian</span>
                  <button
                    type="button"
                    className="nav-add"
                    title="Disable Obsidian pack"
                    aria-label="Disable Obsidian pack"
                    onClick={() => setPackEnabled("obsidian", false)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <ObsidianExplorer />
              </div>
            ) : (
              renderPackToggle("obsidian", "Obsidian")
            )}
          </div>
        )}

        <div className="sec sec-static mt-12">
          <span className="sec-label">More</span>
        </div>
        <button
          type="button"
          className={`nav-item ${surface === "journal" ? "active" : ""}`}
          onClick={() => openSurface("journal")}
          title="Journal"
          aria-label="Journal"
        >
          <Icon name="calendar" size={17} />
          <span className="nav-label">Journal</span>
        </button>
        <button
          type="button"
          className={`nav-item ${surface === "activeWork" ? "active" : ""}`}
          onClick={() => openSurface("activeWork")}
          title="Active Work"
          aria-label="Active Work"
        >
          <Icon name="flag" size={17} />
          <span className="nav-label">Active Work</span>
        </button>
        <button
          type="button"
          className={`nav-item ${surface === "memory" ? "active" : ""}`}
          onClick={() => openSurface("memory")}
          title="Memory"
          aria-label="Memory"
        >
          <Icon name="sparkle" size={17} />
          <span className="nav-label">Memory</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => setTrashOpen(true)}
          title="Trash"
          aria-label="Trash"
        >
          <Icon name="trash" size={17} />
          <span className="nav-label">Trash</span>
        </button>
      </div>

      <div className="rail-newchat-bar">
        <button
          className="rail-newchat"
          onClick={() => startNewChat()}
          title="New chat"
          aria-label="New chat"
        >
          <Icon name="sparkle" size={16} />
          <span>New chat</span>
          <span className="rail-newchat-kbd">⌘O</span>
        </button>
        <button
          className="rail-compose"
          title="New page"
          aria-label="New page"
          onClick={newPage}
        >
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
          onClick={() => setTweaksOpen(!tweaksOpen)}
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
