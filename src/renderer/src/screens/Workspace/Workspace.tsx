import { useCallback, useEffect, useRef, useState } from "react";
import AgentReviewPanel from "./AgentReviewPanel";
import Chat, { type ChatMessage } from "../Chat/Chat";
import CommandPalette from "./CommandPalette";
import WorkspaceEditor from "./WorkspaceEditor";
import WorkspaceHeader, { type WorkspaceMode } from "./WorkspaceHeader";
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

interface AgentWorkspaceProposal {
  id: string;
  path: string;
  baseContent: string;
  proposedContent: string;
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

type WorkspaceBackend = "workspace" | "obsidian";

interface ObsidianConfig {
  enabled: boolean;
  vaultPath: string;
  vaultName: string;
  vaultId: string;
  bridgeUrl: string;
  hasBridgeToken: boolean;
}

interface ObsidianConfigInput {
  vaultPath: string;
  vaultName?: string;
  vaultId?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
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
  const [externalHighlight, setExternalHighlight] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("split");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [backend, setBackend] = useState<WorkspaceBackend>("workspace");
  const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfig | null>(
    null,
  );
  const [obsidianDraft, setObsidianDraft] = useState<ObsidianConfigInput>({
    vaultPath: "",
    vaultName: "",
    vaultId: "",
    bridgeUrl: "",
    bridgeToken: "",
  });
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

  const refreshWorkspace = useCallback(async () => {
    const [tree, nextMetadata, nextProposals] = await Promise.all([
      window.hermesAPI.getWorkspaceTree(profile),
      window.hermesAPI.getWorkspaceMetadata(profile),
      window.hermesAPI.listAgentWorkspaceProposals(profile),
    ]);
    setNodes(tree);
    setMetadata(nextMetadata);
    setProposals(nextProposals);
    return tree;
  }, [profile]);

  const refreshObsidian = useCallback(async () => {
    const config = await window.hermesAPI.getObsidianConfig(profile);
    setObsidianConfig(config);
    setObsidianDraft({
      vaultPath: config.vaultPath,
      vaultName: config.vaultName,
      vaultId: config.vaultId,
      bridgeUrl: config.bridgeUrl,
      bridgeToken: "",
    });
    setMetadata(null);
    setProposals([]);
    if (!config.enabled) {
      setNodes([]);
      return [];
    }
    const tree = await window.hermesAPI.getObsidianTree(profile);
    setNodes(tree);
    return tree;
  }, [profile]);

