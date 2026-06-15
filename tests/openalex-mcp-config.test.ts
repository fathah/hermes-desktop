import { describe, it, expect } from "vitest";
import {
  commandExists,
  notebookLmMcpEntry,
  notebookLmMcpCommand,
  readClaudeCodeNotebookLmMcpEntry,
  renderMcpServerEntry,
  upsertMcpServerInYaml,
  type McpServerEntry,
} from "../src/main/installer";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ENTRY: McpServerEntry = {
  command: "/Apps/Hermes.app/Contents/MacOS/Hermes Agent",
  args: ["/res/openalex-mcp.cjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", HERMES_OPENALEX_MAILTO: "a@b.com" },
  enabled: true,
};

describe("renderMcpServerEntry", () => {
  it("renders quoted, nested YAML for command/args/env/enabled", () => {
    const out = renderMcpServerEntry("openalex", ENTRY);
    expect(out).toContain("  openalex:");
    // command path has spaces → must be quoted
    expect(out).toContain(
      '    command: "/Apps/Hermes.app/Contents/MacOS/Hermes Agent"',
    );
    expect(out).toContain("    args:");
    expect(out).toContain('      - "/res/openalex-mcp.cjs"');
    expect(out).toContain("    env:");
    expect(out).toContain('      ELECTRON_RUN_AS_NODE: "1"');
    expect(out).toContain('      HERMES_OPENALEX_MAILTO: "a@b.com"');
    expect(out).toContain("    enabled: true");
  });
});

describe("notebookLmMcpCommand", () => {
  it("returns the user command path or PATH fallback without auth material", () => {
    const command = notebookLmMcpCommand();

    expect(command).toMatch(/notebooklm-mcp$/);
    expect(command).not.toContain(".claude");
    expect(command).not.toContain("cookie");
    expect(command).not.toContain("token");
  });

  it("reads Claude Code's NotebookLM MCP command without copying env", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-claude-mcp-"));
    const configPath = join(dir, ".claude.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "notebooklm-mcp": {
            command: "/Users/example/.local/bin/notebooklm-mcp",
            args: ["--debug"],
            env: { SECRET_TOKEN: "do-not-copy" },
          },
        },
      }),
    );

    const entry = readClaudeCodeNotebookLmMcpEntry(configPath);

    expect(entry).toEqual({
      command: "/Users/example/.local/bin/notebooklm-mcp",
      args: ["--debug"],
    });
    expect(JSON.stringify(entry)).not.toContain("SECRET_TOKEN");
  });

  it("supports an office-managed NotebookLM MCP command override", () => {
    const before = process.env.HERMES_NOTEBOOKLM_MCP_COMMAND;
    process.env.HERMES_NOTEBOOKLM_MCP_COMMAND = process.execPath;
    try {
      const entry = notebookLmMcpEntry();

      expect(entry).toMatchObject({
        command: process.execPath,
        args: [],
        source: "env",
        commandFound: true,
      });
    } finally {
      if (before === undefined) {
        delete process.env.HERMES_NOTEBOOKLM_MCP_COMMAND;
      } else {
        process.env.HERMES_NOTEBOOKLM_MCP_COMMAND = before;
      }
    }
  });

  it("detects known commands without a shell", () => {
    expect(commandExists(process.execPath)).toBe(true);
  });
});

describe("upsertMcpServerInYaml", () => {
  const rendered = renderMcpServerEntry("openalex", ENTRY);

  it("appends a fresh mcp_servers block when none exists", () => {
    const before = 'model:\n  default: "x"\n';
    const out = upsertMcpServerInYaml(before, "openalex", rendered);
    expect(out).toContain("mcp_servers:\n  openalex:");
    expect(out.startsWith(before)).toBe(true);
  });

  it("inserts into an existing mcp_servers block, preserving siblings", () => {
    const before =
      "mcp_servers:\n  other:\n    url: http://x\n    enabled: true\nmodel:\n  default: y\n";
    const out = upsertMcpServerInYaml(before, "openalex", rendered);
    expect(out).toContain("  openalex:");
    expect(out).toContain("  other:"); // sibling preserved
    expect(out).toContain("model:\n  default: y"); // following top-level intact
  });

  it("replaces an existing same-named child without duplicating it", () => {
    const before =
      'mcp_servers:\n  openalex:\n    command: "/old/path"\n    enabled: false\n';
    const out = upsertMcpServerInYaml(before, "openalex", rendered);
    const occurrences = out.split("  openalex:").length - 1;
    expect(occurrences).toBe(1); // exactly one openalex entry
    expect(out).not.toContain("/old/path"); // old body gone
    expect(out).toContain(
      'command: "/Apps/Hermes.app/Contents/MacOS/Hermes Agent"',
    );
    expect(out).toContain("    enabled: true"); // new value
  });
});
