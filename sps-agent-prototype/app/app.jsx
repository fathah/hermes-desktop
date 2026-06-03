// app.jsx — composes the workspace, owns shared state (persisted)
const { useState: useS, useEffect: useE, useRef: useR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "accent": "#C79400",
  "sidebar": "full",
  "width": "comfortable",
  "density": "comfortable",
  "bodyfont": "sans"
}/*EDITMODE-END*/;

const ACCENTS = ["#C79400", "#1B4F8A", "#A1202C", "#1F6B3A", "#5A3A8A"];
const WIDTHS = { comfortable: "740px", narrow: "640px", wide: "880px", full: "none" };
const PRESENCE = [["theo", "#1F6B3A"], ["priya", "#1B4F8A"], ["sam", "#5A3A8A"]];

const TEMPLATES = [
  { id: "meeting", emoji: "🗓️", name: "Meeting notes", desc: "Attendees, agenda, decisions, action items.",
    blocks: () => [blk("h2", "Agenda"), blk("li", "Topic one"), blk("li", "Topic two"), blk("h2", "Decisions"), blk("li", ""), blk("h2", "Action items"), blk("todo", "", { done: false })] },
  { id: "project", emoji: "🚀", name: "Project plan", desc: "Goal, milestones, owners, and a task board.",
    blocks: () => [blk("callout", "Goal: describe the outcome in one sentence.", { emoji: "🎯" }), blk("h2", "Milestones"), blk("todo", "Kickoff", { done: false }), blk("h2", "Tasks"), blk("database", "", { view: "board" })] },
  { id: "doc", emoji: "📝", name: "Blank doc", desc: "Start from an empty page.", blocks: () => [blk("p", "")] },
  { id: "wiki", emoji: "📚", name: "Wiki page", desc: "Overview, details, and related links.",
    blocks: () => [blk("h2", "Overview"), blk("p", ""), blk("h2", "Details"), blk("toggle", "Read more", { collapsed: false }), blk("p", "")] },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const initRef = useR(null);
  if (!initRef.current) initRef.current = loadWS() || buildInitialWorkspace();
  const initial = initRef.current;

  const docsRef = useR(initial.docs);
  const [tree, setTree] = useS(initial.tree);
  const [meta, setMeta] = useS(initial.meta);
  const [comments, setComments] = useS(initial.comments);
  const [trash, setTrash] = useS(initial.trash);
  const [page, setPage] = useS(initial.page in docsRef.current ? initial.page : "home");
  const [blocks, setBlocks] = useS(docsRef.current[initial.page] || docsRef.current.home);

  const [panelOpen, setPanelOpen] = useS(true);
  const [rightTab, setRightTab] = useS("assistant");
  const [paletteOpen, setPaletteOpen] = useS(false);
  const [templatesOpen, setTemplatesOpen] = useS(null); // null | {parent}
  const [trashOpen, setTrashOpen] = useS(false);
  const [openTask, setOpenTask] = useS(null);
  const [emojiPick, setEmojiPick] = useS(null);
  const [coverPick, setCoverPick] = useS(null);
  const [toast, setToast] = useS(null);
  const [focusReq, setFocusReq] = useS(null);
  const docScrollRef = useR(null);
  const saveTimer = useR(null);

  const [messages, setMessages] = useS([
    { id: uid("m"), role: "bot", text: ["Hi Maya — I'm your workspace assistant. I can read this page, rewrite text as tracked changes, answer questions, and act on the task board. Try a suggestion below."] },
  ]);
  const [thinking, setThinking] = useS(false);

  useE(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.dark ? "dark" : "light");
    r.setAttribute("data-density", t.density === "compact" ? "compact" : "comfortable");
    r.setAttribute("data-bodyfont", t.bodyfont);
    r.setAttribute("data-width", t.width === "full" ? "full" : "fixed");
    r.style.setProperty("--accent", t.accent);
    r.style.setProperty("--content-w", WIDTHS[t.width] || "740px");
  }, [t]);

  // persist (debounced)
  useE(() => {
    docsRef.current[page] = blocks;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveWS({ docs: docsRef.current, meta, tree, comments, trash, page }), 350);
  }, [blocks, meta, tree, comments, trash, page]);

  const pmeta = meta[page] || { icon: "📄", title: "Untitled", cover: null };
  const setPMeta = (patch) => setMeta((m) => ({ ...m, [page]: { ...m[page], ...patch } }));
  const pathIds = page === "home" ? ["home"] : (treePathIds(tree, page) || [page]);

  const selectPage = (id) => {
    if (id === page) { setPaletteOpen(false); return; }
    docsRef.current[page] = blocks;
    if (!meta[id]) setMeta((m) => ({ ...m, [id]: { icon: "📄", title: "Untitled", cover: null } }));
    const doc = docsRef.current[id] || [blk("p", "")];
    docsRef.current[id] = doc;
    setPage(id); setBlocks(doc); setPaletteOpen(false);
    if (docScrollRef.current) docScrollRef.current.scrollTop = 0;
  };

  const makePage = (info, docBlocks, parentId) => {
    const id = uid("pg");
    docsRef.current[id] = docBlocks;
    setMeta((m) => ({ ...m, [id]: { icon: info.icon || "📄", title: info.title || "Untitled", cover: null } }));
    setTree((tr) => treeInsert(tr, parentId, { id, children: [] }, parentId ? "inside" : "root"));
    return id;
  };
  const newSubPage = (parentId) => { docsRef.current[page] = blocks; const id = makePage({ icon: "📄", title: "Untitled" }, [blk("p", "")], parentId); setPage(id); setBlocks(docsRef.current[id]); if (docScrollRef.current) docScrollRef.current.scrollTop = 0; flash("Page created"); };
  const createFromTemplate = (tpl) => { docsRef.current[page] = blocks; const parent = templatesOpen && templatesOpen.parent; const id = makePage({ icon: tpl.emoji, title: tpl.name === "Blank doc" ? "Untitled" : tpl.name }, tpl.blocks(), parent); setPage(id); setBlocks(docsRef.current[id]); setTemplatesOpen(null); if (docScrollRef.current) docScrollRef.current.scrollTop = 0; };

  const createChildPage = () => { const id = makePage({ icon: "📄", title: "Untitled" }, [blk("p", "")], page); flash("Sub-page created"); return id; };

  const deletePage = (id) => {
    const target = id || page;
    if (target === "home") { flash("Home can't be deleted"); return; }
    const node = treeFind(tree, target);
    const ids = node ? treeWalkIds(node) : [target];
    setTrash((tr) => [...tr, { id: target, title: (meta[target] || {}).title || "Untitled", icon: (meta[target] || {}).icon || "📄", ids }]);
    setTree((tr) => treeRemove(tr, target)[0]);
    flash("Moved to trash");
    if (ids.includes(page)) selectPage("home");
  };
  const restorePage = (entry) => { setTrash((tr) => tr.filter((x) => x.id !== entry.id)); setTree((tr) => treeInsert(tr, null, { id: entry.id, children: [] }, "root")); flash("Restored to workspace"); };
  const renamePage = (id, title) => setMeta((m) => ({ ...m, [id]: { ...m[id], title } }));
  const movePage = (dragId, targetId, where) => setTree((tr) => treeMove(tr, dragId, targetId, where));

  // ---- agent ----
  const pushUser = (text) => setMessages((ms) => [...ms, { id: uid("m"), role: "user", text: [text] }]);
  const pushBot = (msg) => setMessages((ms) => [...ms, { id: uid("m"), role: "bot", ...msg }]);

  const runAgent = (prompt) => {
    pushUser(prompt); setThinking(true);
    setTimeout(() => {
      const resp = generateResponse(prompt, blocks);
      setThinking(false);
      if (resp.kind === "chat") { pushBot({ text: resp.reply }); return; }
      if (resp.kind === "db") {
        pushBot({ text: resp.reply, dbAction: resp.action, label: resp.label, status: "pending" });
        return;
      }
      if (resp.kind === "diff") {
        const pid = uid("prop");
        let any = false;
        setBlocks((bs) => bs.map((b) => {
          const hit = resp.edits.find((e) => b.text && b.text.toLowerCase().includes(e.find.toLowerCase()) && !b.diff);
          if (hit && !any) { any = true; return { ...b, diff: { proposalId: pid, oldHtml: b.html != null ? b.html : escapeHtml(b.text), newHtml: hit.html, label: resp.label } }; }
          return b;
        }));
        pushBot({ text: resp.reply, proposalId: pid, label: resp.label, status: "pending", diff: true });
        requestAnimationFrame(() => scrollToProposal(pid));
        return;
      }
      // append
      const pid = uid("prop");
      const tagged = resp.blocks.map((b) => ({ ...b, id: uid("pb"), proposalId: pid, proposalLabel: resp.label }));
      setBlocks((bs) => { const next = [...bs]; if (resp.at === "top") next.splice(1, 0, ...tagged); else { let idx = next.length; if (next[idx - 1] && next[idx - 1].type === "p" && !next[idx - 1].text) idx -= 1; next.splice(idx, 0, ...tagged); } return next; });
      pushBot({ text: resp.reply, proposalId: pid, label: resp.label, status: "pending" });
      requestAnimationFrame(() => scrollToProposal(pid));
    }, 800);
  };

  const decideProposal = (pid, accept) => {
    setBlocks((bs) => {
      let out = bs;
      // diff edits
      out = out.map((b) => {
        if (b.diff && b.diff.proposalId === pid) {
          if (accept) return { ...b, html: b.diff.newHtml, text: stripHtml(b.diff.newHtml), diff: undefined };
          return { ...b, diff: undefined };
        }
        return b;
      });
      // appended blocks
      out = accept ? out.map((b) => (b.proposalId === pid ? { ...b, proposalId: undefined, proposalLabel: undefined } : b)) : out.filter((b) => b.proposalId !== pid);
      return out;
    });
    setMessages((ms) => ms.map((m) => (m.proposalId === pid ? { ...m, status: accept ? "applied" : "rejected" } : m)));
    flash(accept ? "Change applied" : "Suggestion discarded");
  };

  const applyDbAction = (mid, action) => {
    setBlocks((bs) => bs.map((b) => {
      if (b.type !== "database") return b;
      const rows = b.rows || TASKS;
      let next = rows;
      if (action.type === "markDone") next = rows.map((r) => (action.who ? r.who === action.who : true) ? { ...r, status: "done" } : r);
      else if (action.type === "addTask") next = [...rows, { id: uid("t"), title: action.title, status: "todo", prio: "med", who: "maya", due: "Jun 6", est: "1d" }];
      return { ...b, rows: next, view: action.view || b.view };
    }));
    setMessages((ms) => ms.map((m) => (m.id === mid ? { ...m, status: "applied" } : m)));
    flash("Board updated");
  };
  const dismissDbAction = (mid) => setMessages((ms) => ms.map((m) => (m.id === mid ? { ...m, status: "rejected" } : m)));

  const askAbout = (text) => {
    setPanelOpen(true); setRightTab("assistant");
    pushUser(`About “${text.slice(0, 60)}${text.length > 60 ? "…" : ""}” — explain this.`);
    setThinking(true);
    setTimeout(() => { setThinking(false); pushBot({ text: [`That line refers to work tracked on this page. In short: it's part of the team's current cycle. I can expand it, add a definition, or turn it into a task — just say the word.`] }); }, 700);
  };

  const scrollToProposal = (pid) => { const el = document.getElementById(`grp-${pid}`) || document.querySelector(`[data-diff="${pid}"]`); scrollToEl(el); };
  const scrollToBlock = (bid) => scrollToEl(document.getElementById(`bw-${bid}`));
  const scrollToEl = (el) => { const sc = docScrollRef.current; if (el && sc) { const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 80; sc.scrollTo({ top, behavior: "smooth" }); } };

  // ---- comments ----
  const openPanelTab = (tab) => { setPanelOpen(true); setRightTab(tab); };
  const addSelectionComment = (cid, text) => { setComments((cs) => [...cs, { id: cid, quote: text, blockId: null, page, resolved: false, messages: [] }]); openPanelTab("comments"); flash("Comment thread started"); };
  const addBlockComment = (blockId, text) => {
    const cid = uid("cmt");
    const el = document.querySelector(`#bw-${blockId} .block`);
    if (el) { el.innerHTML = `<span class="cmt-anchor" data-cmt="${cid}">${el.innerHTML}</span>`; setBlocks((bs) => bs.map((b) => (b.id === blockId ? { ...b, html: el.innerHTML, text: el.textContent } : b))); }
    setComments((cs) => [...cs, { id: cid, quote: (text || "").slice(0, 80), blockId, page, resolved: false, messages: [] }]);
    openPanelTab("comments");
  };
  const commentApi = {
    reply: (id, text) => setComments((cs) => cs.map((c) => (c.id === id ? { ...c, messages: [...c.messages, { name: "Maya Rao", initials: "MR", color: t.accent, time: "just now", text }] } : c))),
    resolve: (id) => setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c))),
    remove: (id) => { setComments((cs) => cs.filter((c) => c.id !== id)); document.querySelectorAll(`[data-cmt="${id}"]`).forEach((n) => n.replaceWith(...n.childNodes)); },
    scrollToAnchor: (id) => { const el = document.querySelector(`[data-cmt="${id}"]`); if (el) scrollToEl(el.closest(".block-wrap") || el); },
  };
  const pageComments = comments.filter((c) => !c.page || c.page === page);

  // ---- content search ----
  const searchContent = (q) => {
    const ql = q.toLowerCase(); const out = [];
    Object.entries(docsRef.current).forEach(([pid, bs]) => {
      for (const b of bs) {
        if (b.text && b.text.toLowerCase().includes(ql)) {
          const i = b.text.toLowerCase().indexOf(ql);
          const mi = meta[pid] || {};
          out.push({ pageId: pid, title: mi.title || "Untitled", emoji: mi.icon || "📄", snippet: "…" + b.text.slice(Math.max(0, i - 20), i + 40) + "…" });
          break;
        }
      }
    });
    return out.slice(0, 6);
  };

  const flash = (text) => { setToast({ text }); setTimeout(() => setToast(null), 2200); };

  useE(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setTweak("sidebar", t.sidebar === "hidden" ? "full" : "hidden"); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setPanelOpen((v) => !v); }
      else if (e.key === "Escape") { setOpenTask(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [t.sidebar]);

  const paletteActions = [
    { id: "assistant", icon: "sparkle", label: "Open assistant", hint: "⌘J", run: () => openPanelTab("assistant") },
    { id: "outline", icon: "list", label: "Show outline", run: () => openPanelTab("outline") },
    { id: "theme", icon: "sun", label: t.dark ? "Switch to light" : "Switch to dark", run: () => setTweak("dark", !t.dark) },
    { id: "sidebar", icon: "panelLeft", label: "Toggle sidebar", hint: "⌘\\", run: () => setTweak("sidebar", t.sidebar === "hidden" ? "full" : "hidden") },
    { id: "newpage", icon: "plus", label: "New page from template", run: () => setTemplatesOpen({ parent: null }) },
    { id: "trash", icon: "trash", label: "Open trash", run: () => setTrashOpen(true) },
    { id: "reset", icon: "clock", label: "Reset workspace to sample", run: () => { clearWS(); location.reload(); } },
  ];

  const editorApi = { onOpenPage: selectPage, createChildPage, pageMeta: meta, onApplyDbAction: null };

  return (
    <div className="app" data-rail={t.sidebar}>
      <Sidebar tree={tree} meta={meta} activeId={page} pathIds={pathIds} onSelect={selectPage} onOpenPalette={() => setPaletteOpen(true)}
        onNewPage={() => setTemplatesOpen({ parent: null })} onNewSubPage={newSubPage} onRename={renamePage} onDelete={deletePage} onMove={movePage} onTrash={() => setTrashOpen(true)} />

      <div style={{ display: "flex", minWidth: 0 }}>
        <main className="main">
          <div className="topbar">
            {t.sidebar === "hidden" && <button className="tb-btn" title="Show sidebar" onClick={() => setTweak("sidebar", "full")}><Icon name="panelLeft" size={17} /></button>}
            <div className="crumb">
              {pathIds.map((id, i) => (
                <React.Fragment key={id}>
                  {i > 0 && <span className="sep"><Icon name="chevR" size={14} /></span>}
                  <span className="seg" onClick={() => selectPage(id)}>{i === pathIds.length - 1 ? <b>{(meta[id] || {}).icon} {(meta[id] || {}).title}</b> : <>{(meta[id] || {}).icon} {(meta[id] || {}).title}</>}</span>
                </React.Fragment>
              ))}
            </div>
            <div className="presence">{PRESENCE.map(([w, c]) => <span key={w} className="pres-av" style={{ background: c }} title={PEOPLE[w].name}>{PEOPLE[w].initials}</span>)}</div>
            <button className="tb-btn"><Icon name="share" size={16} /> <span className="tb-label">Share</span></button>
            <button className={`tb-btn ${panelOpen && rightTab === "comments" ? "on" : ""}`} onClick={() => openPanelTab("comments")} title="Comments"><Icon name="comment" size={16} /></button>
            <button className={`tb-btn ${panelOpen ? "on" : ""}`} onClick={() => panelOpen ? setPanelOpen(false) : openPanelTab("assistant")} title="Assistant (⌘J)"><Icon name="sparkle" size={16} /> <span className="tb-label">Assistant</span></button>
            <PageMenu onTemplate={() => setTemplatesOpen({ parent: page })} onDelete={() => deletePage(page)} onSub={() => newSubPage(page)} onCover={(r) => setCoverPick({ x: r.left - 200, y: r.bottom + 6 })} />
          </div>

          <div className="doc-scroll scroll" ref={docScrollRef}>
            {pmeta.cover && (
              <div className="doc-cover">
                {pmeta.cover === "image" ? <image-slot id={`cover-${page}`} shape="rect" placeholder="Drop a cover image"></image-slot> : <div className="cover-fill" style={{ background: pmeta.cover }}></div>}
                <div className="cover-tools">
                  <button className="cover-btn" onClick={(e) => setCoverPick({ x: e.currentTarget.getBoundingClientRect().left - 180, y: e.currentTarget.getBoundingClientRect().bottom + 6 })}><Icon name="callout" size={13} /> Change cover</button>
                  <button className="cover-btn" onClick={() => setPMeta({ cover: null })}>Remove</button>
                </div>
              </div>
            )}
            <div className={`doc ${pmeta.cover ? "has-cover" : ""}`}>
              <div className="doc-head-inner">
                <div className="doc-emoji" onClick={(e) => setEmojiPick({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 6 })}>{pmeta.icon}</div>
                <div className="header-add">
                  {!pmeta.cover && <button onClick={() => setPMeta({ cover: "var(--accent)" })}><Icon name="callout" size={15} /> Add cover</button>}
                  <button onClick={(e) => setEmojiPick({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 6 })}><Icon name="sparkle" size={15} /> Change icon</button>
                </div>
                <div className="doc-title" contentEditable suppressContentEditableWarning spellCheck={false}
                  onInput={(e) => setPMeta({ title: e.currentTarget.textContent })} dangerouslySetInnerHTML={{ __html: pmeta.title }} key={page} />
                <div className="doc-meta"><span>Edited <b>just now</b></span><span><b>4</b> contributors</span><span>Saved locally</span></div>
                <Editor blocks={blocks} setBlocks={setBlocks} onOpenTask={setOpenTask} focusReq={focusReq} clearFocusReq={() => setFocusReq(null)}
                  onProposalDecision={decideProposal} onComment={addBlockComment} onToast={flash} api={editorApi} />
              </div>
            </div>
          </div>
        </main>

        {panelOpen && (
          <RightPanel tab={rightTab} setTab={setRightTab} onClose={() => setPanelOpen(false)}
            agent={{ messages, onSend: runAgent, thinking, onScrollToProposal: scrollToProposal, onApplyDb: applyDbAction, onDismissDb: dismissDbAction }}
            blocks={blocks} comments={pageComments} commentApi={commentApi} pageInfo={pmeta} onScrollToBlock={scrollToBlock} />
        )}
      </div>

      <SelectionToolbar onComment={addSelectionComment} onAsk={askAbout} />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onSelectPage={selectPage} actions={paletteActions} searchContent={searchContent} />}
      {openTask && <TaskDrawer task={openTask} onClose={() => setOpenTask(null)} />}
      {emojiPick && <EmojiPicker x={emojiPick.x} y={emojiPick.y} onPick={(e) => { setPMeta({ icon: e }); setEmojiPick(null); }} onRemove={() => { setPMeta({ icon: "📄" }); setEmojiPick(null); }} onClose={() => setEmojiPick(null)} />}
      {coverPick && <CoverPicker x={coverPick.x} y={coverPick.y} onPick={(c) => { setPMeta({ cover: c }); setCoverPick(null); }} onImage={() => { setPMeta({ cover: "image" }); setCoverPick(null); }} onRemove={() => { setPMeta({ cover: null }); setCoverPick(null); }} onClose={() => setCoverPick(null)} />}
      {templatesOpen && <TemplatesModal onPick={createFromTemplate} onClose={() => setTemplatesOpen(null)} />}
      {trashOpen && <TrashModal trash={trash} onRestore={restorePage} onClose={() => setTrashOpen(false)} />}
      {toast && <div className="toast"><Icon name="check" size={15} style={{ color: "var(--accent)" }} />{toast.text}</div>}

      <TweaksUI t={t} setTweak={setTweak} />
    </div>
  );
}

