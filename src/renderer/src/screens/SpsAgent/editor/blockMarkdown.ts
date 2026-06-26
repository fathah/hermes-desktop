// blockMarkdown.ts — Part 2 / S2: the block-tree ↔ markdown serializer.
//
// Markdown-on-disk is the substrate's source of truth, so the SPS block editor
// must round-trip its blocks through markdown losslessly. Two tiers:
//
//   Tier 1 (clean, Obsidian-compatible markdown): p, h1–h3, li, numli, todo,
//     quote, code, divider, image — when they carry no colour/bg and only the
//     inline marks markdown can express (bold/italic/strike/code/link/highlight).
//
//   Tier 2 (lossless fallback): callout, toggle, bookmark, page, database, and
//     ANY block carrying colour/bg or inline html markdown can't express
//     (mention/comment chips). These serialise to a single metadata comment
//     `<!-- sps:… -->` that reconstructs the block exactly.
//
// `id` is a runtime handle, not content — it is NOT written to markdown and is
// regenerated on parse. Round-trip equality therefore ignores `id`.
//
// DOM is used for inline html parsing (available in the renderer and in jsdom
// tests). This module is renderer-side; the main process reads markdown directly.
import { uid } from "../lib/ids";
import { stripHtml } from "../lib/html";
import { sanitizeHtml } from "../lib/sanitize";
import { assetRel, assetNameFromRel } from "../lib/assets";
import {
  parseSpsWikilinks,
  parseSpsWikilinkRaw,
  spsWikilinkToMarkdown,
} from "../../../../../shared/sps-wikilinks";
import type { Block, BlockType } from "../types";

// ── metadata comment (tier-2, unicode-safe) ───────────────────────────────────

const META_RE = /^<!--\s*sps:([A-Za-z0-9+/=]+)\s*-->$/;

// `keepId` is set for anchored blocks (F2): a block an open comment references
// must keep a stable id across the round-trip. Default stays clean (id dropped).
function encodeMeta(block: Block, keepId = false): string {
  const json = JSON.stringify(keepId ? block : stripId(block));
  return `<!-- sps:${btoa(unescape(encodeURIComponent(json)))} -->`;
}

function decodeMeta(b64: string): Block | null {
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json) as Partial<Block>;
    // Reuse a persisted (anchored) id; otherwise the id is a fresh runtime handle.
    return { ...parsed, id: parsed.id || uid() } as Block;
  } catch {
    return null;
  }
}

function stripId(block: Block): Omit<Block, "id"> {
  const clone: Partial<Block> = { ...block };
  delete clone.id;
  return clone as Omit<Block, "id">;
}

// ── inline: html ↔ markdown ────────────────────────────────────────────────────

const CLEAN_INLINE_TAGS = new Set([
  "STRONG",
  "B",
  "EM",
  "I",
  "S",
  "STRIKE",
  "DEL",
  "MARK",
  "CODE",
  "A",
  "U",
  "BR",
]);

