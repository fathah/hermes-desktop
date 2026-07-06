import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { profilePaths, safeWriteFile } from "./utils";
import { getApiUrl, getRemoteAuthHeader, isRemoteMode } from "./hermes";
import { getApiServerKey } from "./config";
import { getEnhancedPath, HERMES_PYTHON, hermesCliArgs } from "./installer";

export type McpTransport = "http" | "stdio" | "unknown";

export interface McpServerInfo {
  name: string;
  type: McpTransport;
  transport: McpTransport;
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
  tools?: unknown;
}

export interface McpServerInput {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: string;
}

export interface McpCatalogEntry {
  name: string;
  description: string;
  source: string;
  transport: McpTransport;
  authType: string;
  requiredEnv: Array<{ name: string; prompt: string; required: boolean }>;
  needsInstall: boolean;
  installed: boolean;
  enabled: boolean;
}

export interface McpOperationResult {
  success: boolean;
  error?: string;
  background?: boolean;
  action?: string;
  tools?: Array<{ name: string; description: string }>;
}

interface McpBlock {
  startLine: number;
  endLine: number;
  lines: string[];
}

interface HermesCliResult {
  stdout: string;
  stderr: string;
}

const SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function configFilePath(profile?: string): string {
  return profilePaths(profile).configFile;
}

function readConfig(profile?: string): string {
  const file = configFilePath(profile);
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf-8");
}

function writeConfig(content: string, profile?: string): void {
  const file = configFilePath(profile);
  safeWriteFile(file, content.endsWith("\n") ? content : `${content}\n`);
}

function runHermesMcpCli(
  args: string[],
  profile?: string,
): Promise<HermesCliResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      HERMES_PYTHON,
      hermesCliArgs(["mcp", ...args]),
      {
        cwd: profilePaths(profile).home,
        env: {
          ...process.env,
          HERMES_HOME: profilePaths(profile).home,
          PATH: getEnhancedPath(),
        },
        timeout: 30000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message =
            String(stderr || "").trim() ||
            String(stdout || "").trim() ||
            error.message;
          reject(new Error(message));
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
    child.stdin?.end();
  });
}

function quoteYamlScalar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseYamlScalar(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    let out = "";
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\" && i + 1 < value.length) {
        out += value[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') return out;
      out += ch;
    }
    return out;
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end >= 0 ? value.slice(1, end) : value.slice(1);
  }
  const commentIdx = value.search(/\s+#/);
  if (commentIdx >= 0) value = value.slice(0, commentIdx);
  return value.trim();
}

function parseInlineList(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const body = value.slice(1, -1).trim();
  if (!body) return [];
  const items: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const ch of body) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote && ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  items.push(current.trim());
  return items.filter(Boolean);
}

function findMcpBlock(content: string): McpBlock | null {
  const lines = content.split(/\r?\n/);
  const startLine = lines.findIndex((line) =>
    /^mcp_servers\s*:\s*(?:#.*)?$/.test(line.trimEnd()),
  );
  if (startLine < 0) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\S[^:]*:/.test(line)) {
      endLine = i;
      break;
    }
  }

  return {
    startLine,
    endLine,
    lines: lines.slice(startLine, endLine),
  };
}

