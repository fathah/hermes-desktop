export type SourceIntakeEngine =
  | "rss"
  | "substack-radar"
  | "crawl4ai"
  | "unfurl"
  | "assistant-research";

export type SourceIntakeRouteKind = "substack" | "rss" | "webpage" | "blocked";

export interface SourceIntakeRequest {
  url: string;
  profile?: string;
}

export interface SourceIntakeResult {
  ok: boolean;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  markdown: string;
  excerpt: string;
  links: string[];
  engine: SourceIntakeEngine;
  fetchedAt: number;
  error?: string;
}

export interface SourceIntakeCapability {
  key: SourceIntakeEngine;
  label: string;
  ready: boolean;
  message: string;
}

export interface SourceIntakeStatus {
  checkedAt: number;
  capabilities: SourceIntakeCapability[];
}

export interface SourceInputRoute {
  kind: SourceIntakeRouteKind;
  normalizedUrl: string;
  engine: SourceIntakeEngine;
  error?: string;
}

function withDefaultProtocol(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  return `https://${input}`;
}

function isLikelyPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return (
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  );
}

function isSubstackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "substack.com" || host.endsWith(".substack.com");
}

function isRssLikeUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith(".xml") ||
    path.endsWith(".rss") ||
    path.endsWith(".atom") ||
    path === "/feed" ||
    path === "/rss" ||
    path === "/atom.xml" ||
    path.endsWith("/feed") ||
    path.endsWith("/rss")
  );
}

export function routeSourceInput(rawInput: string): SourceInputRoute {
  const input = rawInput.trim();
  if (!input) {
    return {
      kind: "blocked",
      normalizedUrl: "",
      engine: "unfurl",
      error: "Enter a public source URL.",
    };
  }

  let url: URL;
  try {
    url = new URL(withDefaultProtocol(input));
  } catch {
    return {
      kind: "blocked",
      normalizedUrl: input,
      engine: "unfurl",
      error: "Enter a valid public source URL.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      kind: "blocked",
      normalizedUrl: url.toString(),
      engine: "unfurl",
      error: "Only public HTTPS source URLs can be imported.",
    };
  }

  if (url.username || url.password || isLikelyPrivateHostname(url.hostname)) {
    return {
      kind: "blocked",
      normalizedUrl: url.toString(),
      engine: "unfurl",
      error: "Private, local, or credential-bearing URLs cannot be imported.",
    };
  }

  if (isSubstackHostname(url.hostname)) {
    return {
      kind: "substack",
      normalizedUrl: url.toString(),
      engine: "rss",
    };
  }

  if (isRssLikeUrl(url)) {
    return {
      kind: "rss",
      normalizedUrl: url.toString(),
      engine: "rss",
    };
  }

  return {
    kind: "webpage",
    normalizedUrl: url.toString(),
    engine: "crawl4ai",
  };
}
