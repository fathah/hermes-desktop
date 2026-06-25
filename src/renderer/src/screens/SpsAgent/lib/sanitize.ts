// sanitize.ts — defense-in-depth for stored/assistant-produced rich-text HTML.
// Block HTML (and assistant diff HTML) is persisted and re-applied to the DOM via
// innerHTML / dangerouslySetInnerHTML, so it must be sanitized on every render:
// strip <script>, event handlers, and javascript:/data: URIs while keeping the
// formatting the editor actually emits (bold/italic/links/colors/mentions/comment
// anchors). The link entry point is also validated at source (SelectionToolbar).
import DOMPurify from "dompurify";

// Tags/attrs the block editor produces via execCommand + mention/comment chips.
const ALLOWED_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "font",
  "span",
  "a",
  "code",
  "mark",
  "br",
];
const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "style",
  "color",
  "class",
  "contenteditable",
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true, // data-cmt anchors (data-* can't execute)
  });
}

export function sanitizeSvg(svg: string | null | undefined): string {
  if (typeof svg !== "string" || svg.length === 0) return "";
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script"],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Tags permitted in remote RSS/Atom article bodies. Broader than the block
 * editor allowlist above (RSS carries structured prose: headings, lists,
 * blockquotes, images, preformatted code) but never includes any element that
 * can load or execute active content (no script/iframe/object/embed/form).
 */
const RSS_ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "ins",
  "sub",
  "sup",
  "mark",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  "a",
  "img",
  "figure",
  "figcaption",
  "picture",
  "source",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "abbr",
  "cite",
  "q",
  "time",
  "small",
  "address",
];
const RSS_ALLOWED_ATTR = [
  "href",
  "src",
  "srcset",
  "alt",
  "title",
  "width",
  "height",
  "target",
  "rel",
  "hreflang",
  "datetime",
  "colspan",
  "rowspan",
  "lang",
  "dir",
  "name",
];

/**
 * Sanitize untrusted remote RSS/Atom HTML for safe rendering. This is the
 * defense for C3 (stored-XSS): feed bodies are attacker-controlled and were
 * previously injected via dangerouslySetInnerHTML with no scrubbing, which
 * chained into the privileged renderer. Total over non-string input so a
 * missing/empty field can never throw at render time.
 */
export function sanitizeRssHtml(html: string | null | undefined): string {
  if (typeof html !== "string" || html.length === 0) return "";
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RSS_ALLOWED_TAGS,
    ALLOWED_ATTR: RSS_ALLOWED_ATTR,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "style",
      "link",
      "meta",
      "base",
    ],
    FORBID_ATTR: [
      "onerror",
      "onclick",
      "onload",
      "onmouseover",
      "onfocus",
      "onblur",
    ],
    ALLOW_DATA_ATTR: false,
  });
  return normalizeRssLinks(sanitized);
}

function safeRssUrl(raw: string | null, protocols: Set<string>): string | null {
  if (!raw) return null;
  try {
    const base =
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "https://example.invalid/";
    const url = new URL(raw, base);
    return protocols.has(url.protocol.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeSrcset(raw: string | null): string | null {
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map((part) => {
      const [url, ...descriptor] = part.trim().split(/\s+/);
      const safeUrl = safeRssUrl(url, new Set(["http:", "https:"]));
      return safeUrl ? [safeUrl, ...descriptor].join(" ") : "";
    })
    .filter(Boolean);
  return entries.length ? entries.join(", ") : null;
}

function normalizeRssLinks(html: string): string {
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    const safe = safeRssUrl(
      anchor.getAttribute("href"),
      new Set(["http:", "https:", "mailto:"]),
    );
    if (safe) {
      anchor.setAttribute("href", safe);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  });
  template.content.querySelectorAll("img[src], source[src]").forEach((node) => {
    const safe = safeRssUrl(
      node.getAttribute("src"),
      new Set(["http:", "https:"]),
    );
    if (safe) node.setAttribute("src", safe);
    else node.removeAttribute("src");
  });
  template.content
    .querySelectorAll("img[srcset], source[srcset]")
    .forEach((node) => {
      const safe = normalizeSrcset(node.getAttribute("srcset"));
      if (safe) node.setAttribute("srcset", safe);
      else node.removeAttribute("srcset");
    });
  return template.innerHTML;
}

/** Validate a user-entered link: only http(s)/mailto, everything else rejected. */
export function safeLinkHref(raw: string): string | null {
  try {
    const u = new URL(raw, window.location.href);
    if (!/^(https?|mailto):$/i.test(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}
