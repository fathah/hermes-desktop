// workspace.ts — tree, page meta, docs, trash + all page/tree/doc actions.
// Ported from app.jsx (selectPage, makePage, deletePage, …) and store.jsx tree ops.
import type { StateCreator } from "zustand";
import { blk, uid } from "../../lib/ids";
import { clearWorkspace } from "../../lib/persistence";
import { getStorageMode } from "../../lib/storageMode";
import { deleteVaultPages, deleteVaultDbFolders } from "../../lib/vaultStore";
import {
  treeFind,
  treeInsert,
  treeMove,
  treeRemove,
  treeWalkIds,
} from "../../lib/tree";
import { buildInitialWorkspace } from "../../data/seed";
import { initialWorkspace as initial } from "../initial";
import { pageFromMarkdown } from "../../editor/pageMarkdown";
import {
  enqueueOcrJob,
  removeOcrJob,
  peekOcrJob,
  loadOcrQueue,
} from "../../lib/ocrQueue";
import {
  getOcrDefer,
  setOcrDefer,
  getOcrTime,
  isScheduledNow,
} from "../../lib/ocrSchedule";
import type { Block, Task, TrashEntry, TreeNode } from "../../types";
import type { Store, WorkspaceSlice } from "../storeTypes";
import type { WorkDetail } from "../../../../../../shared/openalex/core";

/** Title of the root folder that ingested documents are filed under. */
const SOURCES_TITLE = "Sources";
/** Title of the folder (under Sources) that saved OpenAlex papers are filed under. */
const RESEARCH_TITLE = "Research";
/** Title of the root folder that agent-maintained wiki pages are filed under. */
const WIKI_TITLE = "Wiki";

/** First `n` sentences of `text`, or a trimmed clamp when it has no punctuation. */
function firstSentences(text: string, n: number): string {
  const clean = text.trim();
  if (!clean) return "";
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return clean.length > 280 ? `${clean.slice(0, 277)}…` : clean;
  return sentences.slice(0, n).join(" ").trim();
}

/** Failure sentinels the gateway-backed assistant returns when it can't help. */
const ASSISTANT_FAILURE = [
  "couldn't reach the assistant",
  "couldn't structure",
];

/** Coerce an spsAssistant result into a TL;DR string, or "" if unusable. */
function tldrFromAssistant(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const reply = (res as { reply?: unknown }).reply;
  if (!Array.isArray(reply)) return "";
  const joined = reply.map(String).join(" ").trim();
  const low = joined.toLowerCase();
  if (!joined || ASSISTANT_FAILURE.some((s) => low.includes(s))) return "";
  return joined;
}

/** The `source` folders of folder-backed database blocks in a block list. */
function dbSources(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type === "database" && b.source) out.add(b.source);
  }
  return out;
}

function cloneTreeNode(node: TreeNode): TreeNode {
  return { id: node.id, children: node.children.map(cloneTreeNode) };
}

function trashSubtree(entry: TrashEntry): TreeNode {
  if (entry.subtree) return cloneTreeNode(entry.subtree);
  return {
    id: entry.id,
    children: (entry.ids || [])
      .filter((id) => id !== entry.id)
      .map((id) => ({ id, children: [] })),
  };
}

type StoreGet = () => Store;
type StoreSet = (
  partial: Partial<Store> | ((s: Store) => Partial<Store>),
) => void;

// One drain loop at a time across the app (the OCR worker is shared).
let ocrDraining = false;

/**
 * Drain the persisted OCR queue sequentially: read each PDF's bytes, OCR it
 * (offline, in a worker), and file the result under "Sources". Best-effort per
 * job — a failed job is dropped with a warn toast so the batch keeps moving.
 * Survives restarts: a job is only removed once it fully completes, so an
 * interrupted job re-runs on the next ocrResume().
 */
