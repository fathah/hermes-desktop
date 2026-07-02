// CommandPalette.tsx — ⌘K quick switcher. Notion-3.1 grammar: filter chips, a
// two-column layout with a right-side preview pane, and "Start new chat" / "New
// page" results. Reuses the existing search over actions / pages / in-page
// content; all chrome is the existing .palette / .pal-* design language.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { useStore } from "../store";
import { treeWalkIds } from "../lib/tree";
import { computePathIds } from "../store/selectors";
import { workspaceParity } from "../editor/workspaceVault";
import { pageToMarkdown } from "../editor/pageMarkdown";
import { getStorageMode } from "../lib/storageMode";
import type { PageMeta, TreeNode } from "../types";
import type { ContentIdea } from "../../../lib/content-studio";
import { saveContentIdea } from "../content/contentStudioStorage";
import { useWhatsNew } from "../updates/useWhatsNew";

interface ActionItem {
  kind: "action";
  id: string;
  icon: IconName;
  label: string;
  hint?: string;
  desc: string;
  run: () => void;
}
interface PageItem {
  kind: "page";
  id: string;
  emoji: string;
  label: string;
}
interface ContentItem {
  kind: "content";
  id: string;
  pageId: string;
  label: string;
  snippet: string;
  emoji: string;
}
type Item = ActionItem | PageItem | ContentItem;

function flattenStoreTree(
  tree: TreeNode[],
  meta: Record<string, PageMeta>,
): PageItem[] {
  const ids = tree.flatMap((n) => treeWalkIds(n));
  return ids.map((id) => ({
    kind: "page",
    id,
    emoji: meta[id]?.icon || "📄",
    label: meta[id]?.title || "Untitled",
  }));
}