function PageMenu({ onTemplate, onDelete, onCover, onSub }) {
  const [open, setOpen] = useS(false);
  const ref = useR(null);
  return (
    <>
      <button className="tb-btn" ref={ref} onClick={() => setOpen((v) => !v)}><Icon name="dots" size={16} /></button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 63 }} onMouseDown={() => setOpen(false)} />
          <div className="menu" style={{ right: 12, top: 46, zIndex: 64, minWidth: 210 }}>
            <div className="menu-mini" onClick={() => { onSub(); setOpen(false); }}><Icon name="plus" size={16} /> Add sub-page</div>
            <div className="menu-mini" onClick={() => { onCover(ref.current.getBoundingClientRect()); setOpen(false); }}><Icon name="callout" size={16} /> Change cover</div>
            <div className="menu-mini" onClick={() => { onTemplate(); setOpen(false); }}><Icon name="doc" size={16} /> New from template</div>
            <div className="menu-mini" onClick={() => setOpen(false)}><Icon name="share" size={16} /> Copy link</div>
            <div className="menu-divider"></div>
            <div className="menu-mini danger" onClick={() => { onDelete(); setOpen(false); }}><Icon name="trash" size={16} /> Move to trash</div>
          </div>
        </>
      )}
    </>
  );
}

function TaskDrawer({ task, onClose }) {
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head"><button className="tb-btn" onClick={onClose}><Icon name="x" size={17} /></button><span style={{ flex: 1 }}></span><button className="tb-btn"><Icon name="share" size={16} /></button><button className="tb-btn"><Icon name="dots" size={16} /></button></div>
        <div className="drawer-body scroll">
          <h1 className="drawer-title">{task.title}</h1>
          <div className="field-grid">
            <div className="fk"><Icon name="board" size={15} /> Status</div><div className="fv"><StatusChip s={task.status} /></div>
            <div className="fk"><Icon name="flag" size={15} /> Priority</div><div className="fv"><PrioChip p={task.prio} /></div>
            <div className="fk"><Icon name="home" size={15} /> Owner</div><div className="fv"><span className="person"><Avatar who={task.who} />{PEOPLE[task.who].name}</span></div>
            <div className="fk"><Icon name="calendar" size={15} /> Due</div><div className="fv num">{task.due}</div>
            <div className="fk"><Icon name="clock" size={15} /> Estimate</div><div className="fv num">{task.est}</div>
          </div>
          <hr className="b-divider" style={{ margin: "18px 0" }} />
          <p style={{ color: "var(--tx-2)", fontSize: 15 }}>Add a description, sub-tasks, and comments here. This drawer mirrors the page editor — the same blocks, slash menu, and assistant work inside a task.</p>
          <div className="b-callout" style={{ marginTop: 14 }}><span className="emoji">💬</span><div className="block" style={{ padding: 0 }}>Linked from <b>Team Home → Tasks</b>. Changes sync back to the board.</div></div>
        </div>
      </div>
    </div>
  );
}