function serverBlocks(lines: string[]): Array<{
  name: string;
  lines: string[];
  startOffset: number;
}> {
  const blocks: Array<{ name: string; lines: string[]; startOffset: number }> =
    [];
  let current: { name: string; lines: string[]; startOffset: number } | null =
    null;

  const pushCurrent = (): void => {
    if (!current) return;
    while (
      current.lines.length > 1 &&
      current.lines[current.lines.length - 1].trim() === ""
    ) {
      current.lines.pop();
    }
    blocks.push(current);
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /^ {2}([A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*(?:#.*)?$/,
    );
    if (match) {
      pushCurrent();
      current = { name: match[1], lines: [line], startOffset: i };
      continue;
    }
    if (current) current.lines.push(line);
  }

  pushCurrent();
  return blocks;
}

export function parseMcpServersFromConfig(content: string): McpServerInfo[] {
  const block = findMcpBlock(content);
  if (!block) return [];

  return serverBlocks(block.lines).map(({ name, lines }) => {
    const cfg = parseServerBlock(lines);
    const type: McpTransport = cfg.url
      ? "http"
      : cfg.command
        ? "stdio"
        : "unknown";
    return {
      name,
      type,
      transport: type,
      enabled: cfg.enabled !== false,
      detail: cfg.url || cfg.command || "",
      url: cfg.url,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      auth: cfg.auth,
      tools: cfg.tools,
    };
  });
}

function parseServerBlock(lines: string[]): {
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
  enabled?: boolean;
  tools?: unknown;
} {
  const result: {
    url?: string;
    command?: string;
    args: string[];
    env: Record<string, string>;
    auth?: string;
    enabled?: boolean;
    tools?: unknown;
  } = { args: [], env: {} };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const scalar = line.match(/^ {4}([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!scalar) continue;
    const key = scalar[1];
    const raw = scalar[2] || "";

    if (key === "url") result.url = parseYamlScalar(raw);
    else if (key === "command") result.command = parseYamlScalar(raw);
    else if (key === "auth") result.auth = parseYamlScalar(raw);
    else if (key === "enabled") {
      result.enabled = raw.trim().toLowerCase() !== "false";
    } else if (key === "args") {
      if (raw.trim().startsWith("[")) {
        result.args = parseInlineList(raw);
      } else {
        const args: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const item = lines[j].match(/^ {6}-\s*(.*)$/);
          if (!item) break;
          args.push(parseYamlScalar(item[1]));
          i = j;
        }
        result.args = args;
      }
    } else if (key === "env" && !raw.trim()) {
      const env: Record<string, string> = {};
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(
          /^ {6}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/,
        );
        if (!item) break;
        env[item[1]] = parseYamlScalar(item[2]);
        i = j;
      }
      result.env = env;
    } else if (key === "tools") {
      result.tools = raw.trim() ? parseYamlScalar(raw) : {};
    }
  }

  return result;
}

function validateServerInput(input: McpServerInput):
  | {
      ok: true;
      value: Required<Pick<McpServerInput, "name" | "type">> &
        Omit<McpServerInput, "name" | "type">;
    }
  | { ok: false; error: string } {
  const name = (input.name || "").trim();
  if (!SERVER_NAME_RE.test(name)) {
    return {
      ok: false,
      error:
        "Use a server name that starts with a letter or number and contains only letters, numbers, underscores, or hyphens.",
    };
  }

  if (input.type !== "http" && input.type !== "stdio") {
    return { ok: false, error: "Choose HTTP or stdio transport." };
  }

  if (input.type === "http") {
    const url = (input.url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return {
        ok: false,
        error: "HTTP MCP servers need an http:// or https:// URL.",
      };
    }
    return {
      ok: true,
      value: { ...input, name, type: input.type, url, args: [], env: {} },
    };
  }

  const command = (input.command || "").trim();
  if (!command)
    return { ok: false, error: "stdio MCP servers need a command." };

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.env || {})) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    if (!ENV_NAME_RE.test(trimmedKey)) {
      return {
        ok: false,
        error: `Invalid env var name "${trimmedKey}".`,
      };
    }
    env[trimmedKey] = String(value ?? "");
  }

  return {
    ok: true,
    value: {
      ...input,
      name,
      type: input.type,
      command,
      args: (input.args || []).map((arg) => arg.trim()).filter(Boolean),
      env,
    },
  };
}

