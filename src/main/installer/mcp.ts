import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { escapeRegex, profileHome } from "../utils";

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export function listMcpServers(
  profile?: string,
): Array<{ name: string; type: string; enabled: boolean; detail: string }> {
  try {
    const configPath = join(profileHome(profile), "config.yaml");
    if (!existsSync(configPath)) return [];
    const content = readFileSync(configPath, "utf-8");
    // Simple YAML parse for mcp_servers section
    const match = content.match(/^mcp_servers:\s*\n((?:[ \t]+.+\n)*)/m);
    if (!match) return [];

    const servers: Array<{
      name: string;
      type: string;
      enabled: boolean;
      detail: string;
    }> = [];
    const block = match[1];
    // Each top-level key under mcp_servers is a server name (2-space indent)
    const nameRe = /^[ ]{2}(\w[\w-]*):\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(block)) !== null) {
      const name = m[1];
      // Extract following indented block for this server.
      // Find the next line at exactly 2-space indent (next server name).
      const start = m.index + m[0].length;
      const nextMatch = /\n {2}\w/g;
      nextMatch.lastIndex = start;
      const next = nextMatch.exec(block);
      const serverBlock = block.slice(start, next ? next.index : undefined);
      const hasUrl = /url:/.test(serverBlock);
      const hasCommand = /command:/.test(serverBlock);
      const enabledMatch = serverBlock.match(/enabled:\s*(true|false)/i);
      const enabled =
        enabledMatch === null || enabledMatch[1].toLowerCase() === "true";

      let detail = "";
      if (hasUrl) {
        const urlMatch = serverBlock.match(/url:\s*["']?([^\s"']+)/);
        detail = urlMatch?.[1] || "HTTP";
      } else if (hasCommand) {
        const cmdMatch = serverBlock.match(/command:\s*["']?([^\s"']+)/);
        detail = cmdMatch?.[1] || "stdio";
      }

      servers.push({
        name,
        type: hasUrl ? "http" : "stdio",
        enabled,
        detail,
      });
    }
    return servers;
  } catch {
    return [];
  }
}

/** Render one `mcp_servers` child as indented YAML (2/4/6-space nesting). */
export function renderMcpServerEntry(
  name: string,
  entry: McpServerEntry,
): string {
  const q = (v: string): string => JSON.stringify(v); // safe quoting/escaping
  const lines = [`  ${name}:`, `    command: ${q(entry.command)}`];
  if (entry.args.length) {
    lines.push(`    args:`);
    for (const arg of entry.args) lines.push(`      - ${q(arg)}`);
  }
  const envKeys = Object.keys(entry.env);
  if (envKeys.length) {
    lines.push(`    env:`);
    for (const key of envKeys) lines.push(`      ${key}: ${q(entry.env[key])}`);
  }
  lines.push(`    enabled: ${entry.enabled ? "true" : "false"}`);
  return `${lines.join("\n")}\n`;
}

/** Drop an existing `  <name>:` child sub-block (header + its indented body). */
export function removeMcpChild(block: string, name: string): string {
  const lines = block.split("\n");
  const childHeader = new RegExp(`^  ${escapeRegex(name)}:`);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (childHeader.test(lines[i])) {
      i++; // skip the header line
      // skip its body: blank lines or anything indented 3+ spaces (4/6-deep)
      while (
        i < lines.length &&
        (lines[i].trim() === "" || /^\s{3,}/.test(lines[i]))
      ) {
        i++;
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * Upsert one server under the top-level `mcp_servers:` block, replacing any
 * existing same-named child. Pure string surgery (testable without fs): when
 * the block is absent it is appended; otherwise the rendered entry is inserted
 * at the top of the existing block.
 */
export function upsertMcpServerInYaml(
  content: string,
  name: string,
  renderedEntry: string,
): string {
  const header = content.match(/^mcp_servers:[ \t]*\r?\n/m);
  if (!header || header.index === undefined) {
    const sep = content === "" || content.endsWith("\n") ? "" : "\n";
    return `${content}${sep}mcp_servers:\n${renderedEntry}`;
  }
  const blockStart = header.index + header[0].length;
  const after = content.slice(blockStart);
  const nextTop = after.match(/^\S/m); // next column-0 key ends the block
  const blockEnd =
    nextTop?.index !== undefined ? blockStart + nextTop.index : content.length;
  const block = removeMcpChild(content.slice(blockStart, blockEnd), name);
  return (
    content.slice(0, blockStart) +
    renderedEntry +
    block +
    content.slice(blockEnd)
  );
}

/** Write/replace an mcp_servers entry in the profile's config.yaml. */
export function writeMcpServerEntry(
  name: string,
  entry: McpServerEntry,
  profile?: string,
): void {
  const configPath = join(profileHome(profile), "config.yaml");
  const content = existsSync(configPath)
    ? readFileSync(configPath, "utf-8")
    : "";
  const rendered = renderMcpServerEntry(name, entry);
  writeFileSync(configPath, upsertMcpServerInYaml(content, name, rendered), {
    encoding: "utf-8",
  });
}

/** True iff an mcp_servers entry with this name already exists for the profile. */
export function hasMcpServer(name: string, profile?: string): boolean {
  return listMcpServers(profile).some((s) => s.name === name);
}

/** Absolute path to the bundled OpenAlex MCP server (resources are asar-unpacked). */
export function openAlexMcpServerPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      "app.asar.unpacked",
      "resources",
      "openalex-mcp.cjs",
    );
  }
  return join(app.getAppPath(), "resources", "openalex-mcp.cjs");
}