/** Escape characters that would otherwise be read as markdown inline syntax. */
function escapeInline(s: string): string {
  return s.replace(/([\\*_~=`[\]<>])/g, "\\$1");
}

function escapeInlinePreservingWikilinks(s: string): string {
  const links = parseSpsWikilinks(s);
  if (links.length === 0) return escapeInline(s);
  let out = "";
  let pos = 0;
  for (const link of links) {
    out += escapeInline(s.slice(pos, link.start));
    out += link.raw;
    pos = link.end;
  }
  return out + escapeInline(s.slice(pos));
}

interface InlineMd {
  md: string;
  clean: boolean;
}

/** Convert a block's inline html to markdown. `clean` is false when the html
 *  uses formatting markdown can't express (→ caller uses the tier-2 fallback). */
export function inlineHtmlToMd(html: string): InlineMd {
  const host = document.createElement("div");
  // Sanitize before parsing: setting innerHTML on a detached node can still
  // trigger `<img onerror>`-style payloads from a hostile vault file.
  host.innerHTML = sanitizeHtml(html);
  const state = { clean: true };
  const md = walkInline(host, state);
  return { md, clean: state.clean };
}

function walkInline(node: Node, state: { clean: boolean }): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += escapeInline(child.nodeValue || "");
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as HTMLElement;
    const wikiLink = el.getAttribute("data-sps-wikilink");
    if (wikiLink && parseSpsWikilinkRaw(wikiLink)) {
      out += wikiLink;
      return;
    }
    const tag = el.tagName;
    if (!CLEAN_INLINE_TAGS.has(tag)) {
      // span/font/mention/comment chips — markdown can't carry these.
      state.clean = false;
      out += escapeInline(el.textContent || "");
      return;
    }
    if (tag === "BR") {
      out += "<br>";
      return;
    }
    if (tag === "CODE") {
      out += "`" + (el.textContent || "") + "`";
      return;
    }
    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      out += `[${walkInline(el, state)}](${href})`;
      return;
    }
    if (tag === "U") {
      out += `<u>${walkInline(el, state)}</u>`;
      return;
    }
    const inner = walkInline(el, state);
    if (tag === "STRONG" || tag === "B") out += `**${inner}**`;
    else if (tag === "EM" || tag === "I") out += `*${inner}*`;
    else if (tag === "S" || tag === "STRIKE" || tag === "DEL")
      out += `~~${inner}~~`;
    else if (tag === "MARK") out += `==${inner}==`;
  });
  return out;
}

// Private-use-area sentinels: never appear in real content, not regex-control
// chars. One pair protects backslash-escaped literals, one protects code spans.
const ESC_OPEN = String.fromCharCode(0xe000);
const ESC_CLOSE = String.fromCharCode(0xe001);
const CODE_OPEN = String.fromCharCode(0xe002);
const CODE_CLOSE = String.fromCharCode(0xe003);
const WIKI_OPEN = String.fromCharCode(0xe004);
const WIKI_CLOSE = String.fromCharCode(0xe005);

/** Parse markdown inline into canonical html + plaintext. html is omitted when
 *  the content has no inline formatting (so it matches plain-text blocks). */
export function parseInline(md: string): { text: string; html?: string } {
  // 1. Protect backslash-escaped chars so they don't trigger mark regexes.
  const escapes: string[] = [];
  let s = md.replace(/\\([\\*_~=`[\]<>])/g, (_m, ch) => {
    escapes.push(ch);
    return ESC_OPEN + (escapes.length - 1) + ESC_CLOSE;
  });

  // 2. Code spans next (their contents are literal — no nested marks).
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return CODE_OPEN + (codes.length - 1) + CODE_CLOSE;
  });

  // 3. Protect Obsidian wikilinks so markdown-link parsing doesn't consume
  //    their alias syntax.
  const wikis: string[] = [];
  s = s.replace(/!?\[\[[^\]\r\n]+\]\]/g, (raw) => {
    if (!parseSpsWikilinkRaw(raw)) return raw;
    wikis.push(raw);
    return WIKI_OPEN + (wikis.length - 1) + WIKI_CLOSE;
  });

  // 4. Links, then the symmetric marks (longest delimiters first).
  s = s.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, txt, href) => `<a href="${href}">${txt}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // 5. Restore wikilinks as safe editor html with the exact raw markdown stored
  //    in data-sps-wikilink, so export can round-trip aliases/fragments.
  s = s.replace(new RegExp(WIKI_OPEN + "(\\d+)" + WIKI_CLOSE, "g"), (_m, i) =>
    wikiLinkHtml(wikis[+i]),
  );

  // 6. Restore code spans as <code>.
  s = s.replace(
    new RegExp(CODE_OPEN + "(\\d+)" + CODE_CLOSE, "g"),
    (_m, i) => `<code>${escapeHtmlText(codes[+i])}</code>`,
  );

  // 7. Restore escaped literals (without the backslash), html-escaping the
  //    html-significant ones so they survive as literal text, not markup.
  s = s.replace(new RegExp(ESC_OPEN + "(\\d+)" + ESC_CLOSE, "g"), (_m, i) =>
    htmlEscapeChar(escapes[+i]),
  );

  const hasFormatting = /<(strong|em|s|code|a|mark|u|br|span)\b/.test(s);
  if (!hasFormatting) return { text: decodeEntities(s) };
  // Defence in depth: a hostile vault file could embed raw html in the body.
  const safe = sanitizeHtml(s);
  return { text: stripHtml(safe), html: safe };
}

function htmlEscapeChar(ch: string): string {
  if (ch === "<") return "&lt;";
  if (ch === ">") return "&gt;";
  if (ch === "&") return "&amp;";
  return ch;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, "&quot;");
}

function wikiLinkHtml(raw: string): string {
  const link = parseSpsWikilinkRaw(raw);
  if (!link) return escapeHtmlText(raw);
  const label = link.display || link.target;
  const attrs =
    `data-sps-wikilink="${escapeAttr(link.raw)}" ` +
    `data-sps-target="${escapeAttr(link.target)}"` +
    (link.heading ? ` data-sps-heading="${escapeAttr(link.heading)}"` : "") +
    (link.blockId ? ` data-sps-block-id="${escapeAttr(link.blockId)}"` : "") +
    (link.relation ? ` data-sps-relation="${escapeAttr(link.relation)}"` : "");
  if (link.kind === "embed") {
    return `<span class="wiki-embed-inline" ${attrs}>${escapeHtmlText(label)}</span>`;
  }
  return `<a href="sps://page/${encodeURIComponent(link.target)}" class="wiki-link" ${attrs}>${escapeHtmlText(label)}</a>`;
}

/** Decode HTML entities to text without ever executing markup (textarea). */
function decodeEntities(s: string): string {
  const ta = document.createElement("textarea");
  ta.innerHTML = s;
  return ta.value;
}

// ── block ↔ markdown ───────────────────────────────────────────────────────────

const HEADING_PREFIX: Record<string, string> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
};
const LIST_TYPES = new Set<BlockType>(["li", "numli", "todo"]);

// F2 — block-id persistence for comment anchors. A block an open comment is
// anchored to must keep a stable id across the markdown round-trip. Inline,
// single-line tier-1 blocks carry an Obsidian-style trailing ` ^<id>`; any other
// anchored block (divider/code/image/page-link, or a tier-2 block) keeps its id
// inside the `<!-- sps:… -->` meta instead. Non-anchored blocks are untouched —
// output stays clean for the 99% case.
const INLINE_ANCHOR_TYPES = new Set<BlockType>([
  "p",
  "h1",
  "h2",
  "h3",
  "li",
  "numli",
  "todo",
  "quote",
]);
// Matches a trailing ` ^<id>` marker on a content line (Obsidian block ref).
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9_-]+)\s*$/;

// A page-link block serializes to a bare [[pageId]] so the note-index graph
// resolves it (a note's basename == its pageId). Round-trips losslessly.
function validWikilinkPart(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && !/[\]\r\n]/.test(value);
}

// Obsidian callouts (`> [!type] title`) ↔ our single-line callout block (an
// emoji + text). EMOJI_TO_CALLOUT is a bijection over a curated set: each emoji
// has one canonical Obsidian type, so mapped callouts round-trip exactly and
// render natively in Obsidian. A callout whose emoji is NOT in this table stays
// on tier-2 (the `<!-- sps:… -->` fallback) so its exact emoji is preserved.
// On parse, Obsidian alias types (summary→abstract, …) and unknown types
// resolve through CALLOUT_TO_EMOJI / DEFAULT_CALLOUT_EMOJI — a documented
// normalization that keeps the common Obsidian set native (lossy only on the
// exotic-type *name*, never on content).
const EMOJI_TO_CALLOUT = new Map<string, string>([
  ["📌", "note"],
  ["💡", "tip"],
  ["ℹ️", "info"],
  ["📋", "abstract"],
  ["✅", "success"],
  ["❓", "question"],
  ["⚠️", "warning"],
  ["❌", "failure"],
  ["🔥", "danger"],
  ["❗", "important"],
  ["🐛", "bug"],
  ["💬", "quote"],
]);
// Canonical inverse, then Obsidian alias types that map to the same emoji.
const CALLOUT_TO_EMOJI = new Map<string, string>();
for (const [emoji, type] of EMOJI_TO_CALLOUT) {
  CALLOUT_TO_EMOJI.set(type, emoji);
}
const CALLOUT_ALIASES: Array<[string, string]> = [
  ["summary", "📋"],
  ["tldr", "📋"],
  ["hint", "💡"],
  ["check", "✅"],
  ["done", "✅"],
  ["help", "❓"],
  ["faq", "❓"],
  ["caution", "⚠️"],
  ["attention", "⚠️"],
  ["fail", "❌"],
  ["missing", "❌"],
  ["error", "🔥"],
  ["cite", "💬"],
];
for (const [alias, emoji] of CALLOUT_ALIASES) {
  CALLOUT_TO_EMOJI.set(alias, emoji);
}
const DEFAULT_CALLOUT_EMOJI = "📌";
// Matches an Obsidian callout header line: `> [!type]` + optional fold marker
// + optional inline title. Must be tested BEFORE the plain-quote matcher.
const CALLOUT_RE = /^>\s*\[!([A-Za-z][\w-]*)\][+-]?\s?(.*)$/;

/** A block is tier-1 (clean markdown) only if markdown can express it fully. */
function isCleanBlock(block: Block): boolean {
  if (block.color || block.bg) return false;
  if (block.indent && !LIST_TYPES.has(block.type)) return false;
  // A sub-page link is clean only when it is a plain pageId reference.
  if (block.type === "page" || block.type === "embed") {
    return (
      validWikilinkPart(block.pageId) &&
      (block.linkDisplay == null || validWikilinkPart(block.linkDisplay)) &&
      (block.linkHeading == null || validWikilinkPart(block.linkHeading)) &&
      (block.linkBlockId == null || validWikilinkPart(block.linkBlockId))
    );
  }
  // An excalidraw block is clean once it has a preview-svg path; an undrawn one
  // falls to the tier-2 stub so its block type survives the round-trip.
  if (block.type === "excalidraw") return !!block.src;
  // A callout is native (`> [!type]`) only when its emoji maps to a known
  // Obsidian type; otherwise it stays tier-2 so the exact emoji is preserved.
  if (block.type === "callout") {
    if (!block.emoji || !EMOJI_TO_CALLOUT.has(block.emoji)) return false;
    if (block.html) return inlineHtmlToMd(block.html).clean;
    return true;
  }
  const cleanTypes: BlockType[] = [
    "p",
    "h1",
    "h2",
    "h3",
    "li",
    "numli",
    "todo",
    "quote",
    "code",
    "divider",
    "image",
    // mermaid -> ```mermaid fence (clean, Obsidian/GitHub render it natively).
    "mermaid",
  ];
  if (!cleanTypes.includes(block.type)) return false;
  // code/mermaid carry verbatim source in `text`; their `html` (if any) is not
  // inline-markdown and must not gate cleanliness.
  if (block.html && block.type !== "code" && block.type !== "mermaid") {
    return inlineHtmlToMd(block.html).clean;
  }
  return true;
}

