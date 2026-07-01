import { safeHandle } from "./safe-handle";
import {
  crawlPublicUrl,
  getCrawl4AiInstallInstructions,
  getCrawl4AiStatus,
} from "../crawl4ai";
import { discoverSubstackFeed, parseRssFeedMetadata } from "../rss-discovery";
import { spsUnfurl } from "../sps-agent";
import { publicFetch } from "../security/network-policy";
import {
  routeSourceInput,
  type SourceIntakeResult,
  type SourceIntakeStatus,
} from "../../shared/source-intake";

function markdownForFeed(input: {
  title: string;
  url: string;
  siteUrl: string;
  description: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    input.description,
    "",
    "## Sources",
    `- [${input.title}](${input.siteUrl || input.url})`,
  ]
    .filter(Boolean)
    .join("\n");
}

function resultFromFeed(input: {
  sourceUrl: string;
  feedUrl: string;
  siteUrl: string;
  title: string;
  description: string;
}): SourceIntakeResult {
  const markdown = markdownForFeed({
    title: input.title,
    url: input.feedUrl,
    siteUrl: input.siteUrl,
    description: input.description,
  });
  return {
    ok: true,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.feedUrl,
    title: input.title,
    markdown,
    excerpt: input.description,
    links: [input.feedUrl, input.siteUrl].filter(Boolean),
    engine: "rss",
    fetchedAt: Date.now(),
  };
}

async function previewRssUrl(sourceUrl: string): Promise<SourceIntakeResult> {
  const response = await publicFetch(sourceUrl, {
    signal: AbortSignal.timeout(10000),
    headers: {
      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });
  if (!response.ok) {
    return {
      ok: false,
      sourceUrl,
      canonicalUrl: sourceUrl,
      title: "",
      markdown: "",
      excerpt: "",
      links: [],
      engine: "rss",
      fetchedAt: Date.now(),
      error: "That feed could not be loaded.",
    };
  }

  const metadata = parseRssFeedMetadata(await response.text());
  return resultFromFeed({
    sourceUrl,
    feedUrl: sourceUrl,
    siteUrl: metadata.siteUrl || sourceUrl,
    title: metadata.title || "RSS Feed",
    description: metadata.description,
  });
}

async function fallbackUnfurl(sourceUrl: string): Promise<SourceIntakeResult> {
  const meta = await spsUnfurl(sourceUrl);
  const markdown = [
    `# ${meta.title}`,
    "",
    meta.desc,
    "",
    "## Sources",
    `- [${meta.title}](${meta.url})`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    ok: true,
    sourceUrl,
    canonicalUrl: meta.url,
    title: meta.title,
    markdown,
    excerpt: meta.desc,
    links: [meta.url],
    engine: "unfurl",
    fetchedAt: Date.now(),
  };
}

export async function getSourceIntakeStatus(): Promise<SourceIntakeStatus> {
  const crawl = await getCrawl4AiStatus();
  return {
    checkedAt: Date.now(),
    capabilities: [
      {
        key: "rss",
        label: "RSS and Substack feeds",
        ready: true,
        message: "Built in",
      },
      {
        key: "crawl4ai",
        label: "Public webpage extraction",
        ready: crawl.installed && crawl.doctorOk,
        message:
          crawl.installed && crawl.doctorOk
            ? `Crawl4AI${crawl.version ? ` v${crawl.version}` : ""} ready`
            : crawl.error || "Crawl4AI is optional and not ready.",
      },
    ],
  };
}

export async function previewSourceUrl(
  rawUrl: string,
): Promise<SourceIntakeResult> {
  const route = routeSourceInput(rawUrl);
  if (route.kind === "blocked") {
    return {
      ok: false,
      sourceUrl: rawUrl,
      canonicalUrl: route.normalizedUrl,
      title: "",
      markdown: "",
      excerpt: "",
      links: [],
      engine: "unfurl",
      fetchedAt: Date.now(),
      error: route.error,
    };
  }

  if (route.kind === "substack") {
    const feed = await discoverSubstackFeed(route.normalizedUrl);
    if (feed.ok) {
      return resultFromFeed({
        sourceUrl: route.normalizedUrl,
        feedUrl: feed.feedUrl,
        siteUrl: feed.siteUrl,
        title: feed.title,
        description: feed.description,
      });
    }
    const crawl = await getCrawl4AiStatus();
    return crawl.installed && crawl.doctorOk
      ? crawlPublicUrl(route.normalizedUrl)
      : {
          ok: false,
          sourceUrl: route.normalizedUrl,
          canonicalUrl: route.normalizedUrl,
          title: "",
          markdown: "",
          excerpt: "",
          links: [],
          engine: "rss",
          fetchedAt: Date.now(),
          error: feed.error,
        };
  }

  if (route.kind === "rss") {
    return previewRssUrl(route.normalizedUrl);
  }

  const crawl = await getCrawl4AiStatus();
  return crawl.installed && crawl.doctorOk
    ? crawlPublicUrl(route.normalizedUrl)
    : fallbackUnfurl(route.normalizedUrl);
}

export function registerSourceIntakeIpc(): void {
  safeHandle("source-intake-status", () => getSourceIntakeStatus());
  safeHandle("source-intake-preview-url", (_event, url: string) =>
    previewSourceUrl(url),
  );
  safeHandle("source-intake-install-instructions", () =>
    getCrawl4AiInstallInstructions(),
  );
}
