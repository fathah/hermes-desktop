import { spawn } from "child_process";
import {
  routeSourceInput,
  type SourceIntakeResult,
} from "../shared/source-intake";

export interface Crawl4AiCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type Crawl4AiCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<Crawl4AiCommandResult>;

export interface Crawl4AiStatus {
  installed: boolean;
  version: string | null;
  doctorOk: boolean;
  checkedAt: number;
  error?: string;
}

const CRAWL_TIMEOUT_MS = 45_000;

export const runCrawl4AiCommand: Crawl4AiCommandRunner = (
  command,
  args,
  timeoutMs,
) =>
  new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        NO_COLOR: "1",
        CRAWL4AI_HOOKS_ENABLED: "false",
      },
    });
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (result: Crawl4AiCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, stdout, stderr: "Timed out" });
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", () => {
      finish({ ok: false, stdout, stderr: "Command failed" });
    });
    proc.on("close", (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
  });

function parseVersion(output: string): string | null {
  return output.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

function firstMarkdownHeading(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "";
}

function excerpt(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_\-[\]()`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function extractMarkdownLinks(markdown: string): string[] {
  const links = new Set<string>();
  for (const match of markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    links.add(match[1]);
  }
  return Array.from(links).slice(0, 40);
}

export async function getCrawl4AiStatusFromRunner(
  runner: Crawl4AiCommandRunner,
): Promise<Crawl4AiStatus> {
  const version = await runner("crwl", ["--version"], 8000);
  if (!version.ok) {
    return {
      installed: false,
      version: null,
      doctorOk: false,
      checkedAt: Date.now(),
      error: "Crawl4AI CLI is not installed.",
    };
  }

  const doctor = await runner("crawl4ai-doctor", [], 30000);
  return {
    installed: true,
    version: parseVersion(version.stdout || version.stderr),
    doctorOk: doctor.ok,
    checkedAt: Date.now(),
    error: doctor.ok ? undefined : "Crawl4AI doctor failed.",
  };
}

export function getCrawl4AiStatus(): Promise<Crawl4AiStatus> {
  return getCrawl4AiStatusFromRunner(runCrawl4AiCommand);
}

export function getCrawl4AiInstallInstructions(): string {
  return [
    "Optional public webpage extraction setup:",
    "1. Install Crawl4AI in an isolated user tool environment:",
    "   pipx install crawl4ai",
    "2. Run setup:",
    "   crawl4ai-setup",
    "3. Verify:",
    "   crawl4ai-doctor",
    "",
    "Hermes uses Crawl4AI only for public HTTPS pages. It does not import cookies, use saved browser profiles, enable hooks, configure proxies, or run the Docker API server.",
  ].join("\n");
}

export async function crawlPublicUrlWithRunner(
  rawUrl: string,
  runner: Crawl4AiCommandRunner,
): Promise<SourceIntakeResult> {
  const route = routeSourceInput(rawUrl);
  if (route.kind !== "webpage" && route.kind !== "substack") {
    return {
      ok: false,
      sourceUrl: rawUrl,
      canonicalUrl: route.normalizedUrl,
      title: "",
      markdown: "",
      excerpt: "",
      links: [],
      engine: "crawl4ai",
      fetchedAt: Date.now(),
      error: route.error || "Crawl4AI only handles public webpage URLs.",
    };
  }

  const result = await runner(
    "crwl",
    [route.normalizedUrl, "-o", "markdown"],
    CRAWL_TIMEOUT_MS,
  );
  if (!result.ok || !result.stdout.trim()) {
    return {
      ok: false,
      sourceUrl: route.normalizedUrl,
      canonicalUrl: route.normalizedUrl,
      title: "",
      markdown: "",
      excerpt: "",
      links: [],
      engine: "crawl4ai",
      fetchedAt: Date.now(),
      error: "Crawl4AI could not extract that public page.",
    };
  }

  const markdown = result.stdout.trim();
  const host = new URL(route.normalizedUrl).hostname.replace(/^www\./, "");
  return {
    ok: true,
    sourceUrl: route.normalizedUrl,
    canonicalUrl: route.normalizedUrl,
    title: firstMarkdownHeading(markdown) || host,
    markdown,
    excerpt: excerpt(markdown),
    links: extractMarkdownLinks(markdown),
    engine: "crawl4ai",
    fetchedAt: Date.now(),
  };
}

export function crawlPublicUrl(rawUrl: string): Promise<SourceIntakeResult> {
  return crawlPublicUrlWithRunner(rawUrl, runCrawl4AiCommand);
}
