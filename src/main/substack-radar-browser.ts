import { isIP } from "node:net";

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

export interface SubstackRenderSettleSnapshot {
  candidateCount: number;
  readyCandidateCount: number;
  visibleText: string;
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

const CARD_CONTAINER_SELECTOR =
  "article,li,section,[role='article'],[data-testid*='card'],[class*='card']";
const RENDER_SETTLE_TIMEOUT_MS = 5_000;
const RENDER_SETTLE_POLL_MS = 100;
const RENDER_SETTLE_STABLE_POLLS = 2;
const BROWSER_OPERATION_TIMEOUT_MS = 10_000;

function cleanVisibleText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function isAllowedSubstackDiscoveryUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.hostname !== "substack.com") return false;
  if (url.search || url.hash) return false;
  if (url.pathname === "/explore") return true;
  return /^\/search\/[^/]+$/.test(url.pathname);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split(".").map((part) => Number(part));
    const [first = 0, second = 0] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (ipVersion === 6) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

export function isAllowedSubstackBrowserRequestUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (isPrivateOrLocalHostname(hostname)) return false;

  return (
    hostname === "substack.com" ||
    hostname.endsWith(".substack.com") ||
    hostname === "substackcdn.com"
  );
}

function assertAllowedSubstackDiscoveryUrl(rawUrl: string): string {
  if (!isAllowedSubstackDiscoveryUrl(rawUrl)) {
    throw new Error(`Unsupported Substack discovery URL: ${rawUrl}`);
  }
  return new URL(rawUrl).toString();
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
  return Array.from(element.querySelectorAll("h1,h2,h3,h4,p,span"))
    .map((node) => cleanVisibleText(node.textContent))
    .filter(Boolean);
}

function queryFirstText(element: Element, selectors: string): string {
  return cleanVisibleText(element.querySelector(selectors)?.textContent);
}

function cardElementForAnchor(anchor: Element): Element {
  if (queryFirstText(anchor, "h1,h2,h3,h4")) return anchor;
  return (
    anchor.closest(CARD_CONTAINER_SELECTOR) ?? anchor.parentElement ?? anchor
  );
}

function snapshotAnchorsWithDom(html: string): AnchorSnapshot[] | null {
  if (typeof DOMParser === "undefined") return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("a[href]")).map((anchor) => {
    const card = cardElementForAnchor(anchor);
    return {
      href: anchor.getAttribute("href") || "",
      title: queryFirstText(card, "h1,h2,h3,h4"),
      description: queryFirstText(card, "p"),
      author: queryFirstText(card, "[rel='author'],[data-testid*='author']"),
      textParts: textPartsFromElement(card),
    };
  });
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

function findNearestMarkupContainer(
  html: string,
  anchorStart: number,
  anchorEnd: number,
): string | null {
  for (const tagName of ["article", "section", "li", "div"]) {
    const openPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
    const beforeAnchor = html.slice(0, anchorStart);
    const openings = Array.from(beforeAnchor.matchAll(openPattern));
    const opening = openings.at(-1);
    if (!opening || opening.index === undefined) continue;

    const closePattern = new RegExp(`</${tagName}>`, "i");
    const afterAnchor = html.slice(anchorEnd);
    const closing = afterAnchor.match(closePattern);
    if (!closing || closing.index === undefined) continue;

    return html.slice(
      opening.index,
      anchorEnd + closing.index + closing[0].length,
    );
  }

  return null;
}

function markupHasHeading(html: string): boolean {
  return /<h[1-4]\b/i.test(html);
}

