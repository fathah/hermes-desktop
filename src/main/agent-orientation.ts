import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  EXTERNAL_SOURCE_LABELS,
  type ExternalSource,
} from "../shared/external-context";
import { parseUserMd } from "../shared/userMd";
import { getExternalContextSources } from "./config/desktop-store";
import { readMemory } from "./memory";
import { resolveSpsVaultDir } from "./sps-storage";

export const AGENT_ORIENTATION_FILE = "Agent Orientation.md";
const MAX_ORIENTATION_CONTEXT_CHARS = 1200;

export interface AgentOrientationBuildInput {
  generatedAt: Date;
  rules: string[];
  enabledExternalSources: string[];
}

export interface AgentOrientationResult {
  created: boolean;
  path: string;
}

function bulletList(items: string[], empty: string): string {
  const rows = items.map((item) => item.trim()).filter(Boolean);
  return (rows.length ? rows : [empty]).map((item) => `- ${item}`).join("\n");
}

export function buildAgentOrientationMarkdown(
  input: Partial<AgentOrientationBuildInput> = {},
): string {
  const generatedAt = input.generatedAt ?? new Date();
  const rules = input.rules ?? [];
  const enabledExternalSources = input.enabledExternalSources ?? [];
  return `---\ntitle: "Agent Orientation"\nkind: agent-orientation\ncontext: include\n---\n# Agent Orientation\n\nGenerated: ${generatedAt.toISOString()}\n\n## Workspace Rules\n${bulletList(
    rules,
    "No enabled USER.md rules were found when this page was generated.",
  )}\n\n## Capabilities\n- Read and write markdown pages in the SPS vault.\n- Search indexed notes, long-term memory, TELOS.md, and reviewed context pages.\n- Use tools only through the desktop approval and progress surfaces.\n\n## Allowed Sources\n${bulletList(
    enabledExternalSources,
    "No External Context sources are enabled.",
  )}\n\n## Privacy Boundaries\n- Action receipts and pulse entries are short, redacted records: no secrets, raw prompts, full URLs, snippets, or content payloads.\n- External Context is opt-in and redacted before it is indexed.\n- Daily Brief pages enter context only after their frontmatter says context: include.\n- Provider credentials stay in the existing desktop/keychain/provider paths, not in vault notes.\n`;
}

export function extractAgentOrientationContext(markdown: string): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!body) return "";
  return body.length <= MAX_ORIENTATION_CONTEXT_CHARS
    ? body
    : `${body.slice(0, MAX_ORIENTATION_CONTEXT_CHARS).trimEnd()}\n...`;
}

export function readAgentOrientationContext(vaultDir: string): string {
  try {
    const path = join(vaultDir, AGENT_ORIENTATION_FILE);
    if (!existsSync(path)) return "";
    return extractAgentOrientationContext(readFileSync(path, "utf-8"));
  } catch {
    return "";
  }
}

export function ensureAgentOrientation(
  profile?: string,
): AgentOrientationResult {
  const vaultDir = resolveSpsVaultDir(profile);
  const path = join(vaultDir, AGENT_ORIENTATION_FILE);
  if (existsSync(path)) return { created: false, path };

  let rules: string[] = [];
  try {
    const mem = readMemory(profile);
    rules = parseUserMd(mem.user.content)
      .rules.filter((rule) => rule.enabled)
      .map((rule) => rule.text);
  } catch {
    rules = [];
  }

  let enabledExternalSources: string[] = [];
  try {
    const cfg = getExternalContextSources();
    enabledExternalSources = (Object.keys(cfg) as ExternalSource[])
      .filter((source) => cfg[source])
      .map((source) => EXTERNAL_SOURCE_LABELS[source]);
  } catch {
    enabledExternalSources = [];
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    buildAgentOrientationMarkdown({
      generatedAt: new Date(),
      rules,
      enabledExternalSources,
    }),
    "utf-8",
  );
  return { created: true, path };
}
