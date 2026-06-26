export type SpsWikiLinkKind = "link" | "embed";

export interface SpsWikiLink {
  raw: string;
  inner: string;
  target: string;
  display?: string;
  heading?: string;
  blockId?: string;
  relation?: string;
  kind: SpsWikiLinkKind;
  start: number;
  end: number;
}

export interface SpsLinkEdge {
  raw: string;
  target: string;
  type: string;
  kind: SpsWikiLinkKind;
  heading?: string;
  blockId?: string;
  start: number;
  end: number;
}

const WIKILINK_RE = /!?\[\[([^\]\r\n]+)\]\]/g;
const RELATION_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

const NON_RELATION_FRONTMATTER_KEYS = new Set([
  "aliases",
  "captureid",
  "capturedat",
  "cover",
  "date",
  "draft",
  "icon",
  "ingestedat",
  "journal",
  "kind",
  "mime",
  "mood",
  "schema",
  "source",
  "status",
  "tags",
  "time",
  "title",
  "type",
  "updated",
]);

export function parseSpsWikilinks(text: string): SpsWikiLink[] {
  const links: SpsWikiLink[] = [];
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    const raw = match[0];
    const parsed = parseSpsWikilinkRaw(raw, match.index);
    if (parsed) links.push(parsed);
  }
  return links;
}

export function parseSpsWikilinkRaw(
  raw: string,
  start = 0,
): SpsWikiLink | null {
  const m = /^(!)?\[\[([^\]\r\n]+)\]\]$/.exec(raw.trim());
  if (!m) return null;
  const kind: SpsWikiLinkKind = m[1] ? "embed" : "link";
  const inner = m[2].trim();
  if (!inner) return null;

  const aliasIdx = inner.indexOf("|");
  const targetAndFragment =
    aliasIdx === -1 ? inner : inner.slice(0, aliasIdx).trim();
  const display =
    aliasIdx === -1 ? undefined : inner.slice(aliasIdx + 1).trim() || undefined;

  let relation: string | undefined;
  let targetRef = targetAndFragment;
  const relationIdx = targetRef.indexOf("::");
  if (relationIdx !== -1) {
    const maybeRelation = targetRef.slice(0, relationIdx).trim();
    const maybeTarget = targetRef.slice(relationIdx + 2).trim();
    if (RELATION_RE.test(maybeRelation) && maybeTarget) {
      relation = maybeRelation;
      targetRef = maybeTarget;
    }
  }

  let target = targetRef;
  let heading: string | undefined;
  let blockId: string | undefined;
  const fragmentIdx = targetRef.indexOf("#");
  if (fragmentIdx !== -1) {
    target = targetRef.slice(0, fragmentIdx).trim();
    const fragment = targetRef.slice(fragmentIdx + 1).trim();
    if (fragment.startsWith("^"))
      blockId = fragment.slice(1).trim() || undefined;
    else heading = fragment || undefined;
  }

  target = target.trim();
  if (!target) return null;
  return {
    raw,
    inner,
    target,
    display,
    heading,
    blockId,
    relation,
    kind,
    start,
    end: start + raw.length,
  };
}

export function spsWikilinkToMarkdown(input: {
  target: string;
  display?: string;
  heading?: string;
  blockId?: string;
  relation?: string;
  kind?: SpsWikiLinkKind;
}): string {
  const fragment = input.blockId
    ? `#^${input.blockId}`
    : input.heading
      ? `#${input.heading}`
      : "";
  const relation = input.relation ? `${input.relation}::` : "";
  const display = input.display ? `|${input.display}` : "";
  const prefix = input.kind === "embed" ? "!" : "";
  return `${prefix}[[${relation}${input.target}${fragment}${display}]]`;
}

export function extractSpsLinkEdges(
  raw: string,
  props: Record<string, unknown> = {},
): SpsLinkEdge[] {
  const edges: SpsLinkEdge[] = [];
  const attrRanges = new Set<string>();
  const seen = new Set<string>();

  const addEdge = (link: SpsWikiLink, type: string): void => {
    const key = [
      link.target,
      type,
      link.kind,
      link.heading ?? "",
      link.blockId ?? "",
    ].join("\0");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      raw: link.raw,
      target: link.target,
      type,
      kind: link.kind,
      heading: link.heading,
      blockId: link.blockId,
      start: link.start,
      end: link.end,
    });
  };

  const attrRe =
    /(^|[\r\n])([ \t]*(?:[-*]\s+|\d+\.\s+|- \[[ xX]\]\s+)?)([A-Za-z][A-Za-z0-9_-]*)::[ \t]*(!?\[\[[^\]\r\n]+\]\])/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRe.exec(raw)) !== null) {
    const relation = attrMatch[3];
    const linkRaw = attrMatch[4];
    const linkStart = attrMatch.index + attrMatch[0].lastIndexOf(linkRaw);
    const link = parseSpsWikilinkRaw(linkRaw, linkStart);
    if (!link) continue;
    attrRanges.add(`${link.start}:${link.end}`);
    addEdge(link, relation);
  }

  for (const link of parseSpsWikilinks(raw)) {
    if (attrRanges.has(`${link.start}:${link.end}`) && !link.relation) continue;
    addEdge(link, link.relation ?? (link.kind === "embed" ? "embed" : "link"));
  }

  for (const [key, value] of Object.entries(props)) {
    const relation = key.trim();
    if (!RELATION_RE.test(relation)) continue;
    if (NON_RELATION_FRONTMATTER_KEYS.has(relation.toLowerCase())) continue;
    for (const link of frontmatterLinks(value)) {
      addEdge(link, relation);
    }
  }

  return edges;
}

function frontmatterLinks(value: unknown): SpsWikiLink[] {
  if (typeof value === "string") return parseSpsWikilinks(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string" ? parseSpsWikilinks(item) : [],
    );
  }
  return [];
}

export function maskSpsWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (match) => " ".repeat(match.length));
}
