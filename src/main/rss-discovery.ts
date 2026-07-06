import { DOMParser } from "@xmldom/xmldom";
import { getSubstackFeedCandidates } from "../shared/substack";
import { publicFetch } from "./security/network-policy";

export type RssFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface DiscoveredSubstackFeed {
  ok: true;
  feedUrl: string;
  siteUrl: string;
  title: string;
  description: string;
  sourceType: "substack";
}

export interface RssDiscoveryError {
  ok: false;
  error: string;
}

export type SubstackDiscoveryResult =
  | DiscoveredSubstackFeed
  | RssDiscoveryError;

export interface ParsedRssFeedMetadata {
  title: string;
  siteUrl: string;
  description: string;
}

export interface ParsedRssArticle {
  guid: string;
  title: string;
  author: string;
  url: string;
  published_at: number;
  content_raw: string;
  content_text: string;
  summary_excerpt: string;
  relevance_score: number;
}

const NO_PUBLIC_FEED_ERROR =
  "This URL did not expose a public RSS or Atom feed. Try the publication homepage, or confirm the publication has a public /feed URL.";

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function firstElement(
  parent: Document | Element,
  tagName: string,
): Element | null {
  return parent.getElementsByTagName(tagName).item(0);
}

function textOf(parent: Document | Element, tagName: string): string {
  return firstElement(parent, tagName)?.textContent?.trim() || "";
}

function attrOf(element: Element | null, attr: string): string {
  return element?.getAttribute(attr)?.trim() || "";
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value: string): string {
  const text = value.trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function isFeedDocument(doc: Document): boolean {
  const rootName = doc.documentElement?.tagName.toLowerCase();
  return rootName === "rss" || rootName === "feed" || rootName === "rdf:rdf";
}

function getAtomAlternateLink(entry: Element): string {
  const links = Array.from(entry.getElementsByTagName("link"));
  const alternate =
    links.find(
      (link) => (link.getAttribute("rel") || "alternate") === "alternate",
    ) ||
    links[0] ||
    null;
  return attrOf(alternate, "href");
}

export function parseRssFeedMetadata(xml: string): ParsedRssFeedMetadata {
  const doc = parseXml(xml);
  const channel = firstElement(doc, "channel");
  const root = firstElement(doc, "feed");
  const source = channel || root || doc;
  const atomLink = root ? getAtomAlternateLink(root) : "";

  return {
    title: textOf(source, "title"),
    siteUrl: textOf(source, "link") || atomLink,
    description: textOf(source, "description") || textOf(source, "subtitle"),
  };
}

export function parseRssArticles(xml: string): ParsedRssArticle[] {
  const doc = parseXml(xml);
  if (!isFeedDocument(doc)) return [];

  const rssItems = Array.from(doc.getElementsByTagName("item"));
  if (rssItems.length > 0) {
    return rssItems.map((item) => {
      const raw =
        textOf(item, "content:encoded") ||
        textOf(item, "description") ||
        textOf(item, "summary");
      const text = stripHtml(raw);
      const url = textOf(item, "link");
      const guid = textOf(item, "guid") || url || textOf(item, "title");
      return {
        guid,
        title: textOf(item, "title") || "Untitled",
        author: textOf(item, "author") || textOf(item, "dc:creator"),
        url,
        published_at:
          Date.parse(textOf(item, "pubDate") || textOf(item, "published")) ||
          Date.now(),
        content_raw: raw,
        content_text: text,
        summary_excerpt: excerpt(text),
        relevance_score: 80,
      };
    });
  }

  return Array.from(doc.getElementsByTagName("entry")).map((entry) => {
    const raw =
      textOf(entry, "content") ||
      textOf(entry, "summary") ||
      textOf(entry, "description");
    const text = stripHtml(raw);
    const url = getAtomAlternateLink(entry);
    const guid = textOf(entry, "id") || url || textOf(entry, "title");
    return {
      guid,
      title: textOf(entry, "title") || "Untitled",
      author: textOf(firstElement(entry, "author") || entry, "name"),
      url,
      published_at:
        Date.parse(textOf(entry, "published") || textOf(entry, "updated")) ||
        Date.now(),
      content_raw: raw,
      content_text: text,
      summary_excerpt: excerpt(text),
      relevance_score: 80,
    };
  });
}

export async function fetchRssArticles(
  feedUrl: string,
  // Default to the SSRF-guarded fetcher (DNS-resolve + pin + reject private
  // ranges, re-validated per redirect hop) so a user-added feed URL cannot make
  // the app reach internal/localhost/metadata endpoints. See CLAUDE.md.
  fetcher: RssFetcher = publicFetch,
): Promise<ParsedRssArticle[]> {
  const response = await fetcher(feedUrl, {
    headers: {
      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });
  if (!response.ok) return [];
  return parseRssArticles(await response.text());
}

export async function discoverSubstackFeed(
  input: string,
  fetcher: RssFetcher = publicFetch,
  timeoutMs = 10000,
): Promise<SubstackDiscoveryResult> {
  const candidates = getSubstackFeedCandidates(input);
  if (!candidates.ok) return candidates;

  for (const feedUrl of candidates.feedUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(feedUrl, {
        signal: controller.signal,
        headers: {
          accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (!response.ok) continue;

      const xml = await response.text();
      const doc = parseXml(xml);
      if (!isFeedDocument(doc)) continue;

      const metadata = parseRssFeedMetadata(xml);
      return {
        ok: true,
        feedUrl,
        siteUrl: metadata.siteUrl || candidates.siteUrl,
        title: metadata.title || "Substack Feed",
        description: metadata.description,
        sourceType: "substack",
      };
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, error: NO_PUBLIC_FEED_ERROR };
}