function renderServerBlock(input: McpServerInput): string[] {
  const lines = [`  ${input.name}:`];
  if (input.type === "http") {
    lines.push(`    url: ${quoteYamlScalar(input.url || "")}`);
    if (input.auth) lines.push(`    auth: ${quoteYamlScalar(input.auth)}`);
    return lines;
  }

  lines.push(`    command: ${quoteYamlScalar(input.command || "")}`);
  if (input.args?.length) {
    lines.push("    args:");
    for (const arg of input.args) lines.push(`      - ${quoteYamlScalar(arg)}`);
  }
  const envEntries = Object.entries(input.env || {}).filter(([key]) => key);
  if (envEntries.length) {
    lines.push("    env:");
    for (const [key, value] of envEntries) {
      lines.push(`      ${key}: ${quoteYamlScalar(value)}`);
    }
  }
  return lines;
}

export function upsertMcpServerInConfig(
  content: string,
  input: McpServerInput,
): string {
  const block = findMcpBlock(content);
  const rendered = renderServerBlock(input);
  const lines = content ? content.split(/\r?\n/) : [];

  if (!block) {
    const prefix =
      lines.length && lines[lines.length - 1] === ""
        ? lines.slice(0, -1)
        : lines;
    return [
      ...prefix,
      ...(prefix.length ? [""] : []),
      "mcp_servers:",
      ...rendered,
      "",
    ].join("\n");
  }

  const nextBlockLines = ["mcp_servers:"];
  let replaced = false;
  for (const existing of serverBlocks(block.lines)) {
    if (existing.name === input.name) {
      nextBlockLines.push(...rendered);
      replaced = true;
    } else {
      nextBlockLines.push(...existing.lines);
    }
  }
  if (!replaced) nextBlockLines.push(...rendered);
  if (block.endLine < lines.length && lines[block.endLine]?.trim() !== "") {
    nextBlockLines.push("");
  }

  lines.splice(
    block.startLine,
    block.endLine - block.startLine,
    ...nextBlockLines,
  );
  return lines.join("\n");
}

export function removeMcpServerFromConfig(
  content: string,
  name: string,
): string {
  const block = findMcpBlock(content);
  if (!block) return content;

  const remaining = serverBlocks(block.lines).filter(
    (server) => server.name !== name,
  );
  const lines = content.split(/\r?\n/);
  if (remaining.length === serverBlocks(block.lines).length) return content;

  if (remaining.length === 0) {
    lines.splice(block.startLine, block.endLine - block.startLine);
  } else {
    const nextBlockLines = [
      "mcp_servers:",
      ...remaining.flatMap((server) => server.lines),
    ];
    if (block.endLine < lines.length && lines[block.endLine]?.trim() !== "") {
      nextBlockLines.push("");
    }
    lines.splice(
      block.startLine,
      block.endLine - block.startLine,
      ...nextBlockLines,
    );
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function setMcpServerEnabledInConfig(
  content: string,
  name: string,
  enabled: boolean,
): string {
  const block = findMcpBlock(content);
  if (!block) return content;
  const lines = content.split(/\r?\n/);
  const servers = serverBlocks(block.lines);

  for (const server of servers) {
    const start = block.startLine + server.startOffset;
    const end = start + server.lines.length;
    if (server.name === name) {
      const enabledIdx = server.lines.findIndex((line) =>
        /^ {4}enabled\s*:/.test(line),
      );
      if (enabledIdx >= 0) {
        lines[start + enabledIdx] =
          `    enabled: ${enabled ? "true" : "false"}`;
      } else {
        lines.splice(end, 0, `    enabled: ${enabled ? "true" : "false"}`);
      }
      return lines.join("\n");
    }
  }
  return content;
}

function normalizeRemoteServer(raw: Record<string, unknown>): McpServerInfo {
  const transport =
    raw.transport === "http" || raw.type === "http"
      ? "http"
      : raw.transport === "stdio" || raw.type === "stdio"
        ? "stdio"
        : "unknown";
  const url = typeof raw.url === "string" ? raw.url : undefined;
  const command = typeof raw.command === "string" ? raw.command : undefined;
  return {
    name: String(raw.name || ""),
    type: transport,
    transport,
    enabled: raw.enabled !== false,
    detail: url || command || "",
    url,
    command,
    args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    env:
      raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? Object.fromEntries(
            Object.entries(raw.env as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v ?? ""),
            ]),
          )
        : {},
    auth: typeof raw.auth === "string" ? raw.auth : undefined,
    tools: raw.tools,
  };
}