function snapshotAnchorsWithMarkup(html: string): AnchorSnapshot[] {
  const anchors: AnchorSnapshot[] = [];
  const anchorPattern = /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const anchorBody = match[3] || "";
    const anchorStart = match.index ?? 0;
    const anchorEnd = anchorStart + match[0].length;
    const body = markupHasHeading(anchorBody)
      ? anchorBody
      : findNearestMarkupContainer(html, anchorStart, anchorEnd) || anchorBody;
    anchors.push({
      href: match[2] || "",
      title: extractFirstTaggedText(body, ["h1", "h2", "h3", "h4"]),
      description: extractFirstTaggedText(body, ["p"]),
      author: "",
      textParts: Array.from(
        body.matchAll(/<(h1|h2|h3|h4|p|span)\b[^>]*>([\s\S]*?)<\/\1>/gi),
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

function hasVisibleSignals(signals: SubstackRadarVisibleSignals): boolean {
  return Object.values(signals).some((value) => Boolean(value?.trim()));
}

function isReadySubstackCard(card: ExtractedSubstackCard): boolean {
  return Boolean(
    card.title.trim() &&
    (card.description.trim() || hasVisibleSignals(card.visibleSignals)),
  );
}

export function snapshotSubstackRenderState(
  html: string,
  category: string,
  sourcePageUrl: string,
): SubstackRenderSettleSnapshot {
  const cards = extractSubstackVisibleCards(html, category, sourcePageUrl);
  return {
    candidateCount: cards.length,
    readyCandidateCount: cards.filter(isReadySubstackCard).length,
    visibleText: cards
      .map((card) =>
        [
          card.publicationUrl,
          card.title,
          card.description,
          card.author,
          card.visibleSignals.subscriberText,
          card.visibleSignals.badgeText,
          card.visibleSignals.postCountText,
          card.visibleSignals.recommendationText,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n---\n"),
  };
}

export function isSubstackRenderSnapshotSettled(
  previous: SubstackRenderSettleSnapshot | null,
  current: SubstackRenderSettleSnapshot,
  stablePolls: number,
): boolean {
  if (!previous) return false;
  if (stablePolls < RENDER_SETTLE_STABLE_POLLS) return false;
  if (current.readyCandidateCount < 1) return false;
  return (
    previous.candidateCount === current.candidateCount &&
    previous.visibleText === current.visibleText
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out ${label}`));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function readRenderedHtml(
  webContents: Electron.WebContents,
): Promise<string> {
  const renderedHtml = await withTimeout(
    webContents.executeJavaScript("document.documentElement.outerHTML", true),
    BROWSER_OPERATION_TIMEOUT_MS,
    "reading rendered Substack HTML",
  );
  return typeof renderedHtml === "string" ? renderedHtml : "";
}

async function waitForSubstackCardCandidates(
  webContents: Electron.WebContents,
  category: string,
  sourcePageUrl: string,
): Promise<string> {
  const startedAt = Date.now();
  let previous: SubstackRenderSettleSnapshot | null = null;
  let stablePolls = 0;
  let latestHtml = "";

  while (Date.now() - startedAt < RENDER_SETTLE_TIMEOUT_MS) {
    latestHtml = await readRenderedHtml(webContents);
    const current = snapshotSubstackRenderState(
      latestHtml,
      category,
      sourcePageUrl,
    );
    if (
      previous &&
      previous.candidateCount === current.candidateCount &&
      previous.visibleText === current.visibleText
    ) {
      stablePolls += 1;
    } else {
      stablePolls = 1;
    }

    if (isSubstackRenderSnapshotSettled(previous, current, stablePolls)) {
      return latestHtml;
    }

    previous = current;
    await wait(RENDER_SETTLE_POLL_MS);
  }

  return latestHtml || readRenderedHtml(webContents);
}

export async function discoverSubstackCardsWithBrowser(
  category: string,
  sourceUrl: string,
): Promise<ScoredSubstackCard[]> {
  const allowedSourceUrl = assertAllowedSubstackDiscoveryUrl(sourceUrl);
  const { BrowserWindow } = await import("electron");
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `substack-radar:${Date.now()}:${Math.random()
        .toString(36)
        .slice(2)}`,
      sandbox: true,
      webviewTag: false,
    },
  });
  const discoveredAt = Date.now();
  const browserSession = win.webContents.session;

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedSubstackDiscoveryUrl(url)) {
      event.preventDefault();
    }
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedSubstackDiscoveryUrl(url)) {
      event.preventDefault();
    }
  });
  browserSession.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      if (!isAllowedSubstackBrowserRequestUrl(details.url)) {
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    },
  );

  try {
    await withTimeout(
      win.loadURL(allowedSourceUrl),
      BROWSER_OPERATION_TIMEOUT_MS,
      "loading Substack page",
    );
    const renderedHtml = await waitForSubstackCardCandidates(
      win.webContents,
      category,
      allowedSourceUrl,
    );
    if (!renderedHtml) return [];

    return extractSubstackVisibleCards(
      renderedHtml,
      category,
      allowedSourceUrl,
    ).map((card) => ({
      ...card,
      id: buildSubstackRadarCandidateId(card.publicationUrl),
      score: scoreSubstackRadarCandidate({
        title: card.title,
        description: card.description,
        visibleSignals: card.visibleSignals,
      }),
      discoveredAt,
    }));
  } finally {
    if (!win.isDestroyed()) {
      win.webContents.stop();
      win.destroy();
    }
  }
}
