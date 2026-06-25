// CommandPalette.tsx — ⌘K palette: actions + jump-to-page + in-page content search.
// Ported from palette.jsx; reads the live workspace from the store.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { useStore } from "../store";
import { treeWalkIds } from "../lib/tree";
import type { PageMeta, TreeNode } from "../types";

interface ActionItem {
  kind: "action";
  id: string;
  icon: IconName;
  label: string;
  hint?: string;
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

  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const onClose = () => setPaletteOpen(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const actions: ActionItem[] = useMemo(
    () => [
      {
        kind: "action",
        id: "assistant",
        icon: "sparkle",
        label: "Open assistant",
        hint: "⌘J",
        run: () => openPanelTab("assistant"),
      },
      {
        kind: "action",
        id: "outline",
        icon: "list",
        label: "Show outline",
        run: () => openPanelTab("outline"),
      },
      {
        kind: "action",
        id: "theme",
        icon: "sun",
        label: t.dark ? "Switch to light" : "Switch to dark",
        run: () => setTweak("dark", !t.dark),
      },
      {
        kind: "action",
        id: "sidebar",
        icon: "panelLeft",
        label: "Toggle sidebar",
        hint: "⌘\\",
        run: () =>
          setTweak("sidebar", t.sidebar === "hidden" ? "full" : "hidden"),
      },
      {
        kind: "action",
        id: "newpage",
        icon: "plus",
        label: "New page from template",
        run: () => setTemplatesOpen({ parent: null }),
      },
      {
        kind: "action",
        id: "trash",
        icon: "trash",
        label: "Open trash",
        run: () => setTrashOpen(true),
      },
      {
        kind: "action",
        id: "reset",
        icon: "clock",
        label: "Reset workspace to sample",
        run: () => resetWorkspace(),
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
  const content = q ? searchContent(q) : [];

  const grouped = [
    { label: "Actions", items: fActs as Item[] },
    { label: "Jump to", items: fPages as Item[] },
    { label: "In pages", items: content as Item[] },
  ].filter((g) => g.items.length);
  const flat = grouped.flatMap((g) => g.items);

  useEffect(() => {
    setSel(0);
  }, [q]);

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

  let idx = -1;
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Icon name="search" size={18} style={{ color: "var(--tx-3)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, content, or run a command…"
          />
          <span className="kbd">esc</span>
        </div>
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
