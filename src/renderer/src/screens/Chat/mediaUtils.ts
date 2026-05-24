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
const MEDIA_RE =
  /MEDIA:[ \t]*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))/g;

// Inline bare absolute path (no whitespace in the path). The negative
// lookbehind blocks matches that start mid-token or inside a URL (`://`);
// the lookahead requires the extension to be followed by whitespace,
// sentence punctuation, or end-of-string.
const INLINE_PATH_RE = new RegExp(
  String.raw`(?<![\w/\\.:])((?:[A-Za-z]:[\\/]|\\\\|/|~[\\/])\S*?\.(?:` +
    BARE_PATH_EXT +
    String.raw`))(?=[\s).,;:!?\]}>"']|$)`,
  "gi",
);

// A whole trimmed line that is exactly an absolute path; covers paths with
// spaces. The `^` anchor keeps it from matching URLs (which start with a
// scheme rather than a drive letter / slash).
const ABS_PATH_LINE_RE = new RegExp(
  `^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/|~[\\\\/]).*\\.(?:${BARE_PATH_EXT})$`,
  "i",
);

export interface MediaToken {
  /** The resolved path or URL. */
  src: string;
  /** True when `src` is an http(s) URL rather than a local path. */
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
}

function toToken(raw: string, wasQuoted: boolean): MediaToken | null {
  let src = raw.trim();
  // Bare MEDIA: tokens may swallow trailing sentence punctuation.
  if (!wasQuoted) src = src.replace(/[).,;:!?\]}]+$/, "");
  if (!src) return null;
  const isUrl = /^https?:\/\//i.test(src);
  const name = src.split(/[\\/]/).filter(Boolean).pop() || src;
  return { src, isUrl, isImage: IMAGE_EXT.test(src), name };
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

function inCode(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => index >= s && index < e);
}

function overlaps(start: number, end: number, hits: Hit[]): boolean {
  return hits.some((h) => start < h.end && end > h.start);
}

/**
 * Split agent content into ordered text / media segments. Text segments are
 * rendered as markdown; media segments as inline images or download chips.
 */
export function parseMediaTokens(content: string): MediaSegment[] {
  const code = codeRanges(content);
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;

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

  // 2) Inline bare absolute paths (no whitespace).
  INLINE_PATH_RE.lastIndex = 0;
  while ((m = INLINE_PATH_RE.exec(content)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (inCode(start, code) || overlaps(start, end, hits)) continue;
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
    if (inCode(start, code) || overlaps(start, end, hits)) continue;
    const token = toToken(trimmed, true);
    if (token) {
      hits.push({ start, end, token, raw: trimmed, source: "bare-path" });
    }
  }

  hits.sort((a, b) => a.start - b.start);

  const segments: MediaSegment[] = [];
  let last = 0;
  for (const h of hits) {
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
  const isUrl = /^https?:\/\//i.test(trimmed);
  const name = trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
  return { src: trimmed, isUrl, isImage: IMAGE_EXT.test(trimmed), name };
}