function TemplatesModal({ onPick, onClose }) {
  return (
    <div className="scrim" onMouseDown={onClose} style={{ alignItems: "flex-start" }}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>New page</h3></div>
        <div className="modal-body"><div className="tpl-grid">
          {TEMPLATES.map((tp) => (
            <div key={tp.id} className="tpl-card" onClick={() => onPick(tp)}><div className="tpl-emoji">{tp.emoji}</div><div className="tpl-name">{tp.name}</div><div className="tpl-desc">{tp.desc}</div></div>
          ))}
        </div></div>
      </div>
    </div>
  );
}

function TrashModal({ trash, onRestore, onClose }) {
  return (
    <div className="scrim" onMouseDown={onClose} style={{ alignItems: "flex-start" }}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Trash</h3></div>
        <div className="modal-body">
          {trash.length === 0 ? <div className="cmts-empty" style={{ padding: "20px 0" }}>Trash is empty.</div> : (
            <div>{trash.map((p) => (
              <div key={p.id} className="lst-row" style={{ borderRadius: 6 }}><span className="tree-emoji">{p.icon}</span><span className="c-name" style={{ flex: 1 }}>{p.title}</span><button className="cover-btn" onClick={() => onRestore(p)}>Restore</button></div>
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TweaksUI({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Appearance" />
      <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
      <TweakColor label="Accent" value={t.accent} options={ACCENTS} onChange={(v) => setTweak("accent", v)} />
      <TweakSection label="Layout" />
      <TweakRadio label="Sidebar" value={t.sidebar} options={["full", "icons", "hidden"]} onChange={(v) => setTweak("sidebar", v)} />
      <TweakSelect label="Content width" value={t.width} options={["narrow", "comfortable", "wide", "full"]} onChange={(v) => setTweak("width", v)} />
      <TweakRadio label="Density" value={t.density} options={["comfortable", "compact"]} onChange={(v) => setTweak("density", v)} />
      <TweakSection label="Typography" />
      <TweakRadio label="Body font" value={t.bodyfont} options={["sans", "serif", "mono"]} onChange={(v) => setTweak("bodyfont", v)} />
    </TweaksPanel>
  );
}

function stripHtml(h) { const d = document.createElement("div"); d.innerHTML = h || ""; return d.textContent || ""; }

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
