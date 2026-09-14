/**
 * Parsing for agent-delivered media (issue #299).
 *
 * Three signals are recognised in agent responses:
 *
 *  1. Explicit `MEDIA:<path-or-url>` tokens — hermes-agent's delivery
 *     protocol. Trusted: rendered eagerly.
 *  2. An inline absolute file path with a known extension, anywhere in the
 *     text. Treated as a *candidate* — the renderer verifies the file
 *     exists before showing it, so a path merely named in prose only turns
 *     into media when it really points at a reachable file.
 *  3. A whole line that is exactly an absolute path — also covers paths
 *     containing spaces, which the inline (no-whitespace) form cannot.
 *
 * Care taken against false positives: the inline matcher is anchored so it
 * cannot start mid-token or inside a URL, and matches inside ``` fenced or
 * `inline` code are skipped.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// Extensions recognised in a bare (untagged) path.
const BARE_PATH_EXT =
  "png|jpe?g|gif|webp|svg|bmp|avif|pdf|txt|md|csv|json|docx?|xlsx?|pptx?|" +
  "odt|rtf|zip|tar|gz|mp4|mov|webm|mkv|avi|mp3|wav|ogg|opus|m4a|flac";

// MEDIA: + optional whitespace + (quoted) | (bare non-whitespace run).
const MEDIA_RE = /MEDIA:[ \t]*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))/g;

// Markdown image syntax with a raw local/remote filesystem or direct image
// destination.
// React-markdown normalizes Windows backslashes before our image component sees
// them, so intercept these here and let MediaImage resolve them.
const MARKDOWN_IMAGE_PATH_RE =
  /!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\n]+?)(?:\s+["'][^)\n]*["'])?\s*\)/g;

// Inline bare absolute path (no whitespace in the path). The negative
// lookbehind blocks matches that start mid-token or inside a URL (`://`);
// the lookahead requires the extension to be followed by whitespace,
// markdown table punctuation, sentence punctuation, or end-of-string.
const INLINE_PATH_RE = new RegExp(
  String.raw`(?<![\w/\\.:])((?:[A-Za-z]:[\\/]|\\\\|/|~[\\/])\S*?\.(?:` +
    BARE_PATH_EXT +
    String.raw`))(?=[\s|).,;:!?\]}>"']|$)`,
  "gi",
);

// A whole trimmed line that is exactly an absolute path; covers paths with
// spaces. The `^` anchor keeps it from matching URLs (which start with a
// scheme rather than a drive letter / slash).
const ABS_PATH_LINE_RE = new RegExp(
  `^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/|~[\\\\/]).*\\.(?:${BARE_PATH_EXT})$`,
  "i",
);

const BT = "`";

// Common final-answer shape from agents/tools:
//   File: `C:\path\image.png`
//   Saved to: `/tmp/image.png`
// Inline code is normally ignored to avoid false positives in commands, but
// these labelled output fields are exactly where generated media paths appear.
const LABELLED_CODE_PATH_RE = new RegExp(
  String.raw`(?:^|[\n\r])([^\n\r]*?\b(?:file|path|saved(?:\s+(?:to|at))?|output|result|image)\s*:\s*)` +
    String.raw`(?:[*_]{1,2})?\s*` +
    BT +
    String.raw`([^` +
    BT +
    String.raw`\n\r]+\.(?:` +
    BARE_PATH_EXT +
    String.raw`))` +
    BT,
  "gi",
);

// Some agents format generated artifacts as:
//   [folder icon] `C:\path\image.png` -- 293 KB
// There is no "File:" label, but the line is still clearly artifact metadata.
// Keep this scoped to code spans on lines with output-ish words or a folder
// marker so command snippets remain plain markdown.
const OUTPUT_CODE_PATH_RE = new RegExp(
  String.raw`(?:^|[\n\r])([^\n\r]*(?:\b(?:file|path|saved|output|result|image|location)\b|\uD83D\uDCC1)[^\n\r]*?)` +
    String.raw`(?:[*_]{1,2})?\s*` +
    BT +
    String.raw`([^` +
    BT +
    String.raw`\n\r]+\.(?:` +
    BARE_PATH_EXT +
    String.raw`))` +
    BT,
  "gi",
);

// Some generated answers put the path alone in a code span after a preceding
// sentence ("Done! Here's your image:"). A standalone absolute path in a code
// span is artifact metadata, not a command snippet.
const STANDALONE_CODE_PATH_RE = new RegExp(
  String.raw`(?:^|[\n\r])(\s*(?:[*_]{1,2})?\s*)` +
    BT +
    String.raw`([^` +
    BT +
    String.raw`\n\r]+\.(?:` +
    BARE_PATH_EXT +
    String.raw`))` +
    BT +
    String.raw`(?:[*_]{1,2})?(?=\s*(?:$|[\n\r]|\([^)\n\r]*\)|[–—-]))`,
  "gi",
);

export interface MediaToken {
  /** The resolved path or URL. */
  src: string;
  /** True when `src` is a direct URL/data URI rather than a local path. */
  isUrl: boolean;
  /** True when the extension looks like a displayable image. */
  isImage: boolean;
  /** Last path/URL segment, for download filenames and alt text. */
  name: string;
}

