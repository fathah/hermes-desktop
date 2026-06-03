// store.jsx — workspace persistence + page-tree helpers
const WS_KEY = 'sps-agent-ws-v3';

function loadWS() { try { const r = localStorage.getItem(WS_KEY); if (r) return JSON.parse(r); } catch (e) {} return null; }
function saveWS(data) { try { localStorage.setItem(WS_KEY, JSON.stringify(data)); } catch (e) {} }
function clearWS() { try { localStorage.removeItem(WS_KEY); } catch (e) {} }

// ---- build initial workspace from the static seed ----
function treeFromSeed(nodes) { return nodes.map((n) => ({ id: n.id, children: n.children ? treeFromSeed(n.children) : [] })); }
function metaFromSeed(nodes, acc) { nodes.forEach((n) => { acc[n.id] = { icon: n.emoji, title: n.label, cover: null }; if (n.children) metaFromSeed(n.children, acc); }); return acc; }

function starterDoc(title) {
  return [blk('callout', `This is the ${title} page. Type "/" for blocks, or ask the assistant to draft it for you.`, { emoji: '📄' }), blk('h2', 'Overview'), blk('p', ''), blk('h2', 'Details'), blk('p', '')];
}

function buildInitialWorkspace() {
  const tree = treeFromSeed(TREE);
  const meta = metaFromSeed(TREE, {});
  meta.home = { icon: '🏠', title: 'Team Home', cover: 'var(--accent)' };
  const docs = { home: HOME_BLOCKS };
  Object.keys(meta).forEach((id) => { if (id !== 'home' && !docs[id]) docs[id] = starterDoc(meta[id].title); });
  const comments = [
    { id: 'seed1', quote: 'do we backfill historical analytics', blockId: null, page: 'home', resolved: false,
      messages: [{ name: 'Theo K', initials: 'TK', color: '#1F6B3A', time: '1h ago', text: "I'd start clean from the migration date — backfill is a week of work for little payoff." }] },
  ];
  return { tree, meta, docs, comments, trash: [], page: 'home' };
}

// ---- pure tree ops (immutable) ----
function treeFind(tree, id) { for (const n of tree) { if (n.id === id) return n; const f = treeFind(n.children, id); if (f) return f; } return null; }
function treePathIds(tree, id, trail = []) { for (const n of tree) { const t = [...trail, n.id]; if (n.id === id) return t; const r = treePathIds(n.children, id, t); if (r) return r; } return null; }
function treeWalkIds(node) { let ids = [node.id]; (node.children || []).forEach((c) => { ids = ids.concat(treeWalkIds(c)); }); return ids; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function treeRemove(tree, id) {
  let removed = null;
  const rec = (arr) => arr.filter((n) => { if (n.id === id) { removed = n; return false; } n.children = rec(n.children); return true; });
  const nt = rec(clone(tree));
  return [nt, removed];
}
function treeInsert(tree, targetId, node, where) {
  const t = clone(tree);
  if (where === 'root' || !targetId) { t.push(node); return t; }
  const rec = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === targetId) {
        if (where === 'inside') arr[i].children.push(node);
        else if (where === 'before') arr.splice(i, 0, node);
        else arr.splice(i + 1, 0, node);
        return true;
      }
      if (rec(arr[i].children)) return true;
    }
    return false;
  };
  if (!rec(t)) t.push(node);
  return t;
}
function treeMove(tree, dragId, targetId, where) {
  if (dragId === targetId) return tree;
  const dragNode = treeFind(tree, dragId); if (!dragNode) return tree;
  if (treeWalkIds(dragNode).includes(targetId)) return tree; // no drop into own subtree
  const [t1] = treeRemove(tree, dragId);
  return treeInsert(t1, targetId, clone(dragNode), where);
}

Object.assign(window, { loadWS, saveWS, clearWS, buildInitialWorkspace, treeFind, treePathIds, treeWalkIds, treeRemove, treeInsert, treeMove });
