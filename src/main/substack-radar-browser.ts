import type { SubstackRadarVisibleSignals } from "../shared/substack-radar";
import {
  buildSubstackRadarCandidateId,
  scoreSubstackRadarCandidate,
} from "../shared/substack-radar";

export interface ExtractedSubstackCard {
  publicationUrl: string;
  title: string;
  description: string;
  author: string;
  category: string;
  visibleSignals: SubstackRadarVisibleSignals;
  sourcePageUrl: string;
}

type ScoredSubstackCard = ExtractedSubstackCard & {
  id: string;
  score: number;
  discoveredAt: number;
};

interface AnchorSnapshot {
  href: string;
  title: string;
  description: string;
  author: string;
  textParts: string[];
}

function cleanVisibleText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizePublicationUrl(rawHref: string): string | null {
  if (!/^https?:\/\//i.test(rawHref)) return null;

  let url: URL;
  try {
    url = new URL(rawHref);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!url.hostname.toLowerCase().endsWith(".substack.com")) return null;

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function textPartsFromElement(element: Element): string[] {
  return Array.from(element.querySelectorAll("h1,h2,h3,h4,p,span,div"))
    .map((node) => cleanVisibleText(node.textContent))
    .filter(Boolean);
}

function queryFirstText(element: Element, selectors: string): string {
  return cleanVisibleText(element.querySelector(selectors)?.textContent);
}

function snapshotAnchorsWithDom(html: string): AnchorSnapshot[] | null {
  if (typeof DOMParser === "undefined") return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("a[href]")).map((anchor) => ({
    href: anchor.getAttribute("href") || "",
    title: queryFirstText(anchor, "h1,h2,h3,h4"),
    description: queryFirstText(anchor, "p"),
    author: queryFirstText(anchor, "[rel='author'],[data-testid*='author']"),
    textParts: textPartsFromElement(anchor),
  }));
}

function stripTags(html: string): string {
  return cleanVisibleText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractFirstTaggedText(html: string, tagNames: string[]): string {
  const tagPattern = tagNames.join("|");
  const match = html.match(
    new RegExp(`<(${tagPattern})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "i"),
  );
  return match ? stripTags(match[2]) : "";
}

function snapshotAnchorsWithMarkup(html: string): AnchorSnapshot[] {
  const anchors: AnchorSnapshot[] = [];
  const anchorPattern = /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const body = match[3] || "";
    anchors.push({
      href: match[2] || "",
      title: extractFirstTaggedText(body, ["h1", "h2", "h3", "h4"]),
      description: extractFirstTaggedText(body, ["p"]),
      author: "",
      textParts: Array.from(
        body.matchAll(/<(h1|h2|h3|h4|p|span|div)\b[^>]*>([\s\S]*?)<\/\1>/gi),
      )
        .map((part) => stripTags(part[2] || ""))
        .filter(Boolean),
    });
  }

  return anchors;
}

function extractVisibleSignals(
  textParts: string[],
): SubstackRadarVisibleSignals {
  const signals: SubstackRadarVisibleSignals = {};

  for (const text of textParts) {
    if (!signals.subscriberText && /\bsubscribers?\b/i.test(text)) {
      signals.subscriberText = text;
      continue;
    }
    if (!signals.postCountText && /\bposts?\b/i.test(text)) {
      signals.postCountText = text;
      continue;
    }
    if (!signals.recommendationText && /\brecommend/i.test(text)) {
      signals.recommendationText = text;
      continue;
    }
    if (!signals.badgeText && /\b(bestseller|featured|popular)\b/i.test(text)) {
      signals.badgeText = text;
    }
  }

  return signals;
}

export function extractSubstackVisibleCards(
  html: string,
  category: string,
  sourcePageUrl: string,
): ExtractedSubstackCard[] {
  const anchors =
    snapshotAnchorsWithDom(html) ?? snapshotAnchorsWithMarkup(html);
  const seen = new Set<string>();
  const cards: ExtractedSubstackCard[] = [];

  for (const anchor of anchors) {
    const publicationUrl = normalizePublicationUrl(anchor.href);
    if (!publicationUrl || seen.has(publicationUrl)) continue;

    const title = cleanVisibleText(anchor.title);
    if (!title) continue;

    seen.add(publicationUrl);
    cards.push({
      publicationUrl,
      title,
      description: cleanVisibleText(anchor.description),
      author: cleanVisibleText(anchor.author),
      category,
      visibleSignals: extractVisibleSignals(anchor.textParts),
      sourcePageUrl,
    });
  }

  return cards;
}

export async function discoverSubstackCardsWithBrowser(
  category: string,
  sourceUrl: string,
): Promise<ScoredSubstackCard[]> {
  const { BrowserWindow } = await import("electron");
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const discoveredAt = Date.now();

  try {
    await win.loadURL(sourceUrl);
    const renderedHtml = await win.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
      true,
    );
    if (typeof renderedHtml !== "string") return [];

    return extractSubstackVisibleCards(renderedHtml, category, sourceUrl).map(
      (card) => ({
        ...card,
        id: buildSubstackRadarCandidateId(card.publicationUrl),
        score: scoreSubstackRadarCandidate({
          title: card.title,
          description: card.description,
          visibleSignals: card.visibleSignals,
        }),
        discoveredAt,
      }),
    );
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}