export type MediaSegment =
  | {
      type: "text";
      value: string;
      /** Character offset of this segment in the original content string.
       *  Used as a stable React key during streaming — `start` doesn't shift
       *  when a later MEDIA: token appears mid-stream, whereas an array
       *  index would. (Follow-up item from PR #303 review.) */
      start: number;
    }
  | {
      type: "media";
      token: MediaToken;
      /** Exact original text this segment replaced. Rendered verbatim when
       *  a bare-path candidate turns out not to be a real file. */
      raw: string;
      /** `media-token` — explicit MEDIA: tag, rendered eagerly.
       *  `bare-path` — inferred path, rendered only once verified to exist. */
      source: "media-token" | "bare-path";
      /** Character offset of this segment in the original content string —
       *  same stability rationale as the text segment's `start`. */
      start: number;
    };

interface Hit {
  start: number;
  end: number;
  token: MediaToken;
  raw: string;
  source: "media-token" | "bare-path";
  origin?: "markdown-image";
}

function toToken(raw: string, wasQuoted: boolean): MediaToken | null {
  let src = raw.trim();
  // Bare MEDIA: tokens may swallow trailing sentence punctuation.
  if (!wasQuoted) src = src.replace(/[).,;:!?\]}]+$/, "");
  if (!src) return null;
  const isUrl = /^(?:https?:\/\/|data:image\/)/i.test(src);
  const name = src.split(/[\\/]/).filter(Boolean).pop() || src;
  return {
    src,
    isUrl,
    isImage: /^data:image\//i.test(src) || IMAGE_EXT.test(src),
    name,
  };
}

function isAbsoluteFileLike(src: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(src.trim());
}

function isDirectImageLike(src: string): boolean {
  const trimmed = src.trim();
  return /^(?:https?:\/\/|data:image\/)/i.test(trimmed);
}