  const loadFile = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const next =
          backend === "obsidian"
            ? await window.hermesAPI.readObsidianFile(path, profile)
            : await window.hermesAPI.readWorkspaceFile(path, profile);
        setSelectedPath(path);
        setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
        setContent(next);
        setDirty(false);
        dirtyRef.current = false;
        setConflictContent(null);
        if (backend === "workspace") {
          window.hermesAPI.recordWorkspaceVisit(path, profile).catch(() => {
            /* non-critical metadata update */
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [backend, profile],
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
        const [tree, home] =
          backend === "obsidian"
            ? await Promise.all([
                refreshObsidian(),
                Promise.resolve(obsidianConfig?.vaultPath ?? ""),
              ])
            : await Promise.all([
                refreshWorkspace(),
                window.hermesAPI.getHermesHome(profile),
              ]);
        if (cancelled) return;
        setWorkspaceRoot(
          backend === "obsidian"
            ? home || null
            : workspaceRootFromHermesHome(home),
        );
        const path = firstFile(tree);
        setSelectedPath(path);
        selectedPathRef.current = path;
        setOpenTabs([path]);
        if (tree.length === 0 && backend === "obsidian") {
          setContent("");
          setLoading(false);
          return;
        }
        await loadFile(path);
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
  }, [
    backend,
    loadFile,
    obsidianConfig?.vaultPath,
    refreshObsidian,
    refreshWorkspace,
    profile,
  ]);

  useEffect(() => {
    return window.hermesAPI.onWorkspaceFileChanged((event) => {
      if (backend !== "workspace") return;
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
  }, [backend, profile]);

  useEffect(() => {
    return window.hermesAPI.onObsidianFileChanged((event) => {
      if (backend !== "obsidian") return;
      if (event.path !== selectedPathRef.current) return;
      if (event.content === contentRef.current) return;
      if (dirtyRef.current) {
        setConflictContent(event.content);
        return;
      }
      setContent(event.content);
      contentRef.current = event.content;
      setExternalHighlight(true);
      window.setTimeout(() => setExternalHighlight(false), 1800);
    });
  }, [backend]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      dirtyRef.current = false;
      setDirty(false);
      const write =
        backend === "obsidian"
          ? window.hermesAPI.writeObsidianFile
          : window.hermesAPI.writeWorkspaceFile;
      write(selectedPath, content, profile).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [backend, content, dirty, profile, selectedPath]);

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

  async function handleBackendChange(
    nextBackend: WorkspaceBackend,
  ): Promise<void> {
    setBackend(nextBackend);
    setBackStack([]);
    setForwardStack([]);
    setHistoryOpen(false);
    setConflictContent(null);
    setDirty(false);
    dirtyRef.current = false;
  }

  async function handleChooseObsidianVault(): Promise<void> {
    const path = await window.hermesAPI.selectFolder();
    if (!path) return;
    setObsidianDraft((draft) => ({ ...draft, vaultPath: path }));
  }

  async function handleSaveObsidianConfig(): Promise<void> {
    try {
      const config = await window.hermesAPI.setObsidianConfig(
        obsidianDraft,
        profile,
      );
      setObsidianConfig(config);
      await refreshObsidian();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleOpenInObsidian(): Promise<void> {
    try {
      await window.hermesAPI.openObsidianNote(selectedPathRef.current, profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshAfterPageOperation(nextPath?: string): Promise<void> {
    if (backend === "obsidian") {
      const tree = await refreshObsidian();
      await loadFile(nextPath ?? selectedPathRef.current ?? firstFile(tree));
      return;
    }
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

  async function handleCreatePage(parentPath?: string | null): Promise<void> {
    if (backend === "obsidian") return;
    const title = window.prompt("New page name");
    if (!title) return;
    try {
      const page = await window.hermesAPI.createWorkspacePage(
        { title, parentPath },
        profile,
      );
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRenamePage(path: string): Promise<void> {
    if (backend === "obsidian") return;
    const current = metadata?.pages[path]?.displayName ?? path;
    const title = window.prompt("Rename page", current);
    if (!title || title === current) return;
    try {
      const page = await window.hermesAPI.renameWorkspacePage(
        path,
        title,
        profile,
      );
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDuplicatePage(path: string): Promise<void> {
    if (backend === "obsidian") return;
    try {
      const page = await window.hermesAPI.duplicateWorkspacePage(path, profile);
      await refreshAfterPageOperation(page.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTrashPage(path: string): Promise<void> {
    if (backend === "obsidian") return;
    try {
      await window.hermesAPI.trashWorkspacePage(path, profile);
      const tree = await refreshWorkspace();
      await loadFile(firstFile(tree));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestorePage(path: string): Promise<void> {
    if (backend === "obsidian") return;
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
    if (backend === "obsidian") return;
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
    if (backend === "obsidian") return;
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

  async function openHistory(): Promise<void> {
    if (backend === "obsidian") return;
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
      <div
        className="workspace-backend-switch"
        role="group"
        aria-label="Workspace backend"
      >
        <button
          type="button"
          className={backend === "workspace" ? "active" : ""}
          onClick={() => {
            handleBackendChange("workspace").catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            );
          }}
        >
          Hermes Workspace
        </button>
        <button
          type="button"
          className={backend === "obsidian" ? "active" : ""}
          onClick={() => {
            handleBackendChange("obsidian").catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            );
          }}
        >
          Obsidian Vault
        </button>
      </div>
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
        <aside className="workspace-pages">
          <div className="workspace-section-label">
            {backend === "obsidian" ? "Obsidian" : "Workspace"}
          </div>
          {backend === "obsidian" && (
            <section className="workspace-obsidian-config">
              <label>
                <span>Vault folder</span>
                <input
                  value={obsidianDraft.vaultPath}
                  onChange={(event) =>
                    setObsidianDraft((draft) => ({
                      ...draft,
                      vaultPath: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="button" onClick={handleChooseObsidianVault}>
                Choose folder
              </button>
              <label>
                <span>Vault name</span>
                <input
                  value={obsidianDraft.vaultName ?? ""}
                  onChange={(event) =>
                    setObsidianDraft((draft) => ({
                      ...draft,
                      vaultName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Bridge URL</span>
                <input
                  value={obsidianDraft.bridgeUrl ?? ""}
                  onChange={(event) =>
                    setObsidianDraft((draft) => ({
                      ...draft,
                      bridgeUrl: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Bridge token</span>
                <input
                  type="password"
                  placeholder={
                    obsidianConfig?.hasBridgeToken ? "Token saved" : ""
                  }
                  value={obsidianDraft.bridgeToken ?? ""}
                  onChange={(event) =>
                    setObsidianDraft((draft) => ({
                      ...draft,
                      bridgeToken: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="button" onClick={handleSaveObsidianConfig}>
                Save vault
              </button>
              {obsidianConfig && !obsidianConfig.enabled && (
                <div className="workspace-tree-empty">
                  Configure a vault to load notes
                </div>
              )}
            </section>
          )}
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
            readOnly={backend === "obsidian"}
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
              {backend === "obsidian" && obsidianConfig?.enabled && (
                <div className="workspace-obsidian-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleOpenInObsidian}
                  >
                    Open in Obsidian
                  </button>
                </div>
              )}
              {loading ? (
                <div className="workspace-loading">
                  Loading {backend === "obsidian" ? "vault" : "workspace"}...
                </div>
              ) : (
                <WorkspaceEditor
                  path={selectedPath}
                  content={content}
                  onChange={handleContentChange}
                />
              )}
            </div>
          )}
          {mode !== "canvas" && (
            <div className="workspace-chat-pane">
              <AgentReviewPanel
                proposals={proposals}
                onAccept={handleAcceptProposal}
                onReject={handleRejectProposal}
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
      />
    </div>
  );
}
