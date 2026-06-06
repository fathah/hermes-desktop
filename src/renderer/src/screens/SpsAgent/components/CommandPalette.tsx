// CommandPalette.tsx — ⌘K quick switcher. Notion-3.1 grammar: filter chips, a
// two-column layout with a right-side preview pane, and "Start new chat" / "New
// page" results. Reuses the existing search over actions / pages / in-page
// content; all chrome is the existing .palette / .pal-* design language.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { useStore } from "../store";
import { treeWalkIds } from "../lib/tree";
import { computePathIds } from "../store/selectors";
import { workspaceParity } from "../editor/workspaceVault";
import { getStorageMode } from "../lib/storageMode";
import { toggleStorageMode } from "../lib/storageActions";
import type { PageMeta, TreeNode, Workspace } from "../types";

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
  const openPanelTab = useStore((s) => s.openPanelTab);
  const setTweak = useStore((s) => s.setTweak);
  const t = useStore((s) => s.t);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const resetWorkspace = useStore((s) => s.resetWorkspace);
  const startNewChat = useStore((s) => s.startNewChat);
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const flash = useStore((s) => s.flash);

  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [titleOnly, setTitleOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onClose = () => setPaletteOpen(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const actions: ActionItem[] = useMemo(
    () => [
      {
        kind: "action",
        id: "newchat",
        icon: "sparkle",
        label: "Start new chat",
        hint: "⌘O",
        desc: "Open a fresh AI chat with the Hermes agent.",
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
        id: "research",
        icon: "search",
        label: "Research papers…",
        desc: "Search OpenAlex's 250M+ scholarly works and save a plain-language summary into your workspace.",
        run: () => setResearchOpen(true),
      },
      {
        kind: "action",
        id: "assistant",
        icon: "sparkle",
        label: "Open assistant",
        hint: "⌘J",
        desc: "Open the page assistant panel.",
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
        label:
          getStorageMode() === "blob"
            ? "Switch to markdown storage (migrate)"
            : "Switch to JSON storage (rollback)",
        desc:
          getStorageMode() === "blob"
            ? "Make the markdown vault authoritative (backs up the JSON blob first)."
            : "Make the JSON blob authoritative again.",
        run: () => {
          const s = useStore.getState();
          const ws: Workspace = {
            tree: s.tree,
            meta: s.meta,
            docs: s.docs,
            comments: s.comments,
            trash: s.trash,
            page: s.page,
          };
          void toggleStorageMode(ws).then((res) => flash(res.message));
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
      flash,
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

  const grouped = [
    { label: "Actions", items: fActs as Item[] },
    { label: "Jump to", items: fPages as Item[] },
    { label: "In pages", items: content as Item[] },
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
          <button className="pal-chip" disabled title="Coming soon">
            <Icon name="sparkle" size={13} /> Created by
          </button>
          <button className="pal-chip" disabled title="Coming soon">
            <Icon name="doc" size={13} /> In
          </button>
          <button className="pal-chip" disabled title="Coming soon">
            <Icon name="plus" size={13} /> Filter
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
