import { useCallback, useEffect, useRef, useState } from "react";
import AgentReviewPanel from "./AgentReviewPanel";
import Chat, { type ChatMessage } from "../Chat/Chat";
import CommandPalette from "./CommandPalette";
import PageCreateDialog from "./PageCreateDialog";
import WorkspaceEditor from "./WorkspaceEditor";
import WorkspaceHeader, { type WorkspaceMode } from "./WorkspaceHeader";
import WorkspaceCommentsPanel from "./WorkspaceCommentsPanel";
import WorkspaceOfflinePanel from "./WorkspaceOfflinePanel";
import WorkspaceSyncedBlocksPanel from "./WorkspaceSyncedBlocksPanel";
import WorkspaceTree from "./WorkspaceTree";

interface WorkspaceFileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: WorkspaceFileNode[];
}

interface WorkspacePageMeta {
  id: string;
  path: string;
  displayName: string;
  parentPath: string | null;
  childOrder: string[];
  favorite: boolean;
  trashed: boolean;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt?: number;
}

interface WorkspaceMetadata {
  version: 1;
  pages: Record<string, WorkspacePageMeta>;
  rootOrder: string[];
  favorites: string[];
  recentVisits: Array<{ path: string; visitedAt: number }>;
}

interface WorkspacePageGraph {
  version: 2;
  pages: Record<string, WorkspacePageMeta>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  favorites: string[];
  recentVisits: Array<{ path: string; visitedAt: number }>;
  backlinks: Record<string, string[]>;
  sidebar: {
    collapsedSections: string[];
    width: number;
    collapsed: boolean;
  };
}

interface AgentWorkspaceProposal {
  id: string;
  path: string;
  baseContent: string;
  proposedContent: string;
  hunks?: Array<{
    id: string;
    blockId?: string;
    before: string;
    after: string;
    status: "pending" | "accepted" | "rejected";
  }>;
  createdAt: number;
  status: "pending";
}

interface WorkspaceHistoryEntry {
  id: string;
  path: string;
  createdAt: number;
  reason: string;
  content: string;
}

interface WorkspaceTemplate {
  id: string;
  kind: "page" | "database-row" | "button";
  title: string;
  content: string;
}

interface WorkspaceSyncedBlock {
  id: string;
  sourcePath: string;
  sourceBlockId: string;
  content: string;
  references: Array<{ path: string; blockId: string }>;
  updatedAt: number;
}

interface WorkspaceComment {
  id: string;
  path: string;
  blockId?: string;
  body: string;
  reminderAt?: number;
  status: "open" | "resolved";
  createdAt: number;
  resolvedAt?: number;
}

interface WorkspaceProps {
  profile: string;
  onOpenAdmin: (view: string) => void;
  onOpenSession?: (sessionId: string) => void;
}

function firstFile(nodes: WorkspaceFileNode[]): string {
  for (const node of nodes) {
    if (node.kind === "file") return node.path;
    const nested = firstFile(node.children ?? []);
    if (nested) return nested;
  }
  return "index.md";
}

function workspaceRootFromHermesHome(home: string): string {
  return `${home.replace(/[\\/]+$/, "")}/workspace`;
}

