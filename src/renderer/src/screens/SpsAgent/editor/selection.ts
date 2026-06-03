// selection.ts — caret/selection + @-mention DOM helpers. Ported from editor.jsx
// (caretRect, mentionQuery, insertMentionChip, placeCaretEnd).
export interface MentionItem {
  kind: "person" | "page" | "date";
  id: string;
  label: string;
  color?: string;
  initials?: string;
  emoji?: string;
}

export function caretRect(): DOMRect | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange();
  r.collapse(true);
  let rect = r.getBoundingClientRect();
  const start = r.startContainer as Element & {
    getBoundingClientRect?: () => DOMRect;
  };
  if (
    (!rect || (rect.left === 0 && rect.top === 0)) &&
    start.getBoundingClientRect
  ) {
    rect = start.getBoundingClientRect();
  }
  return rect;
}

/** Returns the current "@query" being typed, or null. */
export function mentionQuery(): string | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.isCollapsed) return null;
  const node = s.anchorNode;
  if (!node || node.nodeType !== 3) return null;
  const before = (node.textContent || "").slice(0, s.anchorOffset);
  const m = before.match(/(?:^|\s)@(\w{0,20})$/);
  return m ? m[1] : null;
}

export function insertMentionChip(
  _el: HTMLElement,
  item: MentionItem,
  queryLen: number,
): void {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return;
  const range = s.getRangeAt(0);
  // delete '@' + query
  range.setStart(
    range.startContainer,
    Math.max(0, range.startOffset - queryLen - 1),
  );
  range.deleteContents();
  const span = document.createElement("span");
  span.contentEditable = "false";
  if (item.kind === "person") {
    span.className = "mention";
    span.innerHTML = `<span class="pico" style="background:${item.color}">${item.initials?.[0] ?? ""}</span>${item.label}`;
  } else if (item.kind === "page") {
    span.className = "mention page";
    span.textContent = `${item.emoji} ${item.label}`;
  } else {
    span.className = "mention date";
    span.textContent = "📅 " + item.label.replace(/\s*\(.*\)/, "");
  }
  range.insertNode(span);
  const space = document.createTextNode(" ");
  span.after(space);
  const nr = document.createRange();
  nr.setStartAfter(space);
  nr.collapse(true);
  s.removeAllRanges();
  s.addRange(nr);
}

export function placeCaretEnd(el: HTMLElement): void {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  if (!s) return;
  s.removeAllRanges();
  s.addRange(r);
}