export function parseCatalogOutput(output: string): McpCatalogEntry[] {
  const entries: McpCatalogEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 3) continue;
    const [name, status, ...descriptionParts] = parts;
    if (
      !name ||
      name === "Name" ||
      /^-+$/.test(name) ||
      name.toLowerCase() === "install:"
    ) {
      continue;
    }
    const installed = /installed|configured|enabled/i.test(status);
    entries.push({
      name,
      description: descriptionParts.join(" "),
      source: "hermes-agent",
      transport: "unknown",
      authType: "",
      requiredEnv: [],
      needsInstall: !installed,
      installed,
      enabled: installed,
    });
  }
  return entries;
}

export function parseMcpTestTools(
  output: string,
): Array<{ name: string; description: string }> {
  const tools: Array<{ name: string; description: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:[-*]\s*)?([A-Za-z_][\w.-]*)\s{2,}(.+)$/);
    if (match && !/^(name|tool)$/i.test(match[1])) {
      tools.push({ name: match[1], description: match[2].trim() });
    }
  }
  return tools;
}

async function mcpApi<T>(
  path: string,
  init: RequestInit = {},
  profile?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    ...getRemoteAuthHeader(),
    ...((init.headers as Record<string, string>) || {}),
  };
  if (!isRemoteMode()) {
    const apiServerKey = getApiServerKey(profile);
    if (apiServerKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${apiServerKey}`;
    }
  }
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${getApiUrl(profile)}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail || detail;
    } catch {
      // leave status text
    }
    const err = new Error(detail || `HTTP ${response.status}`);
    Object.assign(err, { status: response.status });
    throw err;
  }
  const text = await response.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: unknown }).status === 404
  );
}

function unsupportedMcpApiMessage(
  feature: "catalog" | "install" | "test",
): string {
  if (feature === "catalog") {
    return "MCP catalog is not available from this Hermes Agent gateway yet. Add a custom MCP server manually.";
  }
  if (feature === "install") {
    return "MCP catalog install is not available from this Hermes Agent gateway yet. Add a custom MCP server manually.";
  }
  return "MCP server testing is not available from this Hermes Agent gateway yet.";
}

export async function listMcpServers(
  profile?: string,
): Promise<McpServerInfo[]> {
  if (isRemoteMode()) {
    const data = await mcpApi<{ servers?: Record<string, unknown>[] }>(
      "/api/mcp/servers",
      {},
      profile,
    );
    return (data.servers || []).map(normalizeRemoteServer);
  }
  return parseMcpServersFromConfig(readConfig(profile));
}

export async function addMcpServer(
  input: McpServerInput,
  profile?: string,
): Promise<McpOperationResult> {
  const validated = validateServerInput(input);
  if (!validated.ok) return { success: false, error: validated.error };

  try {
    if (isRemoteMode()) {
      await mcpApi(
        "/api/mcp/servers",
        {
          method: "POST",
          body: JSON.stringify({
            name: validated.value.name,
            url:
              validated.value.type === "http" ? validated.value.url : undefined,
            command:
              validated.value.type === "stdio"
                ? validated.value.command
                : undefined,
            args: validated.value.args || [],
            env: validated.value.env || {},
            auth: validated.value.auth,
          }),
        },
        profile,
      );
      return { success: true };
    }

    const existing = parseMcpServersFromConfig(readConfig(profile));
    if (existing.some((server) => server.name === validated.value.name)) {
      return {
        success: false,
        error: `MCP server "${validated.value.name}" already exists.`,
      };
    }
    writeConfig(
      upsertMcpServerInConfig(readConfig(profile), validated.value),
      profile,
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Failed to add MCP server.",
    };
  }
}

export async function removeMcpServer(
  name: string,
  profile?: string,
): Promise<McpOperationResult> {
  try {
    if (isRemoteMode()) {
      await mcpApi(
        `/api/mcp/servers/${encodeURIComponent(name)}`,
        {
          method: "DELETE",
        },
        profile,
      );
      return { success: true };
    }
    writeConfig(removeMcpServerFromConfig(readConfig(profile), name), profile);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Failed to remove MCP server.",
    };
  }
}

export async function setMcpServerEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): Promise<McpOperationResult> {
  try {
    if (isRemoteMode()) {
      await mcpApi(
        `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
        { method: "PUT", body: JSON.stringify({ enabled }) },
        profile,
      );
      return { success: true };
    }
    writeConfig(
      setMcpServerEnabledInConfig(readConfig(profile), name, enabled),
      profile,
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Failed to update MCP server.",
    };
  }
}