/** The inline markdown for a block's content (from clean html, else from text). */
function renderInline(block: Block): string {
  if (block.html) {
    const { md, clean } = inlineHtmlToMd(block.html);
    if (clean) return md;
  }
  return escapeInlinePreservingWikilinks(block.text || "");
}

function blockWikilink(block: Block, kind: "link" | "embed" = "link"): string {
  return spsWikilinkToMarkdown({
    target: block.pageId || "",
    display: block.linkDisplay,
    heading: block.linkHeading,
    blockId: block.linkBlockId,
    kind,
  });
}

/** The clean tier-1 markdown line for a block (no id marker). */
function cleanBlockLine(block: Block): string {
  const indent = "  ".repeat(block.indent || 0);
  switch (block.type) {
    case "divider":
      return "---";
    case "code":
      return "```\n" + (block.text || "") + "\n```";
    case "mermaid":
      return "```mermaid\n" + (block.text || "") + "\n```";
    case "excalidraw":
      // Renders as a clean image; the `.excalidraw.svg` suffix on the path is
      // what tells the parser to reconstruct an excalidraw block.
      return `![${block.caption || ""}](${block.src || ""})`;
    case "image": {
      // Prefer the portable vault-asset link; fall back to a data/http src.
      const url = block.assetPath ? assetRel(block.assetPath) : block.src || "";
      return `![${block.caption || ""}](${url})`;
    }
    case "h1":
    case "h2":
    case "h3":
      return HEADING_PREFIX[block.type] + renderInline(block);
    case "quote":
      return "> " + renderInline(block);
    case "callout": {
      // isCleanBlock guarantees the emoji is mapped when we reach here.
      const type = EMOJI_TO_CALLOUT.get(block.emoji as string) ?? "note";
      const inline = renderInline(block);
      return inline ? `> [!${type}] ${inline}` : `> [!${type}]`;
    }
    case "li":
      return indent + "- " + renderInline(block);
    case "numli":
      return indent + "1. " + renderInline(block);
    case "todo":
      return indent + (block.done ? "- [x] " : "- [ ] ") + renderInline(block);
    case "page":
      return blockWikilink(block);
    case "embed":
      return blockWikilink(block, "embed");
    default:
      return renderInline(block); // paragraph
  }
}