export function CommandPalette() {
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const selectPage = useStore((s) => s.selectPage);
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const docs = useStore((s) => s.docs);
  const page = useStore((s) => s.page);
  const openPanelTab = useStore((s) => s.openPanelTab);
  const setTweak = useStore((s) => s.setTweak);
  const t = useStore((s) => s.t);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const resetWorkspace = useStore((s) => s.resetWorkspace);
  const startNewChat = useStore((s) => s.startNewChat);
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const setExternalSessionsOpen = useStore((s) => s.setExternalSessionsOpen);
  const setSurface = useStore((s) => s.setSurface);
  const openInboxImageCapture = useStore((s) => s.openInboxImageCapture);
  const flash = useStore((s) => s.flash);
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
  const whatsNew = useWhatsNew();

  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [titleOnly, setTitleOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onClose = () => setPaletteOpen(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const processActiveObsidianNote = useCallback(async (): Promise<void> => {
    try {
      const active = await window.hermesAPI.callObsidianFunction?.(
        "active-note",
        {},
      );
      const path =
        typeof active === "string"
          ? active
          : active && typeof active === "object" && "path" in active
            ? String((active as { path?: unknown }).path ?? "")
            : "";
      if (!path) throw new Error("No active Obsidian note was reported.");
      const markdown = await window.hermesAPI.readObsidianFile?.(path);
      if (!markdown) throw new Error(`Could not read ${path}.`);
      const pageId = path
        .replace(/\.md$/i, "")
        .replace(/[^A-Za-z0-9_-]+/g, "-");
      await window.hermesAPI.spsCreateVaultProposal?.({
        source: "obsidian",
        title: `Process ${path}`,
        summary: `Import and process ${path} into the SPS wiki structure.`,
        operations: [
          {
            id: `obsidian-${pageId}`,
            kind: "upsert-page",
            pageId,
            title: meta[pageId]?.title || pageId,
            markdown,
          },
        ],
      });
      flash("Queued Obsidian note for review");
      setSurface("review");
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), { tone: "warn" });
    }
  }, [flash, meta, setSurface]);

  const importObsidianFolder = useCallback(async (): Promise<void> => {
    try {
      const folder = await window.hermesAPI.selectFolder?.();
      if (!folder) return;
      const plan = await window.hermesAPI.spsCreateImportPlan?.({
        source: { kind: "markdown-folder", path: folder },
      });
      if (!plan) throw new Error("Could not create an import plan.");
      const result = await window.hermesAPI.spsApplyImportPlan?.(plan.id);
      if (!result?.success) {
        throw new Error(result?.error || "Import failed.");
      }
      flash(
        `Imported ${result.pagesCreated} note${result.pagesCreated === 1 ? "" : "s"} · ${result.conflicts} conflicts · ${result.skipped} skipped`,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), { tone: "warn" });
    }
  }, [flash]);

  const saveSelectionAsContentIdea = useCallback(async (): Promise<void> => {
    const selection = window.getSelection()?.toString().trim() || "";
    if (!selection) {
      flash("Select workspace text before saving a content idea.", {
        tone: "warn",
      });
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const title = meta[page]?.title || "Selected workspace text";
    const idea: ContentIdea = {
      id: `idea-selection-${Date.now().toString(36)}`,
      title,
      sourceUrls: [],
      audience: "",
      angle: selection,
      createdAt: date,
      updatedAt: date,
      status: "captured",
      capturedFrom: "workspace-selection",
      rubric: {
        bookmarkability: 0,
        proof: 0,
        immediateUse: 0,
        audienceClarity: 0,
        reproducibility: 0,
        hookStrength: 0,
        originality: 1,
      },
    };
    await saveContentIdea(idea);
    openContentStudioIdea(idea);
  }, [flash, meta, openContentStudioIdea, page]);

  const actions: ActionItem[] = useMemo(
    () => [
      ...(whatsNew.items.length > 0
        ? [
            {
              kind: "action" as const,
              id: "whats-new",
              icon: "sparkle" as const,
              label: "What's new",
              desc: `Review ${whatsNew.items.length} new capability${
                whatsNew.items.length === 1 ? "" : "ies"
              } in this update.`,
              run: () => setSurface("doc"),
            },
          ]
        : []),
      {
        kind: "action",
        id: "newchat",
        icon: "sparkle",
        label: "Start new chat",
        hint: "⌘O",
        desc: "Open a fresh chat with My Assistant.",
        run: () => startNewChat(),
      },
      {
        kind: "action",
        id: "newpage",
        icon: "plus",
        label: "New page",
        desc: "Create a new page from a template.",
        run: () => setTemplatesOpen({ parent: null }),
      },
      {
        kind: "action",
        id: "capture",
        icon: "inbox",
        label: "Open Capture",
        desc: "Add screenshots, sources, PDFs, notes, and review raw intake.",
        run: () => setSurface("inbox"),
      },
      {
        kind: "action",
        id: "capture-screenshot",
        icon: "inbox",
        label: "Capture screenshot",
        desc: "Start image capture from recent screenshots or clipboard input.",
        run: () => openInboxImageCapture(),
      },
      {
        kind: "action",
        id: "work",
        icon: "board",
        label: "Open Work",
        desc: "Review tasks, delegated goals, scheduled items, and pending changes.",
        run: () => setSurface("work"),
      },
      {
        kind: "action",
        id: "dashboard",
        icon: "board",
        label: "Open Dashboard",
        desc: "Open the customizable dashboard workspace.",
        run: () => setSurface("dashboard"),
      },
      {
        kind: "action",
        id: "learning",
        icon: "sparkle",
        label: "Open Learning",
        desc: "Review remembered material, assistants, experts, skills, and curator state.",
        run: () => setSurface("learning"),
      },
      {
        kind: "action",
        id: "graph",
        icon: "list",
        label: "Open Graph",
        desc: "View local page links and workspace relationships.",
        run: () => setSurface("graph"),
      },
      {
        kind: "action",
        id: "research",
        icon: "search",
        label: "Research papers…",
        desc: "Search OpenAlex's 250M+ scholarly works and save a plain-language summary into your workspace.",
        run: () => setResearchOpen(true),
      },
      {
        kind: "action",
        id: "external-sessions",
        icon: "search",
        label: "External sessions…",
        desc: "Search what you discussed in Claude Code, Codex, Gemini and Grok — local, opt-in, redacted.",
        run: () => setExternalSessionsOpen(true),
      },
      {
        kind: "action",
        id: "ask",
        icon: "sparkle",
        label: "Ask your workspace",
        desc: "Ask a question across your pages and past conversations.",
        run: () => setSurface("ask"),
      },
      {
        kind: "action",
        id: "health",
        icon: "info",
        label: "Vault health",
        desc: "Review semantic-lint issues across your vault — orphans, broken links, and structure.",
        run: () => setSurface("health"),
      },
      {
        kind: "action",
        id: "insights",
        icon: "board",
        label: "Open Insights",
        desc: "Review token usage, cost, and workspace analytics.",
        run: () => setSurface("insights"),
      },
      {
        kind: "action",
        id: "personal-health",
        icon: "info",
        label: "Open Health & Ledger",
        desc: "Open the optional personal health workspace pack.",
        run: () => setSurface("personal-health"),
      },
      {
        kind: "action",
        id: "equity",
        icon: "table",
        label: "Open Equity Research",
        desc: "Open the optional equity research workspace pack.",
        run: () => setSurface("equity"),
      },
      {
        kind: "action",
        id: "rss-reader",
        icon: "doc",
        label: "Open RSS Reader",
        desc: "Open feed review and universal capture tools.",
        run: () => setSurface("rss-reader"),
      },
      {
        kind: "action",
        id: "content-studio",
        icon: "sparkle",
        label: "Open Content Studio",
        desc: "Open the optional content workflow pack.",
        run: () => setSurface("contentStudio"),
      },
      {
        kind: "action",
        id: "deck-studio",
        icon: "board",
        label: "Open Deck Studio",
        desc: "Open the optional deck drafting and export pack.",
        run: () => setSurface("deckStudio"),
      },
      {
        kind: "action",
        id: "review-queue",
        icon: "check",
        label: "Open AI Review Queue",
        desc: "Review and approve proposed vault changes before they land.",
        run: () => setSurface("review"),
      },
      {
        kind: "action",
        id: "obsidian-open-current",
        icon: "doc",
        label: "Open current page in Obsidian",
        desc: "Ask the Obsidian bridge to open the current markdown note.",
        run: () => {
          void window.hermesAPI.openObsidianNote?.(`${page}.md`).then((ok) => {
            flash(ok ? "Opened in Obsidian" : "Obsidian bridge is unavailable");
          });
        },
      },
      {
        kind: "action",
        id: "vault-sync-current",
        icon: "code",
        label: "Sync current page to vault",
        desc: "Force-write the current SPS page through the markdown vault path.",
        run: () => {
          const markdown = pageToMarkdown(meta[page] ?? {}, docs[page] ?? []);
          void window.hermesAPI.spsExportPage?.(page, markdown).then((ok) => {
            flash(
              ok ? "Synced current page to vault" : "Vault sync unavailable",
            );
          });
        },
      },
      {
        kind: "action",
        id: "obsidian-active-to-review",
        icon: "sparkle",
        label: "Process selected Obsidian note",
        desc: "Read Obsidian's active note and queue it for SPS wiki review.",
        run: () => {
          void processActiveObsidianNote();
        },
      },
      {
        kind: "action",
        id: "obsidian-import-folder",
        icon: "file",
        label: "Import from Obsidian folder",
        desc: "Choose a markdown folder and import its notes into the SPS vault.",
        run: () => {
          void importObsidianFolder();
        },
      },
      {
        kind: "action",
        id: "context-pack-current",
        icon: "list",
        label: "Save context pack for current page",
        desc: "Package this note, backlinks, sources, tasks, and provenance as markdown.",
        run: () => {
          void window.hermesAPI
            .spsBuildContextPack?.({
              pageId: page,
              depth: 1,
              includeBacklinks: true,
              includeSources: true,
              includeTasks: true,
              save: true,
            })
            .then((result) => {
              flash(
                result?.savedPath
                  ? `Saved context pack: ${result.savedPath}`
                  : "Built context pack",
              );
            });
        },
      },
      {
        kind: "action",
        id: "base-current-folder",
        icon: "table",
        label: "Create Base from current folder",
        desc: "Queue a projects Base proposal scoped to the current folder.",
        run: () => {
          const crumbIds = computePathIds(tree, page);
          const folderId =
            crumbIds.length > 1 ? crumbIds[crumbIds.length - 2] : page;
          const folder = meta[folderId]?.title || folderId || "Projects";
          void window.hermesAPI
            .spsCreateBaseProposal?.({ recipe: "projects", folder })
            .then((proposal) => {
              flash(`Queued ${proposal.title} Base for review`);
              setSurface("review");
            });
        },
      },
      {
        kind: "action",
        id: "content-idea-selection",
        icon: "sparkle",
        label: "Save selection as content idea",
        desc: "Capture selected workspace text into Content Studio.",
        run: () => {
          void saveSelectionAsContentIdea();
        },
      },
      {
        kind: "action",
        id: "telos",
        icon: "flag",
        label: "Telos alignment audit",
        desc: "Audit recent work against your objectives in TELOS.md and generate a roadmap (opens You).",
        run: () => setSurface("you"),
      },
      {
        kind: "action",
        id: "assistant",
        icon: "sparkle",
        label: "Open My Assistant",
        hint: "⌘J",
        desc: "Open the page My Assistant panel.",
        run: () => openPanelTab("assistant"),
      },
      {
        kind: "action",
        id: "outline",
        icon: "list",
        label: "Show outline",
        desc: "Show the outline of the current page.",
        run: () => openPanelTab("outline"),
      },
      {
        kind: "action",
        id: "theme",
        icon: "sun",
        label: t.dark ? "Switch to light" : "Switch to dark",
        desc: "Toggle the colour theme.",
        run: () => setTweak("dark", !t.dark),
      },
      {
        kind: "action",
        id: "sidebar",
        icon: "panelLeft",
        label: "Toggle sidebar",
        hint: "⌘\\",
        desc: "Show or hide the sidebar.",
        run: () =>
          setTweak("sidebar", t.sidebar === "hidden" ? "full" : "hidden"),
      },
      {
        kind: "action",
        id: "trash",
        icon: "trash",
        label: "Open trash",
        desc: "Restore or permanently delete pages.",
        run: () => setTrashOpen(true),
      },
      {
        kind: "action",
        id: "reset",
        icon: "clock",
        label: "Reset workspace to sample",
        desc: "Replace the workspace with the sample content.",
        run: () => resetWorkspace(),
      },
      {
        kind: "action",
        id: "parity",
        icon: "code",
        label: "Check vault parity",
        desc: "Verify the workspace round-trips through markdown losslessly (cutover readiness).",
        run: () => {
          const s = useStore.getState();
          const report = workspaceParity({
            tree: s.tree,
            meta: s.meta,
            docs: s.docs,
            comments: s.comments,
            trash: s.trash,
            page: s.page,
          });
          const failed = report.pages.filter(
            (p) => !p.contentOk || !p.metaOk,
          ).length;
          const caveat = report.blockAnchoredComments
            ? report.blockAnchorsOk
              ? `, ${report.blockAnchoredComments} anchored comment(s) preserved`
              : `, anchored comment(s) would not survive`
            : "";
          flash(
            report.ok
              ? `Vault parity OK — ${report.pages.length} pages${caveat}`
              : `Parity: ${failed} page(s) differ${caveat}`,
          );
        },
      },
      {
        kind: "action",
        id: "storage",
        icon: "code",
        label: "Open workspace settings",
        desc:
          getStorageMode() === "blob"
            ? "Storage (currently JSON blob), active skills, capture, and more."
            : "Storage (currently markdown vault), active skills, capture, and more.",
        // The migrate/rollback control now lives inside the settings surface
        // (Storage section) rather than firing inline from the palette.
        run: () => {
          useStore.getState().setTweaksOpen(true);
        },
      },
    ],
    [
      t.dark,
      t.sidebar,
      openPanelTab,
      setTweak,
      setTemplatesOpen,
      setTrashOpen,
      resetWorkspace,
      startNewChat,
      setResearchOpen,
      setExternalSessionsOpen,
      setSurface,
      openInboxImageCapture,
      flash,
      page,
      meta,
      docs,
      tree,
      processActiveObsidianNote,
      importObsidianFolder,
      saveSelectionAsContentIdea,
      whatsNew.items.length,
    ],
  );

  const pages = useMemo(() => flattenStoreTree(tree, meta), [tree, meta]);

  const searchContent = (query: string): ContentItem[] => {
    const ql = query.toLowerCase();
    const out: ContentItem[] = [];
    Object.entries(docs).forEach(([pid, bs]) => {
      for (const b of bs) {
        if (b.text && b.text.toLowerCase().includes(ql)) {
          const i = b.text.toLowerCase().indexOf(ql);
          const mi = meta[pid] || { title: "Untitled", icon: "📄" };
          out.push({
            kind: "content",
            id: pid + b.text.slice(0, 8),
            pageId: pid,
            label: mi.title || "Untitled",
            emoji: mi.icon || "📄",
            snippet: "…" + b.text.slice(Math.max(0, i - 20), i + 40) + "…",
          });
          break;
        }
      }
    });
    return out.slice(0, 6);
  };

  const ql = q.toLowerCase();
  const fActs = q
    ? actions.filter((i) => i.label.toLowerCase().includes(ql))
    : actions;
  const fPages = q
    ? pages.filter((i) => i.label.toLowerCase().includes(ql))
    : pages;
  // "Title only" scopes search to page/action titles, skipping in-page content.
  const content = q && !titleOnly ? searchContent(q) : [];

  const butlerAct = q
    ? [
        {
          kind: "action" as const,
          id: "askbutler",
          icon: "sparkle" as const,
          label: `Ask My Assistant: “${q}”`,
          desc: "Send this query to My Assistant to execute matching actions.",
          run: () => {
            openPanelTab("assistant");
            useStore.getState().runAgent(q);
          },
        },
      ]
    : [];

  const grouped = [
    { label: "Actions", items: fActs as Item[] },
    { label: "Jump to", items: fPages as Item[] },
    { label: "In pages", items: content as Item[] },
    ...(butlerAct.length
      ? [{ label: "My Assistant", items: butlerAct as Item[] }]
      : []),
  ].filter((g) => g.items.length);
  const flat = grouped.flatMap((g) => g.items);

  useEffect(() => {
    setSel(0);
  }, [q, titleOnly]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "action") item.run();
    else if (item.kind === "content") selectPage(item.pageId);
    else selectPage(item.id);
    onClose();
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(flat[sel]);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, sel]);

  const selected = flat[sel];

  let idx = -1;
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="palette palette-wide"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pal-input">
          <Icon name="search" size={18} style={{ color: "var(--tx-3)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or open in new tab…"
          />
          <span className="kbd">esc</span>
        </div>

        <div className="pal-filters">
          <button
            className={`pal-chip ${titleOnly ? "on" : ""}`}
            onClick={() => setTitleOnly((v) => !v)}
          >
            <Icon name="text" size={13} /> Title only
          </button>
        </div>

        <div className="pal-body">
          <div className="pal-list scroll">
            {grouped.length === 0 && (
              <div className="pal-group">No results for “{q}”</div>
            )}
            {grouped.map((g) => (
              <div key={g.label}>
                <div className="pal-group">{g.label}</div>
                {g.items.map((item) => {
                  idx++;
                  const here = idx;
                  return (
                    <div
                      key={item.kind + item.id}
                      className={`pal-item ${here === sel ? "sel" : ""}`}
                      onMouseEnter={() => setSel(here)}
                      onMouseDown={() => pick(item)}
                    >
                      <Icon
                        name={item.kind === "action" ? item.icon : "doc"}
                        size={17}
                      />
                      {item.kind !== "action" && (
                        <span style={{ marginLeft: -4 }}>{item.emoji}</span>
                      )}
                      <span className="label">
                        {item.label}
                        {item.kind === "content" && (
                          <small
                            style={{
                              display: "block",
                              color: "var(--tx-3)",
                              fontSize: 12,
                            }}
                          >
                            {item.snippet}
                          </small>
                        )}
                      </span>
                      {item.kind === "action" && item.hint && (
                        <span className="hint">{item.hint}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <PalettePreview item={selected} tree={tree} meta={meta} docs={docs} />
        </div>

        <div className="pal-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

/** Right-side preview of the highlighted result (Notion's quick-switcher pane). */
function PalettePreview({
  item,
  tree,
  meta,
  docs,
}: {
  item: Item | undefined;
  tree: TreeNode[];
  meta: Record<string, PageMeta>;
  docs: Record<string, import("../types").Block[]>;
}) {
  if (!item) {
    return (
      <div className="pal-preview pal-preview-empty">
        <Icon name="search" size={22} style={{ color: "var(--tx-4)" }} />
        <div>Search your workspace</div>
      </div>
    );
  }

  if (item.kind === "action") {
    return (
      <div className="pal-preview">
        <div className="pal-pv-ic">
          <Icon name={item.icon} size={22} />
        </div>
        <div className="pal-pv-crumb">Command</div>
        <div className="pal-pv-title">{item.label}</div>
        <div className="pal-pv-desc">{item.desc}</div>
      </div>
    );
  }

  const pid = item.kind === "content" ? item.pageId : item.id;
  const crumbIds = computePathIds(tree, pid);
  const crumb = crumbIds.map((id) => meta[id]?.title || "Untitled").join(" / ");
  const blocks = (docs[pid] || []).filter((b) => (b.text || "").trim());
  const first = blocks[0]?.text || "Empty page.";

  return (
    <div className="pal-preview">
      <div className="pal-pv-ic">{item.emoji}</div>
      <div className="pal-pv-crumb">{crumb}</div>
      <div className="pal-pv-title">{item.label}</div>
      <div className="pal-pv-desc">{first}</div>
      <div className="pal-pv-skel">
        <span style={{ width: "92%" }} />
        <span style={{ width: "76%" }} />
        <span style={{ width: "84%" }} />
        <span style={{ width: "60%" }} />
      </div>
    </div>
  );
}