async function drainOcrQueue(get: StoreGet, set: StoreSet): Promise<void> {
  if (ocrDraining) return;
  ocrDraining = true;
  try {
    let job = peekOcrJob();
    while (job) {
      const current = job;
      set({
        ocrActive: { title: current.title, page: 0, pages: current.pageCount },
        ocrPending: loadOcrQueue().length,
      });
      try {
        const api = window.hermesAPI;
        if (!api?.spsReadFileBytes) throw new Error("no local workspace");
        const bytes = await api.spsReadFileBytes(current.filePath);
        const { ocrPdfToMarkdown } = await import("../../lib/ocr");
        const markdown = await ocrPdfToMarkdown(bytes, (p) =>
          set({
            ocrActive: { title: current.title, page: p.page, pages: p.pages },
          }),
        );
        const { blocks } = pageFromMarkdown(markdown);
        const docBlocks = blocks.length ? blocks : [blk("p", "")];
        get().makePage(
          {
            icon: "📄",
            title: current.title,
            source: current.filePath,
            ingestedAt: Date.now(),
          },
          docBlocks,
          get().ensureSourcesFolder(),
        );
        get().flash(`OCR complete — imported “${current.title}” into Sources`);
      } catch {
        get().flash(`OCR failed for “${current.title}” — skipped`, {
          tone: "warn",
          ms: 8000,
        });
      }
      removeOcrJob(current.id);
      set({ ocrPending: loadOcrQueue().length });
      job = peekOcrJob();
    }
  } finally {
    ocrDraining = false;
    set({ ocrActive: null });
  }
}

// Overnight scheduler (P3): once started, every 30s check whether deferral is on
// and the clock is in the configured minute; if so, drain. Only fires while the
// app is running (open or in the tray) — no OS daemon.
let ocrSchedulerStarted = false;
function startOcrScheduler(get: StoreGet, set: StoreSet): void {
  if (ocrSchedulerStarted) return;
  ocrSchedulerStarted = true;
  setInterval(() => {
    if (
      get().ocrDefer &&
      peekOcrJob() &&
      isScheduledNow(new Date(), getOcrTime())
    ) {
      void drainOcrQueue(get, set);
    }
  }, 30000);
}

export const createWorkspaceSlice: StateCreator<
  Store,
  [],
  [],
  WorkspaceSlice
