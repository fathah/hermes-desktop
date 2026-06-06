// Editor.tsx — block editor orchestrator: rich text, markdown shortcuts, nesting,
// toggles, mentions, slash menu, block menu, drag reorder/nest, AI proposals.
// Ported from editor.jsx Editor. Reads/writes the current page via the store.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Icon } from "../components/Icon";
import { MentionMenu } from "../components/pickers/MentionMenu";
import { blk, uid } from "../lib/ids";
import { useStore } from "../store";
import { selectCurrentBlocks } from "../store/selectors";
import { BlockInner } from "./BlockInner";
import { BlockMenu } from "./BlockMenu";
import { BlockRow } from "./BlockRow";
import { SlashMenu, type SlashItem } from "./SlashMenu";
import { detectMarkdown } from "./markdown";
import {
  caretRect,
  insertMentionChip,
  mentionQuery,
  placeCaretEnd,
  type MentionItem,
} from "./selection";
import type { Block, BlockType, DbView, Task } from "../types";

const CARRY: BlockType[] = ["todo", "li", "numli"];

interface MenuState {
  blockId: string;
  x: number;
  y: number;
  query: string;
}

type Row =
  | { kind: "block"; block: Block }
  | { kind: "proposal"; proposalId: string; label?: string; blocks: Block[] };

