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
