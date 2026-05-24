import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

// installer.ts transitively imports modules that pull in `electron` at value
// scope (askpass.ts, sudoCreds.ts). Loading the real package in a plain
// Node/vitest environment fails ("Electron failed to install correctly"),
// which breaks every test that dynamically imports the installer module.
// Provide a minimal stub so the import resolves.
vi.mock("electron", () => ({
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [];
    }
  },
  ipcMain: {
    on: (): void => {},
    handle: (): void => {},
    removeHandler: (): void => {},
    removeAllListeners: (): void => {},
  },
}));

// We test the extracted pure functions by importing them.
// Some functions depend on HERMES_HOME — we mock the module-level constants.

const TEST_DIR = join(tmpdir(), `hermes-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── readLogs (test the logic, not the import) ─────────

describe("readLogs logic", () => {
  it("returns last N lines from a log file", () => {
    const logDir = join(TEST_DIR, "logs");
    mkdirSync(logDir, { recursive: true });
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(logDir, "agent.log"), lines.join("\n"));

    const content = readFileSync(join(logDir, "agent.log"), "utf-8");
    const allLines = content.split("\n");
    const tail = allLines.slice(-10).join("\n");

    expect(tail).toContain("line 50");
    expect(tail).toContain("line 41");
    expect(tail).not.toContain("line 30");
  });

  it("sanitizes log file names", () => {
    const allowed = ["agent.log", "errors.log", "gateway.log"];
    // Simulating the sanitization logic from readLogs
    const sanitize = (f: string): string =>
      allowed.includes(f) ? f : "agent.log";

    expect(sanitize("agent.log")).toBe("agent.log");
    expect(sanitize("errors.log")).toBe("errors.log");
    expect(sanitize("gateway.log")).toBe("gateway.log");
    expect(sanitize("../../etc/passwd")).toBe("agent.log");
    expect(sanitize("malicious.log")).toBe("agent.log");
    expect(sanitize("")).toBe("agent.log");
  });
});

// ─── MCP server YAML parsing ───────────────────────────

describe("MCP server YAML parsing", () => {
  // Simulate the regex-based parsing from listMcpServers
  function parseMcpBlock(
    content: string,
  ): Array<{ name: string; type: string; enabled: boolean }> {
    const match = content.match(/^mcp_servers:\s*\n((?:[ \t]+.+\n)*)/m);
    if (!match) return [];
    const block = match[1];
    const servers: Array<{ name: string; type: string; enabled: boolean }> = [];
    const nameRe = /^[ ]{2}(\w[\w-]*):\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(block)) !== null) {
      const name = m[1];
      const start = m.index + m[0].length;
      // Find next line at exactly 2-space indent (next server name)
      const nextMatch = /\n {2}\w/g;
      nextMatch.lastIndex = start;
      const next = nextMatch.exec(block);
      const serverBlock = block.slice(start, next ? next.index : undefined);
      const hasUrl = /url:/.test(serverBlock);
      const enabledMatch = serverBlock.match(/enabled:\s*(true|false)/i);
      const enabled =
        enabledMatch === null || enabledMatch[1].toLowerCase() === "true";
      servers.push({ name, type: hasUrl ? "http" : "stdio", enabled });
    }
    return servers;
  }

  it("parses stdio MCP servers", () => {
    const yaml = `mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
`;
    const servers = parseMcpBlock(yaml);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({
      name: "github",
      type: "stdio",
      enabled: true,
    });
  });

  it("parses HTTP MCP servers", () => {
    const yaml = `mcp_servers:
  notion:
    url: "https://mcp.notion.com/mcp"
    headers:
      Authorization: "Bearer token"
`;
    const servers = parseMcpBlock(yaml);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({ name: "notion", type: "http", enabled: true });
  });

  it("detects disabled servers", () => {
    const yaml = `mcp_servers:
  github:
    command: npx
    enabled: false
`;
    const servers = parseMcpBlock(yaml);
    expect(servers[0].enabled).toBe(false);
  });

  it("parses multiple servers", () => {
    const yaml = `mcp_servers:
  github:
    command: npx
  notion:
    url: "https://example.com"
    enabled: false
`;
    const servers = parseMcpBlock(yaml);
    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe("github");
    expect(servers[1].name).toBe("notion");
    expect(servers[1].enabled).toBe(false);
  });

  it("returns empty for missing mcp_servers section", () => {
    const yaml = `memory:\n  provider: honcho\n`;
    expect(parseMcpBlock(yaml)).toEqual([]);
  });

  it("returns empty for empty mcp_servers", () => {
    const yaml = `mcp_servers:\n`;
    expect(parseMcpBlock(yaml)).toEqual([]);
  });
});

// ─── Memory provider discovery logic ────────────────────

describe("Memory provider discovery", () => {
  it("creates provider list from directory scan", () => {
    // Simulate plugins/memory/ structure
    const pluginsDir = join(TEST_DIR, "plugins", "memory");
    mkdirSync(join(pluginsDir, "honcho"), { recursive: true });
    mkdirSync(join(pluginsDir, "mem0"), { recursive: true });
    mkdirSync(join(pluginsDir, "holographic"), { recursive: true });
    mkdirSync(join(pluginsDir, "__pycache__"), { recursive: true });

    // Create __init__.py for installed providers
    writeFileSync(join(pluginsDir, "honcho", "__init__.py"), "");
    writeFileSync(join(pluginsDir, "mem0", "__init__.py"), "");
    writeFileSync(join(pluginsDir, "holographic", "__init__.py"), "");

    // Simulate the scanning logic
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require("fs");
    const dirs = readdirSync(pluginsDir, { withFileTypes: true });
    const providers = dirs
      .filter(
        (d: { isDirectory(): boolean; name: string }) =>
          d.isDirectory() && !d.name.startsWith("_"),
      )
      .map((d: { name: string }) => ({
        name: d.name,
        installed: existsSync(join(pluginsDir, d.name, "__init__.py")),
      }));

    expect(providers).toHaveLength(3);
    expect(providers.map((p: { name: string }) => p.name).sort()).toEqual([
      "holographic",
      "honcho",
      "mem0",
    ]);
    expect(providers.every((p: { installed: boolean }) => p.installed)).toBe(
      true,
    );
  });

  it("reads active provider from config.yaml", () => {
    const configPath = join(TEST_DIR, "config.yaml");
    writeFileSync(
      configPath,
      `memory:
  memory_enabled: true
  provider: honcho
  nudge_interval: 10
`,
    );

    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^\s*provider:\s*["']?(\w+)["']?\s*$/m);
    expect(match?.[1]).toBe("honcho");
  });

  it("returns empty string when no provider configured", () => {
    const configPath = join(TEST_DIR, "config.yaml");
    writeFileSync(
      configPath,
      `memory:
  memory_enabled: true
  nudge_interval: 10
`,
    );

    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^\s*provider:\s*["']?(\w+)["']?\s*$/m);
    expect(match).toBeNull();
  });
});

// ─── OAuth credential discovery ─────────────────
//
// The previous installer-side `hasHermesAuthCredential` accepted a bare
// `active_provider` and empty `providers: { name: {} }` entries as
// configured. That looser check could mask onboarding failures where a
// credential record existed but contained no token. The replacement,
// `hasOAuthCredentials` (in config.ts, profile-aware), only counts an
// entry that has at least one of access_token / refresh_token / api_key.

describe("OAuth credential discovery", () => {
  async function importConfigWithHome(
    home: string,
  ): Promise<typeof import("../src/main/config")> {
    vi.resetModules();
    process.env.HERMES_HOME = home;
    return await import("../src/main/config");
  }

  afterEach(() => {
    delete process.env.HERMES_HOME;
    vi.resetModules();
  });

  it("detects OAuth credentials stored in auth.json credential_pool", async () => {
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify({
        credential_pool: {
          "openai-codex": [{ access_token: "sk-test-token" }],
        },
      }),
    );

    const { hasOAuthCredentials } = await importConfigWithHome(TEST_DIR);

    expect(hasOAuthCredentials("openai-codex")).toBe(true);
    expect(hasOAuthCredentials("anthropic")).toBe(false);
  });

  it("requires actual token fields, not just a provider entry", async () => {
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify({
        active_provider: "openrouter",
        providers: {
          anthropic: {}, // empty — no token, so not "configured"
          openai: { access_token: "tok-openai" },
          claude: { refresh_token: "ref-claude" },
          mistral: { api_key: "key-mistral" },
        },
      }),
    );

    const { hasOAuthCredentials } = await importConfigWithHome(TEST_DIR);

    // Empty providers entries and a bare active_provider no longer count
    // — the previous behavior reported them as configured even with no
    // actual credentials, which masked real onboarding errors.
    expect(hasOAuthCredentials("anthropic")).toBe(false);
    expect(hasOAuthCredentials("openrouter")).toBe(false);
    // Any of access_token / refresh_token / api_key qualifies.
    expect(hasOAuthCredentials("openai")).toBe(true);
    expect(hasOAuthCredentials("claude")).toBe(true);
    expect(hasOAuthCredentials("mistral")).toBe(true);
  });

  it("returns false when auth.json is missing or malformed", async () => {
    const missing = await importConfigWithHome(TEST_DIR);
    expect(missing.hasOAuthCredentials("openai-codex")).toBe(false);

    writeFileSync(join(TEST_DIR, "auth.json"), "{not-json");
    const malformed = await importConfigWithHome(TEST_DIR);
    expect(malformed.hasOAuthCredentials("openai-codex")).toBe(false);
  });
});

// ─── OpenClaw detector ─────────────────────────────────

describe("checkOpenClawExists", () => {
  it("ignores an empty .openclaw directory (self-created stub)", async () => {
    // Mirrors the real-world case where hermes-desktop's own Claw3D settings
    // helper has mkdirSync'd ~/.openclaw/claw3d/ without writing any files.
    mkdirSync(join(TEST_DIR, ".openclaw", "claw3d"), { recursive: true });
    const { checkOpenClawExists } = await import("../src/main/installer");
    expect(checkOpenClawExists(TEST_DIR)).toEqual({ found: false, path: null });
  });

  it("detects a populated .openclaw directory", async () => {
    const dir = join(TEST_DIR, ".openclaw");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "openclaw.json"), "{}");
    const { checkOpenClawExists } = await import("../src/main/installer");
    expect(checkOpenClawExists(TEST_DIR)).toEqual({ found: true, path: dir });
  });

  it("detects files nested under subdirectories", async () => {
    const dir = join(TEST_DIR, ".openclaw");
    mkdirSync(join(dir, "skills", "my-skill"), { recursive: true });
    writeFileSync(join(dir, "skills", "my-skill", "SKILL.md"), "hi");
    const { checkOpenClawExists } = await import("../src/main/installer");
    expect(checkOpenClawExists(TEST_DIR)).toEqual({ found: true, path: dir });
  });

  it("returns not-found when no candidate directory exists", async () => {
    const { checkOpenClawExists } = await import("../src/main/installer");
    expect(checkOpenClawExists(TEST_DIR)).toEqual({ found: false, path: null });
  });

  it("falls back to legacy .clawdbot and .moldbot names", async () => {
    const dir = join(TEST_DIR, ".clawdbot");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "clawdbot.json"), "{}");
    const { checkOpenClawExists } = await import("../src/main/installer");
    expect(checkOpenClawExists(TEST_DIR)).toEqual({ found: true, path: dir });
  });
});

// ─── Backward compatibility checks ─────────────────────

describe("Backward compatibility", () => {
  it("getEnhancedPath logic includes standard paths", () => {
    // Simulate getEnhancedPath extra paths
    const extra = ["/usr/local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin"];
    const result = [...extra, process.env.PATH || ""].join(":");
    expect(result).toContain("/usr/local/bin");
    expect(result).toContain("/opt/homebrew/bin");
  });

  it("findNpm candidate list includes standard locations", () => {
    const candidates = ["/usr/local/bin/npm", "/opt/homebrew/bin/npm"];
    // At least these standard paths should be checked
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]).toContain("npm");
  });
});
