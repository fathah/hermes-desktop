import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { app } from "electron";
import { escapeRegex, profileHome } from "../utils";
import { admitMcpCapability } from "../capability-risk-store";

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface NotebookLmMcpEntry {
  command: string;
  args: string[];
  source: "env" | "user-bin" | "path" | "claude-code";
  commandFound: boolean;
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

export function listMcpServerEntries(profile?: string): Array<{
  name: string;
  type: "stdio" | "http";
  enabled: boolean;
  detail: string;
  entry: McpServerEntry;
}> {
  try {
    const configPath = join(profileHome(profile), "config.yaml");
    if (!existsSync(configPath)) return [];
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^mcp_servers:\s*\n((?:[ \t]+.+\n)*)/m);
    if (!match) return [];

    const servers: Array<{
      name: string;
      type: "stdio" | "http";
      enabled: boolean;
      detail: string;
      entry: McpServerEntry;
    }> = [];
    const block = match[1];
    const nameRe = /^[ ]{2}(\w[\w-]*):\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(block)) !== null) {
      const name = m[1];
      const start = m.index + m[0].length;
      const nextMatch = /\n {2}\w/g;
      nextMatch.lastIndex = start;
      const next = nextMatch.exec(block);
      const serverBlock = block.slice(start, next ? next.index : undefined);
      const scalar = (key: string): string | undefined => {
        const found = serverBlock.match(
          new RegExp(`${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"']+))`),
        );
        return found?.[1] || found?.[2] || found?.[3];
      };
      const listItem = (line: string): string | undefined => {
        const found = line.match(/^\s*-\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/);
        return found?.[1] || found?.[2] || found?.[3];
      };
      const commandValue = scalar("command");
      const urlValue = scalar("url");
      const enabledMatch = serverBlock.match(/enabled:\s*(true|false)/i);
      const argsMatch = serverBlock.match(/args:\s*\n((?:[ \t]{6}- .+\n?)*)/);
      const envMatch = serverBlock.match(
        /env:\s*\n((?:[ \t]{6}\w[\w-]*: .+\n?)*)/,
      );
      const args =
        argsMatch?.[1]
          .split("\n")
          .map(listItem)
          .filter((arg): arg is string => !!arg) || [];
      const env: Record<string, string> = {};
      if (envMatch?.[1]) {
        for (const line of envMatch[1].split("\n")) {
          const pair = line.match(/^\s*(\w[\w-]*):\s*["']?(.*?)["']?\s*$/);
          if (pair) env[pair[1]] = pair[2];
        }
      }
      const enabled =
        enabledMatch === null || enabledMatch[1].toLowerCase() === "true";
      const type: "stdio" | "http" = urlValue ? "http" : "stdio";
      const command = commandValue || "";
      const detail = urlValue || command || type;
      servers.push({
        name,
        type,
        enabled,
        detail,
        entry: {
          command: command || urlValue || "",
          args,
          env,
          enabled,
        },
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
  const admitted = admitMcpCapability(name, entry, profile);
  const rendered = renderMcpServerEntry(name, admitted);
  writeFileSync(configPath, upsertMcpServerInYaml(content, name, rendered), {
    encoding: "utf-8",
  });
}

export function setMcpServerEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): boolean {
  const current = listMcpServerEntries(profile).find((s) => s.name === name);
  if (!current) return false;
  const entry = { ...current.entry, enabled };
  const configPath = join(profileHome(profile), "config.yaml");
  const content = existsSync(configPath)
    ? readFileSync(configPath, "utf-8")
    : "";
  writeFileSync(
    configPath,
    upsertMcpServerInYaml(content, name, renderMcpServerEntry(name, entry)),
    { encoding: "utf-8" },
  );
  return true;
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

/** User-installed NotebookLM MCP command. Auth stays with the user's nlm setup. */
export function notebookLmMcpCommand(): string {
  return notebookLmMcpEntry().command;
}

export function readClaudeCodeNotebookLmMcpEntry(
  configPath = join(homedir(), ".claude.json"),
): { command: string; args: string[] } | null {
  try {
    if (!existsSync(configPath)) return null;
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as {
      mcpServers?: Record<
        string,
        { command?: unknown; args?: unknown; env?: unknown }
      >;
    };
    const server = raw.mcpServers?.["notebooklm-mcp"];
    if (!server || typeof server.command !== "string") return null;
    const command = server.command.trim();
    if (!command) return null;
    const args = Array.isArray(server.args)
      ? server.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    return { command, args };
  } catch {
    return null;
  }
}

export function commandExists(command: string): boolean {
  if (!command.trim()) return false;
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  try {
    const resolver = process.platform === "win32" ? "where" : "which";
    execFileSync(resolver, [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function notebookLmCliCommand(): string | null {
  const userBin = join(homedir(), ".local", "bin", "nlm");
  if (existsSync(userBin)) return userBin;
  return commandExists("nlm") ? "nlm" : null;
}

/** User-installed NotebookLM MCP entry. Claude Code config is read-only fallback. */
export function notebookLmMcpEntry(): NotebookLmMcpEntry {
  const envCommand = process.env.HERMES_NOTEBOOKLM_MCP_COMMAND?.trim();
  if (envCommand) {
    return {
      command: envCommand,
      args: [],
      source: "env",
      commandFound: commandExists(envCommand),
    };
  }

  const userBin = join(homedir(), ".local", "bin", "notebooklm-mcp");
  if (existsSync(userBin)) {
    return {
      command: userBin,
      args: [],
      source: "user-bin",
      commandFound: true,
    };
  }

  if (commandExists("notebooklm-mcp")) {
    return {
      command: "notebooklm-mcp",
      args: [],
      source: "path",
      commandFound: true,
    };
  }

  const claudeEntry = readClaudeCodeNotebookLmMcpEntry();
  if (claudeEntry && commandExists(claudeEntry.command)) {
    return {
      ...claudeEntry,
      source: "claude-code",
      commandFound: true,
    };
  }

  return {
    command: envCommand || "notebooklm-mcp",
    args: [],
    source: envCommand ? "env" : "path",
    commandFound: false,
  };
}

/** Absolute path to the bundled External Context MCP server (asar-unpacked). */
export function externalContextMcpServerPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      "app.asar.unpacked",
      "resources",
      "external-context-mcp.cjs",
    );
  }
  return join(app.getAppPath(), "resources", "external-context-mcp.cjs");
}

/** Absolute path to the bundled Desktop MCP server (asar-unpacked). */
export function desktopMcpServerPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      "app.asar.unpacked",
      "resources",
      "desktop-mcp.cjs",
    );
  }
  return join(app.getAppPath(), "resources", "desktop-mcp.cjs");
}

/** Ensure the Desktop MCP server is registered for the profile. */
export function ensureDesktopMcpRegistered(profile?: string): {
  registered: boolean;
  alreadyPresent: boolean;
} {
  const name = "desktop";
  if (hasMcpServer(name, profile)) {
    return { registered: true, alreadyPresent: true };
  }
  const serverPath = desktopMcpServerPath();
  if (!existsSync(serverPath)) {
    return { registered: false, alreadyPresent: false };
  }
  writeMcpServerEntry(
    name,
    {
      command: process.execPath,
      args: [serverPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      enabled: true,
    },
    profile,
  );
  return { registered: true, alreadyPresent: false };
}
