export interface SubstackFeedCandidates {
  ok: true;
  siteUrl: string;
  feedUrls: string[];
}

export interface SubstackFeedCandidateError {
  ok: false;
  error: string;
}

export type SubstackFeedCandidateResult =
  | SubstackFeedCandidates
  | SubstackFeedCandidateError;

function withDefaultProtocol(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  return `https://${input}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getSubstackFeedCandidates(
  rawInput: string,
): SubstackFeedCandidateResult {
  const input = rawInput.trim();
  if (!input) {
    return {
      ok: false,
      error: "Enter a Substack publication or article URL.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(withDefaultProtocol(input));
  } catch {
    return {
      ok: false,
      error: "Enter a valid Substack publication or article URL.",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: "Only http and https URLs can be used for public feeds.",
    };
  }

  const origin = trimTrailingSlash(parsed.origin);
  const path = trimTrailingSlash(parsed.pathname);
  const explicitFeed =
    path === "/feed" || path === "/rss" || path.endsWith(".xml");
  const feedUrl = explicitFeed ? `${origin}${path}` : `${origin}/feed`;

  return {
    ok: true,
    siteUrl: origin,
    feedUrls: [feedUrl],
  };
}
