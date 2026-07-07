import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const DAILY_BRIEF_RE = /^Daily Brief - \d{4}-\d{2}-\d{2}\.md$/;
const MAX_DAILY_BRIEF_CONTEXT_CHARS = 1200;
const MAX_DAILY_BRIEF_DELIVERY_CHARS = 700;

export function dailyBriefFileName(date: Date): string {
  return `Daily Brief - ${date.toISOString().slice(0, 10)}.md`;
}

export function buildDailyBriefMarkdown(input: {
  date: Date;
  body: string;
}): string {
  const day = input.date.toISOString().slice(0, 10);
  const title = `Daily Brief - ${day}`;
  const body = input.body.trim() || `# ${title}\n\nNo brief generated.`;
  return `---\ntitle: "${title}"\nkind: daily-brief\ncontext: review\n---\n${body}\n`;
}

export function dailyBriefDeliveryBody(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const plain = withoutFrontmatter
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, (match) => {
      const label = match.match(/^\[([^\]]+)\]/)?.[1];
      return label || match;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Daily Brief is ready for review.";
  return plain.length <= MAX_DAILY_BRIEF_DELIVERY_CHARS
    ? plain
    : `${plain.slice(0, MAX_DAILY_BRIEF_DELIVERY_CHARS).trimEnd()}...`;
}

export function extractOptedInDailyBrief(markdown: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return "";
  const frontmatter = match[1] ?? "";
  if (!/^context:\s*include\s*$/im.test(frontmatter)) return "";
  const body = (match[2] ?? "").trim();
  if (!body) return "";
  return body.length <= MAX_DAILY_BRIEF_CONTEXT_CHARS
    ? body
    : `${body.slice(0, MAX_DAILY_BRIEF_CONTEXT_CHARS).trimEnd()}\n...`;
}

export function readLatestOptedInDailyBrief(vaultDir: string): string {
  try {
    if (!existsSync(vaultDir)) return "";
    const names = readdirSync(vaultDir)
      .filter((name) => DAILY_BRIEF_RE.test(name))
      .sort()
      .reverse();
    for (const name of names) {
      const text = extractOptedInDailyBrief(
        readFileSync(join(vaultDir, name), "utf-8"),
      );
      if (text) return text;
    }
  } catch {
    return "";
  }
  return "";
}