function markdownDestination(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

/** Char ranges of ``` fenced blocks and `inline` code spans. */
function codeRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const fenced = /```[\s\S]*?```/g;
  while ((m = fenced.exec(content)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  const inline = /`[^`\n]+`/g;
  while ((m = inline.exec(content)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** Char ranges of markdown link/image destinations: [label](destination). */
function markdownDestinationRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const link =
    /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s\n]+)(?:\s+["'][^)\n]*["'])?\s*\)/g;
  while ((m = link.exec(content)) !== null) {
    const destination = m[1];
    const relativeStart = m[0].indexOf(destination);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    ranges.push([start, start + destination.length]);
  }
  return ranges;
}

function inCode(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => index >= s && index < e);
}

function overlaps(start: number, end: number, hits: Hit[]): boolean {
  return hits.some((h) => start < h.end && end > h.start);
}

function mediaDedupeKey(token: MediaToken): string {
  if (!token.isImage) return "";
  const src = token.src.trim();
  return token.isUrl ? src : src.replace(/\\/g, "/").toLowerCase();
}

/**
 * Split agent content into ordered text / media segments. Text segments are
 * rendered as markdown; media segments as inline images or download chips.
 */
export function parseMediaTokens(content: string): MediaSegment[] {
  const code = codeRanges(content);
  const markdownDestinations = markdownDestinationRanges(content);
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;

  // 0) Markdown images: ![alt](C:\path\image.png), ![alt](/path),
  // or direct image sources such as data:image/... . Direct markdown images
  // otherwise render through AgentMarkdown while repeated artifact paths render
  // through MediaSegmentView, producing duplicate visible images.
  MARKDOWN_IMAGE_PATH_RE.lastIndex = 0;
  while ((m = MARKDOWN_IMAGE_PATH_RE.exec(content)) !== null) {
    if (inCode(m.index, code)) continue;
    const rawDestination = m[1] ?? "";
    const destination = markdownDestination(rawDestination);
    const directImage = isDirectImageLike(destination);
    if (!directImage && !isAbsoluteFileLike(destination)) continue;
    const token = toToken(destination, true);
    if (!token || !token.isImage) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      token,
      raw: m[0],
      source: directImage ? "media-token" : "bare-path",
      origin: "markdown-image",
    });
  }

  // 1) Explicit MEDIA: tokens.
  MEDIA_RE.lastIndex = 0;
  while ((m = MEDIA_RE.exec(content)) !== null) {
    if (inCode(m.index, code)) continue;
    const quoted = m[1] ?? m[2] ?? m[3];
    const token = toToken(quoted ?? m[4] ?? "", quoted !== undefined);
    if (!token) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      token,
      raw: m[0],
      source: "media-token",
    });
  }

  // 1b) Labelled inline-code paths. This intentionally runs before the
  // generic code-span exclusion below, but only for labels that look like
  // generated output fields.
  LABELLED_CODE_PATH_RE.lastIndex = 0;
  while ((m = LABELLED_CODE_PATH_RE.exec(content)) !== null) {
    const rawPath = m[2] ?? "";
    const codeSpan = `${BT}${rawPath}${BT}`;
    const relativeStart = m[0].lastIndexOf(codeSpan);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    const end = start + codeSpan.length;
    if (overlaps(start, end, hits)) continue;
    const token = toToken(rawPath, true);
    if (token) {
      hits.push({
        start,
        end,
        token,
        raw: codeSpan,
        source: "bare-path",
      });
    }
  }

  // 1c) Artifact metadata lines with a path inside a code span but no colon
  // label, e.g. a folder marker followed by `C:\path\image.png`.
  OUTPUT_CODE_PATH_RE.lastIndex = 0;
  while ((m = OUTPUT_CODE_PATH_RE.exec(content)) !== null) {
    const rawPath = m[2] ?? "";
    const codeSpan = `${BT}${rawPath}${BT}`;
    const relativeStart = m[0].lastIndexOf(codeSpan);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    const end = start + codeSpan.length;
    if (overlaps(start, end, hits)) continue;
    const token = toToken(rawPath, true);
    if (token) {
      hits.push({
        start,
        end,
        token,
        raw: codeSpan,
        source: "bare-path",
      });
    }
  }

  // 1d) Standalone absolute paths in code spans.
  STANDALONE_CODE_PATH_RE.lastIndex = 0;
  while ((m = STANDALONE_CODE_PATH_RE.exec(content)) !== null) {
    const rawPath = m[2] ?? "";
    const codeSpan = `${BT}${rawPath}${BT}`;
    const relativeStart = m[0].lastIndexOf(codeSpan);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    const end = start + codeSpan.length;
    if (overlaps(start, end, hits)) continue;
    const token = toToken(rawPath, true);
    if (token) {
      hits.push({
        start,
        end,
        token,
        raw: codeSpan,
        source: "bare-path",
      });
    }
  }

  // 2) Inline bare absolute paths (no whitespace).
  INLINE_PATH_RE.lastIndex = 0;
  while ((m = INLINE_PATH_RE.exec(content)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (
      inCode(start, code) ||
      inCode(start, markdownDestinations) ||
      overlaps(start, end, hits)
    )
      continue;
    const token = toToken(m[1], true);
    if (token) {
      hits.push({ start, end, token, raw: m[1], source: "bare-path" });
    }
  }

  // 3) Whole-line bare paths (covers paths containing spaces).
  let offset = 0;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1; // include the consumed "\n"
    const trimmed = line.trim();
    if (!trimmed || !ABS_PATH_LINE_RE.test(trimmed)) continue;
    const start = lineStart + line.indexOf(trimmed);
    const end = start + trimmed.length;
    if (
      inCode(start, code) ||
      inCode(start, markdownDestinations) ||
      overlaps(start, end, hits)
    )
      continue;
    const token = toToken(trimmed, true);
    if (token) {
      hits.push({ start, end, token, raw: trimmed, source: "bare-path" });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  const seenImages = new Set<string>();
  const hasDirectMarkdownImage = hits.some(
    (hit) =>
      hit.origin === "markdown-image" && hit.token.isImage && hit.token.isUrl,
  );
  const uniqueHits: Hit[] = [];
  for (const hit of hits) {
    if (
      hasDirectMarkdownImage &&
      hit.origin !== "markdown-image" &&
      hit.token.isImage &&
      !hit.token.isUrl
    ) {
      continue;
    }
    const key = mediaDedupeKey(hit.token);
    if (key && seenImages.has(key)) continue;
    if (key) seenImages.add(key);
    uniqueHits.push(hit);
  }

  const segments: MediaSegment[] = [];
  let last = 0;
  for (const h of uniqueHits) {
    if (h.start > last) {
      segments.push({
        type: "text",
        value: content.slice(last, h.start),
        start: last,
      });
    }
    segments.push({
      type: "media",
      token: h.token,
      raw: h.raw,
      source: h.source,
      start: h.start,
    });
    last = h.end;
  }
  if (last < content.length) {
    segments.push({ type: "text", value: content.slice(last), start: last });
  }
  return segments;
}

/** True when `content` contains at least one explicit MEDIA: token. */
export function hasMediaTokens(content: string): boolean {
  MEDIA_RE.lastIndex = 0;
  return MEDIA_RE.test(content);
}

// A tool/skill invocation that the model "leaked" into its *text* instead of
// issuing a real function call — e.g.
//   <skill_view name="x">{"answer": "the real reply"}</skill_view>
//   <skills_list category="">…markdown prose with <b>headings</b>…</skills_list>
// Weaker models on strict-tool providers (e.g. llama-3.3-70b on Groq) do this;
// the gateway forwards it verbatim, so without cleanup the chat shows the raw
// tag. We only treat tags whose name is snake_case (contains `_`) as leaks —
// no HTML element name contains an underscore, so real markup (`<b>`, `<code>`,
// `<div>`) is never matched.
const LEAKED_TOOL_TAG_RE = /<([a-z][a-z0-9_]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;

// Keys whose string value is the human-readable payload to surface.
const READABLE_JSON_KEYS = [
  "answer",
  "response",
  "content",
  "text",
  "message",
  "result",
] as const;

function readableFromLeakedJson(jsonStr: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const key of READABLE_JSON_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Map the safe inline-HTML subset the model sometimes emits inside leaked tool
 * output to markdown, so AgentMarkdown (react-markdown without rehype-raw, which
 * renders raw HTML literally) shows it as intended. Scoped to leaked-tag bodies
 * only — normal prose/markup elsewhere is left alone.
 */
function inlineHtmlToMarkdown(text: string): string {
  return text
    .replace(/<\/?(?:b|strong)(?:\s[^>]*)?>/gi, "**")
    .replace(/<\/?(?:i|em)(?:\s[^>]*)?>/gi, "*");
}

/**
 * Recover the readable text from leaked tool/skill tags (see
 * {@link LEAKED_TOOL_TAG_RE}). For a leaked tag:
 *   - if its body is JSON with an answer/content/text/etc. string, surface that;
 *   - otherwise strip the wrapper and keep the inner body (converting its inline
 *     HTML to markdown).
 * Non-leaked tags (single-word HTML elements, real prose) are left untouched,
 * as are matches inside fenced/inline code.
 *
 * Returns the original string unchanged when there's nothing to clean — cheap
 * for the common case (no `</…>` in the content).
 */
export function cleanLeakedToolTags(content: string): string {
  if (!content || !content.includes("</")) return content;

  const code = codeRanges(content);
  let result = "";
  let last = 0;
  let changed = false;
  let m: RegExpExecArray | null;
  LEAKED_TOOL_TAG_RE.lastIndex = 0;
  while ((m = LEAKED_TOOL_TAG_RE.exec(content)) !== null) {
    const tag = m[1];
    const body = m[2];
    // snake_case name ⇒ a leaked tool/skill call, not real HTML markup.
    if (!tag.includes("_")) continue;
    if (inCode(m.index, code)) continue;
    const readable = readableFromLeakedJson(body);
    const replacement =
      readable !== null ? readable : inlineHtmlToMarkdown(body).trim();
    if (!replacement) continue; // empty body → leave the tag as-is
    result += content.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
    changed = true;
  }
  if (!changed) return content;
  result += content.slice(last);
  return result;
}

/**
 * Classify a plain `src` from a markdown `![alt](src)` image syntax. The
 * markdown image syntax doesn't actually guarantee an image — the agent
 * may emit `![alt](file.pdf)` or `![alt](report.csv)`. Without checking
 * the extension here the caller would unconditionally try to render it
 * via `MediaImage` → `readMediaAsDataUrl` returns `null` (no MIME map
 * entry) → the user sees an "image failed to load" error. Honour the
 * extension so non-image markdown images can fall through to the
 * download-chip path (follow-up item from PR #303 review).
 */
export function describeImageSrc(src: string): MediaToken {
  const trimmed = src.trim();
  const isUrl = /^(?:https?:\/\/|data:image\/)/i.test(trimmed);
  const name = trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
  return {
    src: trimmed,
    isUrl,
    isImage: /^data:image\//i.test(trimmed) || IMAGE_EXT.test(trimmed),
    name,
  };
}