export function Editor() {
  const blocks = useStore(selectCurrentBlocks);
  const setBlocks = useStore((s) => s.setBlocks);
  const onOpenTask = useStore((s) => s.setOpenTask);
  const focusReq = useStore((s) => s.focusReq);
  const setFocusReq = useStore((s) => s.setFocusReq);
  const onProposalDecision = useStore((s) => s.decideProposal);
  const onComment = useStore((s) => s.addBlockComment);
  const onToast = useStore((s) => s.flash);
  const createChildPage = useStore((s) => s.createChildPage);
  const onOpenPage = useStore((s) => s.selectPage);
  const runPlan = useStore((s) => s.runPlan);
  const runWork = useStore((s) => s.runWork);
  const pageMeta = useStore((s) => s.meta);
  const page = useStore((s) => s.page);

  // Copy an in-app wikilink to a specific block — the note-index graph's native
  // [[Title]] format, with the block id as a fragment for precision.
  const copyBlockLink = (id: string): void => {
    const title = pageMeta[page]?.title || "Untitled";
    void navigator.clipboard
      ?.writeText(`[[${title}#${id}]]`)
      .then(() => onToast("Link to block copied"))
      .catch(() => onToast("Couldn't copy link", { tone: "warn" }));
  };

  const refs = useRef<Record<string, RefObject<HTMLDivElement | null>>>({});
  const blocksRef = useRef<HTMLDivElement>(null);
  const [slash, setSlash] = useState<MenuState | null>(null);
  const [mention, setMention] = useState<MenuState | null>(null);
  const [bmenu, setBmenu] = useState<{
    block: Block;
    x: number;
    y: number;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overIndent, setOverIndent] = useState(0);

  const registerRef = useCallback(
    (id: string, r: RefObject<HTMLDivElement | null>) => {
      refs.current[id] = r;
    },
    [],
  );

  useEffect(() => {
    if (focusReq && refs.current[focusReq]) {
      const el = refs.current[focusReq].current;
      if (el) {
        el.focus();
        placeCaretEnd(el);
      }
      setFocusReq(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  const setType = (id: string, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const focusSoon = (id: string) =>
    requestAnimationFrame(() => {
      const el = refs.current[id]?.current;
      if (el) el.focus();
    });

  const insertAfter = (id: string, nb: Block) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const next = [...bs];
      const indent = bs[i] ? bs[i].indent || 0 : 0;
      next.splice(i + 1, 0, {
        ...nb,
        indent: nb.indent != null ? nb.indent : indent,
      });
      return next;
    });

  const updateBlock = (id: string, html: string, text: string) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, html, text } : b)));
    // markdown shortcuts
    const md = detectMarkdown(text);
    if (md) {
      const el = refs.current[id]?.current;
      if (md.type === "divider") {
        setType(id, { type: "divider", html: "", text: "" });
        const nb = blk("p", "");
        insertAfter(id, nb);
        focusSoon(nb.id);
      } else {
        setType(id, {
          type: md.type,
          html: "",
          text: "",
          done: md.type === "todo" ? false : undefined,
          collapsed: md.type === "toggle" ? false : undefined,
        });
        if (el) {
          el.innerHTML = "";
          requestAnimationFrame(() => el.focus());
        }
      }
      setSlash(null);
      setMention(null);
      return;
    }
    // slash
    if (text === "/" || (text.startsWith("/") && !text.includes(" "))) {
      const r = caretRect();
      if (r)
        setSlash({
          blockId: id,
          x: r.left,
          y: r.bottom + 6,
          query: text.slice(1),
        });
    } else if (slash && slash.blockId === id) setSlash(null);
    // mention
    const mq = mentionQuery();
    if (mq != null) {
      const r = caretRect();
      if (r) setMention({ blockId: id, x: r.left, y: r.bottom + 6, query: mq });
    } else if (mention) setMention(null);
  };

  const onEnter = (id: string) => {
    const cur = blocks.find((b) => b.id === id);
    if (cur?.type === "toggle") {
      const nb = blk("p", "");
      nb.indent = (cur.indent || 0) + 1;
      insertAfter(id, nb);
      focusSoon(nb.id);
      return;
    }
    const carry = cur && CARRY.includes(cur.type) && cur.text ? cur.type : "p";
    const nb = blk(carry, "", carry === "todo" ? { done: false } : {});
    nb.indent = cur?.indent || 0;
    insertAfter(id, nb);
    focusSoon(nb.id);
  };

  const onBackspaceEmpty = (id: string) => {
    const cur = blocks.find((b) => b.id === id);
    if (cur && (cur.indent || 0) > 0) {
      setType(id, { indent: (cur.indent || 0) - 1 });
      return;
    }
    if (cur && cur.type !== "p") {
      setType(id, { type: "p" });
      return;
    }
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      if (i <= 0) return bs;
      const prev = bs[i - 1];
      requestAnimationFrame(() => {
        const el = refs.current[prev.id]?.current;
        if (el) {
          el.focus();
          placeCaretEnd(el);
        }
      });
      return bs.filter((b) => b.id !== id);
    });
  };

  const onIndent = (id: string, dir: number) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const maxIndent = i > 0 ? (bs[i - 1].indent || 0) + 1 : 0;
      const cur = Math.max(
        0,
        Math.min((bs[i].indent || 0) + dir, dir > 0 ? maxIndent : 99),
      );
      return bs.map((b) => (b.id === id ? { ...b, indent: cur } : b));
    });

  const onArrow = (id: string, dir: number): boolean => {
    const i = blocks.findIndex((b) => b.id === id);
    const t = blocks[i + dir];
    if (t && refs.current[t.id]?.current) {
      const el = refs.current[t.id].current!;
      el.focus();
      placeCaretEnd(el);
      return true;
    }
    return false;
  };

  const applySlash = (item: SlashItem) => {
    if (!slash) return;
    const id = slash.blockId;
    setSlash(null);
    // AI/workflow actions don't insert a block — they dispatch to the assistant.
    if (item.action) {
      const block = blocks.find((b) => b.id === id);
      const idea = block?.text ?? "";
      if (item.action === "plan") runPlan(idea);
      else if (item.action === "work") runWork();
      return;
    }
    if (item.type === "divider") {
      setType(id, { type: "divider", html: "", text: "" });
      const nb = blk("p", "");
      insertAfter(id, nb);
      focusSoon(nb.id);
      return;
    }
    if (item.type === "database") {
      setType(id, { type: "database", html: "", text: "", view: "board" });
      return;
    }
    if (
      item.type === "image" ||
      item.type === "audio" ||
      item.type === "video" ||
      item.type === "file"
    ) {
      setType(id, { type: item.type, html: "", text: "" });
      return;
    }
    if (item.type === "mermaid") {
      setType(id, { type: "mermaid", html: "", text: "" });
      return;
    }
    if (item.type === "excalidraw") {
      // No src yet — the block mints its assetId and writes the sidecar on the
      // first edit, then records the preview-svg path back into `src`.
      setType(id, { type: "excalidraw", html: "", text: "", src: null });
      return;
    }
    if (item.type === "bookmark") {
      setType(id, { type: "bookmark", html: "", text: "", bm: null });
      return;
    }
    if (item.type === "button") {
      // Seed an editable label + empty prompt; the block opens its editor when
      // run with no prompt set. Templates ship a preset agentPrompt instead.
      setType(id, {
        type: "button",
        html: "",
        text: "Run",
        emoji: "✨",
        agentPrompt: "",
      });
      return;
    }
    if (item.type === "page") {
      const pid = createChildPage();
      if (pid) setType(id, { type: "page", pageId: pid, html: "", text: "" });
      return;
    }
    if (!item.type) return;
    setType(id, {
      type: item.type,
      html: "",
      text: "",
      done: item.type === "todo" ? false : undefined,
      collapsed: item.type === "toggle" ? false : undefined,
    });
    const el = refs.current[id]?.current;
    if (el) {
      el.innerHTML = "";
      focusSoon(id);
    }
  };

  const onInputFromDom = (id: string, el?: HTMLElement) => {
    const node = el || refs.current[id]?.current;
    if (!node) return;
    setBlocks((bs) =>
      bs.map((b) =>
        b.id === id
          ? { ...b, html: node.innerHTML, text: node.textContent || "" }
          : b,
      ),
    );
  };

  const pickMention = (item: MentionItem) => {
    if (!mention) return;
    const id = mention.blockId;
    const el = refs.current[id]?.current;
    setMention(null);
    if (!el) return;
    insertMentionChip(el, item, mention.query.length);
    onInputFromDom(id, el);
  };

  const toggleTodo = (id: string) =>
    setBlocks((bs) =>
      bs.map((b) => (b.id === id ? { ...b, done: !b.done } : b)),
    );
  const toggleCollapse = (id: string) =>
    setBlocks((bs) =>
      bs.map((b) => (b.id === id ? { ...b, collapsed: !b.collapsed } : b)),
    );
  const setView = (id: string, view: DbView) => setType(id, { view });

  const turnInto = (id: string, type: BlockType) =>
    setType(id, {
      type,
      done: type === "todo" ? false : undefined,
      collapsed: type === "toggle" ? false : undefined,
    });
  const colorBlock = (
    id: string,
    patch: { color?: string | null; bg?: string | null },
  ) =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.id === id
          ? {
              ...b,
              color: "color" in patch ? patch.color : b.color,
              bg: "bg" in patch ? patch.bg : b.bg,
            }
          : b,
      ),
    );
  const duplicate = (id: string) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const copy = { ...bs[i], id: uid("b") };
      const n = [...bs];
      n.splice(i + 1, 0, copy);
      return n;
    });
  const removeBlock = (id: string) =>
    setBlocks((bs) => bs.filter((b) => b.id !== id));

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.id === dragId);
      const to = bs.findIndex((b) => b.id === targetId);
      const n = [...bs];
      const [m] = n.splice(from, 1);
      const insertAt = to;
      n.splice(insertAt, 0, m);
      const prev = n[insertAt - 1];
      const max = prev ? (prev.indent || 0) + 1 : 0;
      n[insertAt] = { ...m, indent: Math.max(0, Math.min(overIndent, max)) };
      return n;
    });
    setDragId(null);
    setOverId(null);
  };
  const computeIndent = (clientX: number) => {
    const left = blocksRef.current
      ? blocksRef.current.getBoundingClientRect().left
      : 0;
    setOverIndent(
      Math.max(0, Math.min(Math.round((clientX - left - 2) / 24), 6)),
    );
  };

  // group proposals + compute toggle visibility
  const rows: Row[] = [];
  let hideDeeper: number | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (hideDeeper != null) {
      if ((b.indent || 0) > hideDeeper) continue;
      else hideDeeper = null;
    }
    if (b.proposalId) {
      const group = [b];
      while (
        i + 1 < blocks.length &&
        blocks[i + 1].proposalId === b.proposalId
      ) {
        group.push(blocks[i + 1]);
        i++;
      }
      rows.push({
        kind: "proposal",
        proposalId: b.proposalId,
        label: b.proposalLabel,
        blocks: group,
      });
    } else {
      rows.push({ kind: "block", block: b });
      if (b.type === "toggle" && b.collapsed) hideDeeper = b.indent || 0;
    }
  }

  const innerProps = {
    updateBlock,
    onEnter,
    onBackspaceEmpty,
    onIndent,
    onArrow,
    toggleTodo,
    toggleCollapse,
    registerRef,
    setView,
    onOpenTask: onOpenTask as (t: Task) => void,
    setType,
    onInputFromDom: (id: string) => onInputFromDom(id),
    onDecision: onProposalDecision,
    onOpenPage,
    pageMeta,
  };

  return (
    <div className="blocks" ref={blocksRef}>
      {rows.map((row) =>
        row.kind === "block" ? (
          <BlockRow
            key={row.block.id}
            block={row.block}
            dragId={dragId}
            overId={overId}
            overIndent={overIndent}
            setDragId={setDragId}
            setOverId={setOverId}
            onDrop={onDrop}
            computeIndent={computeIndent}
            onMenu={(rect) =>
              setBmenu({ block: row.block, x: rect.right + 4, y: rect.top })
            }
            onAdd={(rect) =>
              setSlash({
                blockId: row.block.id,
                x: rect.right + 4,
                y: rect.bottom + 4,
                query: "",
              })
            }
          >
            <BlockInner block={row.block} {...innerProps} />
          </BlockRow>
        ) : (
          <div
            className="proposed-group"
            id={`grp-${row.proposalId}`}
            key={row.proposalId}
          >
            <div className="proposed-head">
              <span className="dot"></span>
              <Icon name="sparkle" size={13} /> {row.label || "Suggested edit"}
              <div className="proposed-actions">
                <button
                  className="pa-btn pa-reject"
                  onClick={() => onProposalDecision(row.proposalId, false)}
                >
                  Discard
                </button>
                <button
                  className="pa-btn pa-accept"
                  onClick={() => onProposalDecision(row.proposalId, true)}
                >
                  <Icon name="check" size={13} /> Accept
                </button>
              </div>
            </div>
            {row.blocks.map((b) => (
              <BlockInner key={b.id} block={b} {...innerProps} />
            ))}
          </div>
        ),
      )}

      {slash && (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          query={slash.query}
          onPick={applySlash}
          onClose={() => setSlash(null)}
        />
      )}
      {mention && (
        <MentionMenu
          x={mention.x}
          y={mention.y}
          query={mention.query}
          onPick={pickMention}
          onClose={() => setMention(null)}
        />
      )}
      {bmenu && (
        <BlockMenu
          x={bmenu.x}
          y={bmenu.y}
          block={bmenu.block}
          onClose={() => setBmenu(null)}
          onTurnInto={turnInto}
          onColor={colorBlock}
          onDuplicate={duplicate}
          onCopyLink={copyBlockLink}
          onDelete={removeBlock}
          onComment={(id) => onComment(id, bmenu.block.text || "block")}
        />
      )}
    </div>
  );
}