export default function Workspace({
  profile,
  onOpenAdmin,
  onOpenSession,
}: WorkspaceProps): React.JSX.Element {
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([]);
  const [metadata, setMetadata] = useState<WorkspaceMetadata | null>(null);
  const [pageGraph, setPageGraph] = useState<WorkspacePageGraph | null>(null);
  const [proposals, setProposals] = useState<AgentWorkspaceProposal[]>([]);
  const [selectedPath, setSelectedPath] = useState("index.md");
  const [openTabs, setOpenTabs] = useState<string[]>(["index.md"]);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflictContent, setConflictContent] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<WorkspaceHistoryEntry[]>(
    [],
  );
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [syncedBlocks, setSyncedBlocks] = useState<WorkspaceSyncedBlock[]>([]);
  const [comments, setComments] = useState<WorkspaceComment[]>([]);
  const [externalHighlight, setExternalHighlight] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("split");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pageDialog, setPageDialog] = useState<
    | { mode: "create"; parentPath: string | null }
    | { mode: "rename"; path: string; title: string }
    | null
  >(null);
  const selectedPathRef = useRef(selectedPath);
  const dirtyRef = useRef(dirty);
  const contentRef = useRef(content);
  const acceptedExternalRef = useRef<{ path: string; content: string } | null>(
    null,
  );

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const refreshCollaborationPanels = useCallback(
    async (path: string) => {
      const [nextComments, nextSyncedBlocks] = await Promise.all([
        window.hermesAPI.listWorkspaceComments(path, profile),
        window.hermesAPI.listWorkspaceSyncedBlocks(profile),
      ]);
      setComments(nextComments);
      setSyncedBlocks(nextSyncedBlocks);
    },
    [profile],
  );

  const refreshWorkspace = useCallback(async () => {
    const [tree, nextMetadata, nextGraph, nextProposals, nextTemplates] =
      await Promise.all([
        window.hermesAPI.getWorkspaceTree(profile),
        window.hermesAPI.getWorkspaceMetadata(profile),
        window.hermesAPI.getWorkspacePageGraph(profile),
        window.hermesAPI.listAgentWorkspaceProposals(profile),
        window.hermesAPI.listWorkspaceTemplates(profile),
      ]);
    setNodes(tree);
    setMetadata(nextMetadata);
    setPageGraph(nextGraph);
    setProposals(nextProposals);
    setTemplates(nextTemplates);
    return tree;
  }, [profile]);

  const loadFile = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const next = await window.hermesAPI.readWorkspaceFile(path, profile);
        setSelectedPath(path);
        setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
        setContent(next);
        setDirty(false);
        dirtyRef.current = false;
        setConflictContent(null);
        await refreshCollaborationPanels(path);
        window.hermesAPI.recordWorkspaceVisit(path, profile).catch(() => {
          /* non-critical metadata update */
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [profile, refreshCollaborationPanels],
  );

  const navigateToFile = useCallback(
    async (path: string) => {
      if (path !== selectedPathRef.current) {
        setBackStack((stack) => [...stack, selectedPathRef.current]);
        setForwardStack([]);
      }
      await loadFile(path);
    },
    [loadFile],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tree, home] = await Promise.all([
          refreshWorkspace(),
          window.hermesAPI.getHermesHome(profile),
        ]);
        if (cancelled) return;
        setWorkspaceRoot(workspaceRootFromHermesHome(home));
        await loadFile(firstFile(tree));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFile, refreshWorkspace, profile]);

  useEffect(() => {
    return window.hermesAPI.onWorkspaceFileChanged((event) => {
      if (event.path !== selectedPathRef.current) return;
      if (event.content === contentRef.current) return;
      if (
        acceptedExternalRef.current?.path === event.path &&
        acceptedExternalRef.current.content === event.content
      ) {
        acceptedExternalRef.current = null;
        setContent(event.content);
        contentRef.current = event.content;
        setExternalHighlight(true);
        window.setTimeout(() => setExternalHighlight(false), 1800);
        return;
      }
      if (dirtyRef.current) {
        setConflictContent(event.content);
        return;
      }
      window.hermesAPI
        .createAgentWorkspaceProposal(
          event.path,
          event.content,
          contentRef.current,
          profile,
        )
        .then((proposal) => {
          setProposals((current) => [...current, proposal]);
          setExternalHighlight(true);
          window.setTimeout(() => setExternalHighlight(false), 1800);
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    });
  }, [profile]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      dirtyRef.current = false;
      setDirty(false);
      window.hermesAPI
        .writeWorkspaceFile(selectedPath, content, profile)
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [content, dirty, profile, selectedPath]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleContentChange(next: string): void {
    contentRef.current = next;
    dirtyRef.current = true;
    setContent(next);
    setDirty(true);
  }

  function handleReloadConflict(): void {
    if (conflictContent === null) return;
    setContent(conflictContent);
    contentRef.current = conflictContent;
    setConflictContent(null);
    setDirty(false);
    dirtyRef.current = false;
    setExternalHighlight(true);
    window.setTimeout(() => setExternalHighlight(false), 1800);
  }

  function handleNewChat(): void {
    window.hermesAPI.abortChat();
    setMessages([]);
    setSessionId(null);
  }

  async function handleCreateComment(body: string): Promise<void> {
    try {
      await window.hermesAPI.createWorkspaceComment(
        { path: selectedPathRef.current, body },
        profile,
      );
      await refreshCollaborationPanels(selectedPathRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleResolveComment(id: string): Promise<void> {
    try {
      await window.hermesAPI.resolveWorkspaceComment(id, profile);
      await refreshCollaborationPanels(selectedPathRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateSyncedBlock(nextContent: string): Promise<void> {
    try {
      await window.hermesAPI.createWorkspaceSyncedBlock(
        {
          sourcePath: selectedPathRef.current,
          sourceBlockId: `block-${Date.now()}`,
          content: nextContent,
        },
        profile,
      );
      await refreshCollaborationPanels(selectedPathRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshAfterPageOperation(nextPath?: string): Promise<void> {
    const tree = await refreshWorkspace();
    await loadFile(nextPath ?? selectedPathRef.current ?? firstFile(tree));
  }

  async function handleBack(): Promise<void> {
    const previous = backStack.at(-1);
    if (!previous) return;
    setBackStack((stack) => stack.slice(0, -1));
    setForwardStack((stack) => [selectedPathRef.current, ...stack]);
    await loadFile(previous);
  }

  async function handleForward(): Promise<void> {
    const next = forwardStack[0];
    if (!next) return;
    setForwardStack((stack) => stack.slice(1));
    setBackStack((stack) => [...stack, selectedPathRef.current]);
    await loadFile(next);
  }

  function closeTab(path: string): void {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== path);
      return next.length > 0 ? next : ["index.md"];
    });
    if (path === selectedPathRef.current) {
      const nextPath = openTabs.find((tab) => tab !== path) ?? "index.md";
      loadFile(nextPath).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function submitCreatePage(
    title: string,
    parentPath?: string | null,
    content?: string,
  ): Promise<void> {
    try {
      const page = await window.hermesAPI.createWorkspacePage(
        content === undefined
          ? { title, parentPath }
          : { title, parentPath, content },
        profile,
      );
      setPageDialog(null);
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitRenamePage(path: string, title: string): Promise<void> {
    try {
      const page = await window.hermesAPI.renameWorkspacePage(
        path,
        title,
        profile,
      );
      setPageDialog(null);
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCreatePage(parentPath?: string | null): void {
    setPageDialog({ mode: "create", parentPath: parentPath ?? null });
  }

  function handleRenamePage(path: string): void {
    setPageDialog({
      mode: "rename",
      path,
      title: metadata?.pages[path]?.displayName ?? path,
    });
  }

  function handleSidebarState(next: {
    width?: number;
    collapsed?: boolean;
  }): void {
    const sidebar = {
      width: next.width ?? pageGraph?.sidebar.width ?? 280,
      collapsed: next.collapsed ?? pageGraph?.sidebar.collapsed ?? false,
    };
    setPageGraph((current) =>
      current
        ? {
            ...current,
            sidebar: {
              ...current.sidebar,
              ...sidebar,
            },
          }
        : current,
    );
    window.hermesAPI
      .updateWorkspaceSidebarState(sidebar, profile)
      .then(setPageGraph)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }

  async function handleDuplicatePage(path: string): Promise<void> {
    try {
      const page = await window.hermesAPI.duplicateWorkspacePage(path, profile);
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTrashPage(path: string): Promise<void> {
    try {
      await window.hermesAPI.trashWorkspacePage(path, profile);
      const tree = await refreshWorkspace();
      await loadFile(firstFile(tree));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestorePage(path: string): Promise<void> {
    try {
      await window.hermesAPI.restoreWorkspacePage(path, profile);
      await refreshAfterPageOperation(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFavoritePage(
    path: string,
    favorite: boolean,
  ): Promise<void> {
    try {
      await window.hermesAPI.favoriteWorkspacePage(path, favorite, profile);
      await refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMovePage(
    path: string,
    parentPath: string | null,
  ): Promise<void> {
    try {
      const page = await window.hermesAPI.moveWorkspacePage(
        path,
        parentPath,
        profile,
      );
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAcceptProposal(id: string): Promise<void> {
    const proposal = proposals.find((candidate) => candidate.id === id);
    if (!proposal) return;
    try {
      acceptedExternalRef.current = {
        path: proposal.path,
        content: proposal.proposedContent,
      };
      await window.hermesAPI.acceptAgentWorkspaceProposal(id, profile);
      setProposals((current) => current.filter((item) => item.id !== id));
      if (proposal.path === selectedPathRef.current) {
        await loadFile(proposal.path);
      }
    } catch (err) {
      acceptedExternalRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRejectProposal(id: string): Promise<void> {
    const proposal = proposals.find((candidate) => candidate.id === id);
    try {
      await window.hermesAPI.rejectAgentWorkspaceProposal(id, profile);
      setProposals((current) => current.filter((item) => item.id !== id));
      if (proposal?.path === selectedPathRef.current) {
        await loadFile(proposal.path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAcceptProposalHunk(
    id: string,
    hunkId: string,
  ): Promise<void> {
    try {
      await window.hermesAPI.acceptAgentWorkspaceProposalHunk(
        id,
        hunkId,
        profile,
      );
      await refreshWorkspace();
      await loadFile(selectedPathRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRejectProposalHunk(
    id: string,
    hunkId: string,
  ): Promise<void> {
    try {
      await window.hermesAPI.rejectAgentWorkspaceProposalHunk(
        id,
        hunkId,
        profile,
      );
      await refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openHistory(): Promise<void> {
    try {
      const entries = await window.hermesAPI.listWorkspaceHistory(
        selectedPathRef.current,
        profile,
      );
      setHistoryEntries(entries);
      setHistoryOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function restoreHistory(entry: WorkspaceHistoryEntry): Promise<void> {
    try {
      await window.hermesAPI.restoreWorkspaceVersion(
        selectedPathRef.current,
        entry.id,
        profile,
      );
      setHistoryOpen(false);
      await loadFile(selectedPathRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="workspace-screen">
      <WorkspaceHeader
        path={selectedPath}
        mode={mode}
        externalHighlight={externalHighlight}
        onModeChange={setMode}
        onOpenPalette={() => setPaletteOpen(true)}
        onNavigateCrumb={(path) => {
          if (metadata?.pages[path]) navigateToFile(path);
        }}
        onBack={() => {
          handleBack().catch((err) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
        onForward={() => {
          handleForward().catch((err) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
        canBack={backStack.length > 0}
        canForward={forwardStack.length > 0}
        onOpenHistory={() => {
          openHistory().catch((err) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
      />
      <div className="workspace-tabs" role="tablist" aria-label="Open pages">
        {openTabs.map((path) => (
          <button
            key={path}
            type="button"
            role="tab"
            aria-selected={path === selectedPath}
            className={path === selectedPath ? "active" : ""}
            onClick={() => navigateToFile(path)}
          >
            <span>{metadata?.pages[path]?.displayName ?? path}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(path);
              }}
            >
              x
            </span>
          </button>
        ))}
      </div>
      <div className="workspace-body">
        <aside
          className={`workspace-pages${
            pageGraph?.sidebar.collapsed ? " workspace-pages-collapsed" : ""
          }`}
          style={{ width: pageGraph?.sidebar.width ?? 280 }}
        >
          <div className="workspace-sidebar-header">
            <div className="workspace-section-label">Workspace</div>
            <button
              type="button"
              aria-label={
                pageGraph?.sidebar.collapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
              }
              onClick={() =>
                handleSidebarState({
                  collapsed: !(pageGraph?.sidebar.collapsed ?? false),
                })
              }
            >
              {pageGraph?.sidebar.collapsed ? ">" : "<"}
            </button>
          </div>
          <label className="workspace-sidebar-resize">
            <span>Sidebar width</span>
            <input
              type="range"
              min={220}
              max={520}
              value={pageGraph?.sidebar.width ?? 280}
              onChange={(event) =>
                handleSidebarState({ width: Number(event.target.value) })
              }
            />
          </label>
          <WorkspaceTree
            nodes={nodes}
            metadata={metadata}
            selectedPath={selectedPath}
            onSelect={navigateToFile}
            onCreate={handleCreatePage}
            onRename={handleRenamePage}
            onDuplicate={handleDuplicatePage}
            onFavorite={handleFavoritePage}
            onTrash={handleTrashPage}
            onRestore={handleRestorePage}
            onMove={handleMovePage}
          />
        </aside>
        <section className={`workspace-main workspace-mode-${mode}`}>
          {mode !== "chat" && (
            <div className="workspace-canvas">
              {conflictContent && (
                <div className="workspace-conflict">
                  <span>Workspace file changed externally.</span>
                  <button type="button" onClick={handleReloadConflict}>
                    Reload file
                  </button>
                  <button
                    type="button"
                    onClick={() => setConflictContent(null)}
                  >
                    Keep editing
                  </button>
                </div>
              )}
              {historyOpen && (
                <div className="workspace-history">
                  <div className="workspace-history-title">
                    <span>Version history</span>
                    <button type="button" onClick={() => setHistoryOpen(false)}>
                      Close
                    </button>
                  </div>
                  {historyEntries.length === 0 ? (
                    <div className="workspace-history-empty">
                      No snapshots yet
                    </div>
                  ) : (
                    historyEntries.map((entry) => (
                      <div key={entry.id} className="workspace-history-entry">
                        <div>
                          <strong>{entry.reason}</strong>
                          <small>
                            {new Date(entry.createdAt).toLocaleString()}
                          </small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            restoreHistory(entry).catch((err) =>
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : String(err),
                              ),
                            );
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
              {error && <div className="workspace-error">{error}</div>}
              {loading ? (
                <div className="workspace-loading">Loading workspace...</div>
              ) : (
                <WorkspaceEditor
                  path={selectedPath}
                  content={content}
                  pages={Object.values(metadata?.pages ?? {}).map((page) => ({
                    path: page.path,
                    title: page.displayName,
                  }))}
                  onChange={handleContentChange}
                />
              )}
            </div>
          )}
          {mode !== "canvas" && (
            <div className="workspace-chat-pane">
              <WorkspaceOfflinePanel
                dirty={dirty}
                conflictPending={conflictContent !== null}
                proposalCount={proposals.length}
                lastSavedLabel={dirty ? "pending" : "now"}
              />
              <AgentReviewPanel
                proposals={proposals}
                onAccept={handleAcceptProposal}
                onReject={handleRejectProposal}
                onAcceptHunk={(id, hunkId) => {
                  handleAcceptProposalHunk(id, hunkId).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                }}
                onRejectHunk={(id, hunkId) => {
                  handleRejectProposalHunk(id, hunkId).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                }}
              />
              <WorkspaceCommentsPanel
                comments={comments}
                onCreate={(body) => {
                  handleCreateComment(body).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                }}
                onResolve={(id) => {
                  handleResolveComment(id).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                }}
              />
              <WorkspaceSyncedBlocksPanel
                blocks={syncedBlocks}
                onCreate={(nextContent) => {
                  handleCreateSyncedBlock(nextContent).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                }}
              />
              <Chat
                messages={messages}
                setMessages={setMessages}
                sessionId={sessionId}
                profile={profile}
                onSessionStarted={() => undefined}
                onNewChat={handleNewChat}
                contextFolderOverride={workspaceRoot}
                compact
              />
            </div>
          )}
        </section>
      </div>
      <CommandPalette
        open={paletteOpen}
        profile={profile}
        onClose={() => setPaletteOpen(false)}
        onSelectWorkspace={navigateToFile}
        onSelectAdmin={onOpenAdmin}
        onSelectSession={(id) => onOpenSession?.(id)}
        onOpenWorkspaceInTab={(path) => {
          navigateToFile(path).catch((err) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
        onOpenWorkspaceInWindow={(path) => {
          window.open(
            `hermes-workspace://${encodeURIComponent(path)}`,
            "_blank",
          );
        }}
        onRunCommand={(command) => {
          if (command === "new-chat") handleNewChat();
          if (command === "new-page") handleCreatePage(null);
        }}
      />
      {pageDialog && (
        <PageCreateDialog
          mode={pageDialog.mode}
          templates={templates}
          initialTitle={
            pageDialog.mode === "rename" ? pageDialog.title : undefined
          }
          onCancel={() => setPageDialog(null)}
          onSubmit={(title, selectedContent) => {
            if (pageDialog.mode === "create") {
              submitCreatePage(
                title,
                pageDialog.parentPath,
                selectedContent,
              ).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              );
            } else {
              submitRenamePage(pageDialog.path, title).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              );
            }
          }}
        />
      )}
    </div>
  );
}