export async function testMcpServer(
  name: string,
  profile?: string,
): Promise<McpOperationResult> {
  try {
    if (!isRemoteMode()) {
      const result = await runHermesMcpCli(["test", name], profile);
      return {
        success: true,
        tools: parseMcpTestTools(result.stdout),
      };
    }

    const data = await mcpApi<{
      ok?: boolean;
      error?: string;
      tools?: Array<{ name: string; description: string }>;
    }>(
      `/api/mcp/servers/${encodeURIComponent(name)}/test`,
      { method: "POST" },
      profile,
    );
    return {
      success: data.ok !== false,
      error: data.error,
      tools: data.tools || [],
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return { success: false, error: unsupportedMcpApiMessage("test") };
    }
    return {
      success: false,
      error: (err as Error).message || "Failed to test MCP server.",
    };
  }
}

export async function listMcpCatalog(profile?: string): Promise<{
  entries: McpCatalogEntry[];
  diagnostics: unknown[];
  error?: string;
}> {
  try {
    if (!isRemoteMode()) {
      const result = await runHermesMcpCli(["catalog"], profile);
      return {
        entries: parseCatalogOutput(result.stdout),
        diagnostics: result.stderr.trim() ? [result.stderr.trim()] : [],
      };
    }

    const data = await mcpApi<{
      entries?: Array<Record<string, unknown>>;
      diagnostics?: unknown[];
    }>("/api/mcp/catalog", {}, profile);
    return {
      entries: (data.entries || []).map((entry) => ({
        name: String(entry.name || ""),
        description: String(entry.description || ""),
        source: String(entry.source || ""),
        transport:
          entry.transport === "stdio" || entry.transport === "http"
            ? entry.transport
            : "unknown",
        authType: String(entry.auth_type || "none"),
        requiredEnv: Array.isArray(entry.required_env)
          ? entry.required_env.map((env) => {
              const item = env as Record<string, unknown>;
              return {
                name: String(item.name || ""),
                prompt: String(item.prompt || ""),
                required: item.required !== false,
              };
            })
          : [],
        needsInstall: Boolean(entry.needs_install),
        installed: Boolean(entry.installed),
        enabled: Boolean(entry.enabled),
      })),
      diagnostics: data.diagnostics || [],
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return {
        entries: [],
        diagnostics: [],
        error: unsupportedMcpApiMessage("catalog"),
      };
    }
    return {
      entries: [],
      diagnostics: [],
      error: (err as Error).message || "MCP catalog is unavailable.",
    };
  }
}

export async function installMcpCatalogEntry(
  name: string,
  env: Record<string, string> = {},
  profile?: string,
): Promise<McpOperationResult> {
  try {
    if (!isRemoteMode()) {
      await runHermesMcpCli(["install", name], profile);
      return { success: true };
    }

    const data = await mcpApi<{
      ok?: boolean;
      background?: boolean;
      action?: string;
    }>(
      "/api/mcp/catalog/install",
      {
        method: "POST",
        body: JSON.stringify({ name, env, enable: true }),
      },
      profile,
    );
    return {
      success: data.ok !== false,
      background: Boolean(data.background),
      action: data.action,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return { success: false, error: unsupportedMcpApiMessage("install") };
    }
    return {
      success: false,
      error: (err as Error).message || "Failed to install MCP server.",
    };
  }
}