> = (set, get) => ({
  tree: initial.tree,
  meta: initial.meta,
  trash: initial.trash,
  page: initial.page in (initial.docs || {}) ? initial.page : "home",
  docs: initial.docs,
  ocrActive: null,
  ocrPending: loadOcrQueue().length,
  ocrDefer: getOcrDefer(),

  setBlocks: (updater) =>
    set((s) => {
      const cur = s.docs[s.page] || [];
      const next = updater(cur);
      // F3: in vault mode, removing a folder-backed database block orphans its
      // row folder on disk. Clean it up — but only if no other page (nor the new
      // current page) still references that source (best-effort, never throws).
      if (getStorageMode() === "vault") {
        const after = dbSources(next);
        const removed = [...dbSources(cur)].filter((src) => !after.has(src));
        if (removed.length) {
          const stillUsed = new Set<string>(after);
          for (const [pid, blocks] of Object.entries(s.docs)) {
            if (pid === s.page) continue;
            for (const src of dbSources(blocks)) stillUsed.add(src);
          }
          const orphaned = removed.filter((src) => !stillUsed.has(src));
          if (orphaned.length) void deleteVaultDbFolders(orphaned);
        }
      }
      return { docs: { ...s.docs, [s.page]: next } };
    }),

  setPageDoc: (id, blocks) =>
    set((s) => ({ docs: { ...s.docs, [id]: blocks } })),

  selectPage: (id) =>
    set((s) => {
      if (id === s.page) return { paletteOpen: false };
      const docs = { ...s.docs };
      if (!docs[id]) docs[id] = [blk("p", "")];
      const meta = s.meta[id]
        ? s.meta
        : { ...s.meta, [id]: { icon: "📄", title: "Untitled", cover: null } };
      return { page: id, docs, meta, paletteOpen: false };
    }),

  makePage: (info, docBlocks, parentId) => {
    const id = uid("pg");
    set((s) => ({
      docs: { ...s.docs, [id]: docBlocks },
      meta: {
        ...s.meta,
        [id]: {
          icon: info.icon || "📄",
          title: info.title || "Untitled",
          cover: null,
          // KB ingestion provenance — only stamped when supplied.
          ...(info.source !== undefined ? { source: info.source } : {}),
          ...(info.ingestedAt !== undefined
            ? { ingestedAt: info.ingestedAt }
            : {}),
          // Journal fields are written only when supplied, so ordinary pages
          // keep their original 3-key meta shape (and serialization).
          ...(info.journal !== undefined ? { journal: info.journal } : {}),
          ...(info.date !== undefined ? { date: info.date } : {}),
          ...(info.time !== undefined ? { time: info.time } : {}),
          ...(info.mood !== undefined ? { mood: info.mood } : {}),
        },
      },
      tree: treeInsert(
        s.tree,
        parentId,
        { id, children: [] },
        parentId ? "inside" : "root",
      ),
    }));
    return id;
  },

  // Like makePage, but uses a CALLER-supplied id so [[wikilink]] targets resolve
  // to the page's file basename (the second-brain ingest needs slug ids).
  makePageWithId: (id, info, docBlocks, parentId) => {
    set((s) => ({
      docs: { ...s.docs, [id]: docBlocks },
      meta: {
        ...s.meta,
        [id]: {
          icon: info.icon || "📄",
          title: info.title || "Untitled",
          cover: null,
          ...(info.source !== undefined ? { source: info.source } : {}),
          ...(info.ingestedAt !== undefined
            ? { ingestedAt: info.ingestedAt }
            : {}),
        },
      },
      tree: treeInsert(
        s.tree,
        parentId,
        { id, children: [] },
        parentId ? "inside" : "root",
      ),
    }));
    return id;
  },

  importPdf: async () => {
    const api = window.hermesAPI;
    if (!api?.spsPickPdf || !api?.spsExtractPdf) {
      get().flash("PDF import needs a local workspace");
      return;
    }
    set({ templatesOpen: null });
    const filePath = await api.spsPickPdf();
    if (!filePath) return;
    get().flash("Extracting PDF…");
    let res: Awaited<ReturnType<typeof api.spsExtractPdf>>;
    try {
      res = await api.spsExtractPdf(filePath);
    } catch {
      get().flash("Could not read that PDF", { tone: "warn", ms: 8000 });
      return;
    }
    if (!res.hasTextLayer) {
      // No usable text layer — scanned image, OR a broken/unmappable font that
      // renders correctly but extracts garbage. Both render fine to a bitmap,
      // so queue the pages for background OCR instead of refusing.
      get().ocrEnqueue(filePath, res.title, res.pageCount);
      return;
    }
    const { blocks } = pageFromMarkdown(res.markdown);
    const docBlocks = blocks.length ? blocks : [blk("p", "")];
    const id = get().makePage(
      {
        icon: "📄",
        title: res.title,
        source: filePath,
        ingestedAt: Date.now(),
      },
      docBlocks,
      get().ensureSourcesFolder(),
    );
    set({ page: id });
    get().flash(`Imported “${res.title}” into Sources`);
  },

  ocrEnqueue: (filePath, title, pageCount) => {
    const api = window.hermesAPI;
    if (!api?.spsReadFileBytes) {
      get().flash("OCR needs a local workspace", { tone: "warn", ms: 8000 });
      return;
    }
    enqueueOcrJob({
      id: uid("ocr"),
      filePath,
      title,
      pageCount,
      addedAt: Date.now(),
    });
    const pending = loadOcrQueue().length;
    set({ ocrPending: pending });
    const big = pageCount > 15;
    if (get().ocrDefer) {
      get().flash(
        `Scanned PDF (${pageCount}p) queued for overnight OCR (${getOcrTime()}) — ` +
          `“${title}” will appear in Sources after the run. Use “Run now” to start sooner.`,
        { tone: "warn", ms: 8000 },
      );
      return; // wait for the scheduled window / a manual Run now
    }
    get().flash(
      `Scanned PDF (${pageCount}p) queued for OCR — “${title}” will appear in ` +
        `Sources when ready` +
        (big ? " (large scan, may take several minutes)" : "") +
        (pending > 1 ? `. ${pending} documents in the OCR queue.` : "."),
      { tone: "warn", ms: 8000 },
    );
    void drainOcrQueue(get, set);
  },

  ocrResume: () => {
    set({ ocrPending: loadOcrQueue().length, ocrDefer: getOcrDefer() });
    startOcrScheduler(get, set);
    // Resume immediately unless the user chose to defer to the overnight window.
    if (!get().ocrDefer) void drainOcrQueue(get, set);
  },

  ocrRunNow: () => void drainOcrQueue(get, set),

  ocrSetDefer: (on) => {
    setOcrDefer(on);
    set({ ocrDefer: on });
    // Turning deferral OFF should start draining anything that was waiting.
    if (!on) void drainOcrQueue(get, set);
  },

  ensureSourcesFolder: () => {
    // A dedicated home for ingested documents. Identified by title at the root
    // level (no persisted marker, so the markdown serializers stay untouched);
    // reused if present, created at root on first import.
    const { meta, tree } = get();
    const existing = tree.find((n) => meta[n.id]?.title === SOURCES_TITLE);
    if (existing) return existing.id;
    return get().makePage(
      { icon: "🗂️", title: SOURCES_TITLE },
      [
        blk(
          "p",
          "Imported documents live here — each ingested file becomes a page you can read, link, and ground the co-author on.",
        ),
      ],
      null,
    );
  },

  ensureResearchFolder: () => {
    // A "Research" folder nested under "Sources", so saved papers live alongside
    // imported PDFs and are equally linkable/groundable. Identified by title
    // among the Sources folder's children; reused if present.
    const sources = get().ensureSourcesFolder();
    const { meta, tree } = get();
    const sourcesNode = treeFind(tree, sources);
    const existing = sourcesNode?.children.find(
      (n) => meta[n.id]?.title === RESEARCH_TITLE,
    );
    if (existing) return existing.id;
    return get().makePage(
      { icon: "📚", title: RESEARCH_TITLE },
      [
        blk(
          "p",
          "Scholarly papers you saved from OpenAlex live here — each one a plain-language summary you can read, link, and ground the co-author on.",
        ),
      ],
      sources,
    );
  },

  ensureWikiFolder: () => {
    // A dedicated root home for agent-maintained wiki pages (second brain).
    const { meta, tree } = get();
    const existing = tree.find((n) => meta[n.id]?.title === WIKI_TITLE);
    if (existing) return existing.id;
    return get().makePage(
      { icon: "🧠", title: WIKI_TITLE },
      [
        blk(
          "p",
          "Your second brain — interlinked pages My Assistant maintains from the captures you process in the Inbox.",
        ),
      ],
      null,
    );
  },

  ingestCommitPage: (page) => {
    // Commit one proposed wiki page through the canonical store path so it shows
    // in BOTH storage modes (the editor materializes it; autosave mirrors it to
    // the vault as <pageId>.md, which is what [[wikilinks]] resolve to).
    const { blocks } = pageFromMarkdown(page.markdown);
    const docBlocks = blocks.length ? blocks : [blk("p", "")];
    const exists = !!get().docs[page.pageId] || !!get().meta[page.pageId];
    if (exists) {
      get().setPageDoc(page.pageId, docBlocks);
      set((s) => ({
        meta: {
          ...s.meta,
          [page.pageId]: {
            ...s.meta[page.pageId],
            icon: s.meta[page.pageId]?.icon || "📝",
            cover: s.meta[page.pageId]?.cover ?? null,
            title: page.title,
          },
        },
      }));
      return page.pageId;
    }
    const parent = get().ensureWikiFolder();
    return get().makePageWithId(
      page.pageId,
      {
        icon: "📝",
        title: page.title,
        source: "ingest",
        ingestedAt: Date.now(),
      },
      docBlocks,
      parent,
    );
  },

  importResearchWork: async (work: WorkDetail) => {
    // Plain-language TL;DR via the gateway co-author; degrade to the abstract's
    // first sentences if the gateway is down so the feature never hard-fails.
    let tldr = firstSentences(work.abstract, 2);
    const api = window.hermesAPI;
    if (api?.spsAssistant && work.abstract) {
      try {
        const res = await api.spsAssistant(
          `Summarize this paper in 2 plain-language sentences for a non-specialist. ` +
            `Title: ${work.title}\n\nAbstract: ${work.abstract}`,
          { blocks: [], pageTitle: work.title },
        );
        const candidate = tldrFromAssistant(res);
        if (candidate) tldr = candidate;
      } catch {
        /* keep the abstract-derived fallback */
      }
    }

    const glance = [
      `${work.citedByCount} citation${work.citedByCount === 1 ? "" : "s"}`,
      work.year ? String(work.year) : null,
      work.venue || null,
    ]
      .filter(Boolean)
      .join(" · ");

    const blocks: Block[] = [
      blk("callout", tldr || "No summary available.", { emoji: "🧭" }),
      blk("h3", "Abstract"),
      blk("p", work.abstract || "No abstract available."),
      blk("h3", "At a glance"),
      blk("p", glance),
    ];
    if (work.oaUrl) {
      blocks.push(
        blk("bookmark", "", {
          bm: {
            url: work.oaUrl,
            title: "Open-access PDF",
            desc: work.venue || "",
          },
        }),
      );
    }
    if (work.topics.length) {
      const tags = work.topics
        .map((t) => `#${t.trim().replace(/\s+/g, "-")}`)
        .join(" ");
      blocks.push(blk("p", tags));
    }

    const id = get().makePage(
      {
        icon: "📄",
        title: work.title,
        source: `openalex:${work.id}`,
        ingestedAt: Date.now(),
      },
      blocks,
      get().ensureResearchFolder(),
    );
    set({ page: id });
    get().flash(`Saved “${work.title}” to Research`);
  },

  newSubPage: (parentId) => {
    const id = get().makePage(
      { icon: "📄", title: "Untitled" },
      [blk("p", "")],
      parentId,
    );
    set({ page: id });
    get().flash("Page created");
  },

  createChildPage: () => {
    const id = get().makePage(
      { icon: "📄", title: "Untitled" },
      [blk("p", "")],
      get().page,
    );
    get().flash("Sub-page created");
    return id;
  },

  createFromTemplate: (blocks, info, parent) => {
    const id = get().makePage(
      {
        icon: info.emoji,
        title: info.name === "Blank doc" ? "Untitled" : info.name,
      },
      blocks,
      parent,
    );
    set({ page: id, templatesOpen: null });
  },

  deletePage: (id) => {
    const target = id || get().page;
    if (target === "home") {
      get().flash("Home can't be deleted");
      return;
    }
    let ids = [target];
    set((s) => {
      const [tree, subtree] = treeRemove(s.tree, target);
      ids = subtree ? treeWalkIds(subtree) : [target];
      const meta = s.meta[target] || {};
      return {
        trash: [
          ...s.trash,
          {
            id: target,
            title: meta.title || "Untitled",
            icon: meta.icon || "📄",
            ids,
            ...(subtree ? { subtree } : {}),
          },
        ],
        tree,
      };
    });
    get().flash("Moved to trash");
    if (ids.includes(get().page)) get().selectPage("home");
  },

  restorePage: (entry) => {
    set((s) => ({
      trash: s.trash.filter((x) => x.id !== entry.id),
      tree: treeInsert(s.tree, null, trashSubtree(entry), "root"),
    }));
    get().flash("Restored to workspace");
  },

  purgeTrashedPage: (entry) => {
    const ids = entry.ids.length ? entry.ids : [entry.id];
    const deletedIds = new Set(ids);
    const sources = new Set<string>();
    const liveSources = new Set<string>();
    set((s) => {
      const docs = { ...s.docs };
      const meta = { ...s.meta };
      for (const id of ids) {
        for (const source of dbSources(docs[id] || [])) sources.add(source);
        delete docs[id];
        delete meta[id];
      }
      for (const [id, blocks] of Object.entries(docs)) {
        if (deletedIds.has(id)) continue;
        for (const source of dbSources(blocks)) liveSources.add(source);
      }
      return {
        docs,
        meta,
        trash: s.trash.filter((x) => x.id !== entry.id),
        comments: s.comments.filter(
          (comment) => !comment.page || !ids.includes(comment.page),
        ),
      };
    });
    void deleteVaultPages(ids);
    void deleteVaultDbFolders(
      [...sources].filter((source) => !liveSources.has(source)),
    );
    get().flash("Permanently deleted");
  },

  renamePage: (id, title) =>
    set((s) => ({ meta: { ...s.meta, [id]: { ...s.meta[id], title } } })),

  movePage: (dragId, targetId, where) =>
    set((s) => ({ tree: treeMove(s.tree, dragId, targetId, where) })),

  setPMeta: (patch) =>
    set((s) => ({
      meta: { ...s.meta, [s.page]: { ...s.meta[s.page], ...patch } },
    })),

  setPageMeta: (id, patch) =>
    set((s) => ({
      meta: { ...s.meta, [id]: { ...(s.meta[id] || {}), ...patch } },
    })),

  resetWorkspace: () => {
    const oldIds = Object.keys(get().docs);
    clearWorkspace();
    const fresh = buildInitialWorkspace();
    set({
      tree: fresh.tree,
      meta: fresh.meta,
      trash: fresh.trash,
      page: fresh.page,
      docs: fresh.docs as Record<string, Block[]>,
      comments: fresh.comments,
    });
    // F3: in vault mode the replaced pages are now orphan `<pageId>.md` files on
    // disk — remove the ones the fresh sample doesn't reuse (best-effort; the S6
    // manifest scoping already stops them resurrecting, this stops them lingering).
    // Note: deletePage only moves to trash, which stays restorable across reload
    // (its files are intentionally retained), so it must NOT delete here.
    if (getStorageMode() === "vault") {
      const kept = new Set(Object.keys(fresh.docs));
      void deleteVaultPages(oldIds.filter((id) => !kept.has(id)));
    }
    get().flash("Workspace reset to sample");
  },

  updateTask: (id: string, patch: Partial<Task>) =>
    set((s) => {
      const cur = s.docs[s.page] || [];
      const next = cur.map((block) => {
        if (block.type === "database") {
          const rows = block.rows || [];
          const nextRows = rows.map((r) => {
            if (r.id === id) {
              return { ...r, ...patch };
            }
            return r;
          });
          return { ...block, rows: nextRows };
        }
        return block;
      });
      return { docs: { ...s.docs, [s.page]: next } };
    }),

  deleteDoneTasks: () =>
    set((s) => {
      const cur = s.docs[s.page] || [];
      const next = cur.map((block) => {
        if (block.type === "database") {
          const rows = block.rows || [];
          const nextRows = rows.filter((r) => r.status !== "done");
          return { ...block, rows: nextRows };
        }
        return block;
      });
      return { docs: { ...s.docs, [s.page]: next } };
    }),
});