function blockToMarkdown(block: Block, anchored = false): string {
  if (!isCleanBlock(block)) return encodeMeta(block, anchored);
  // An anchored block whose type can't carry a trailing marker (divider, code,
  // image, page-link) keeps its id via the tier-2 meta comment instead.
  if (anchored && !INLINE_ANCHOR_TYPES.has(block.type)) {
    return encodeMeta(block, true);
  }
  const line = cleanBlockLine(block);
  return anchored ? `${line} ^${block.id}` : line;
}

/** Serialize a block list to a markdown body (blank line between blocks).
 *  Block ids in `anchoredIds` are persisted (so comment anchors survive). */
export function blocksToMarkdown(
  blocks: Block[],
  anchoredIds?: Set<string>,
): string {
  return blocks
    .map((b) =>
      blockToMarkdown(b, (anchoredIds?.has(b.id) ?? false) || !!b.anchor),
    )
    .join("\n\n");
}

// ── parsing ─────────────────────────────────────────────────────────────────

function leadingIndent(line: string): { indent: number; rest: string } {
  const m = /^( +)/.exec(line);
  if (!m) return { indent: 0, rest: line };
  return { indent: Math.floor(m[1].length / 2), rest: line.slice(m[1].length) };
}

function mk(
  type: BlockType,
  mdInline: string,
  extra: Partial<Block> = {},
): Block {
  const { text, html } = parseInline(mdInline);
  const block: Block = { id: uid(), type, text, ...extra };
  if (html) block.html = html;
  return block;
}

/** Parse a markdown body back into blocks. Inverse of blocksToMarkdown. */
export function markdownToBlocks(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) {
      i++;
      continue;
    }

    const meta = META_RE.exec(raw.trim());
    if (meta) {
      const block = decodeMeta(meta[1]);
      if (block) blocks.push(block);
      i++;
      continue;
    }

    if (raw.trimStart().startsWith("```")) {
      // The info-string after the opening fence selects the block type:
      // ```mermaid → a mermaid diagram, anything else → a plain code block.
      const lang = raw.trim().slice(3).trim().toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      const type: BlockType = lang === "mermaid" ? "mermaid" : "code";
      blocks.push({ id: uid(), type, text: body.join("\n") });
      continue;
    }

    if (raw.trim() === "---") {
      blocks.push({ id: uid(), type: "divider", text: "" });
      i++;
      continue;
    }

    const wikilink = parseSpsWikilinkRaw(raw.trim());
    if (wikilink) {
      blocks.push({
        id: uid(),
        type: wikilink.kind === "embed" ? "embed" : "page",
        text: "",
        pageId: wikilink.target,
        ...(wikilink.display ? { linkDisplay: wikilink.display } : {}),
        ...(wikilink.heading ? { linkHeading: wikilink.heading } : {}),
        ...(wikilink.blockId ? { linkBlockId: wikilink.blockId } : {}),
      });
      i++;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(raw.trim());
    if (image) {
      const src = image[2];
      if (src.endsWith(".excalidraw.svg")) {
        // A `.excalidraw.svg` preview path round-trips back to a drawing block.
        blocks.push({
          id: uid(),
          type: "excalidraw",
          text: "",
          caption: image[1],
          src,
        });
      } else {
        // A `../_assets/<name>` link is a vault asset (→ assetPath); anything
        // else (data:/http) stays a plain src.
        const assetName = assetNameFromRel(src);
        blocks.push({
          id: uid(),
          type: "image",
          text: "",
          caption: image[1],
          ...(assetName ? { assetPath: assetName } : { src }),
        });
      }
      i++;
      continue;
    }

    // A trailing ` ^<id>` on a content line is a persisted, comment-anchored
    // block id (F2). Strip it from the text and reuse it as the block's id.
    const anchorMatch = BLOCK_ID_RE.exec(raw);
    const body = anchorMatch ? raw.slice(0, anchorMatch.index) : raw;
    const idExtra: Partial<Block> = anchorMatch
      ? { id: anchorMatch[1], anchor: true }
      : {};

    const heading = /^(#{1,3})\s+(.*)$/.exec(body);
    if (heading) {
      const type = (["h1", "h2", "h3"] as const)[heading[1].length - 1];
      blocks.push(mk(type, heading[2], idExtra));
      i++;
      continue;
    }

    const { indent, rest } = leadingIndent(body);
    const todo = /^- \[([ xX])\]\s+(.*)$/.exec(rest);
    if (todo) {
      const done = todo[1].toLowerCase() === "x";
      blocks.push(
        mk("todo", todo[2], {
          ...(indent ? { indent } : {}),
          done,
          ...idExtra,
        }),
      );
      i++;
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(rest);
    if (bullet) {
      blocks.push(
        mk("li", bullet[1], { ...(indent ? { indent } : {}), ...idExtra }),
      );
      i++;
      continue;
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(rest);
    if (numbered) {
      blocks.push(
        mk("numli", numbered[1], { ...(indent ? { indent } : {}), ...idExtra }),
      );
      i++;
      continue;
    }
    // Obsidian callout — must precede the plain-quote matcher (both start `>`).
    const callout = CALLOUT_RE.exec(body);
    if (callout) {
      const type = callout[1].toLowerCase();
      const emoji = CALLOUT_TO_EMOJI.get(type) ?? DEFAULT_CALLOUT_EMOJI;
      blocks.push(mk("callout", callout[2], { emoji, ...idExtra }));
      i++;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(body);
    if (quote) {
      blocks.push(mk("quote", quote[1], idExtra));
      i++;
      continue;
    }

    blocks.push(mk("p", body, idExtra));
    i++;
  }

  return blocks;
}
