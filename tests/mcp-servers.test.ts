import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
  isRemoteMode: () => false,
}));

vi.mock("../src/main/utils", () => ({
  profilePaths: () => ({ configFile: "config.yaml" }),
  safeWriteFile: vi.fn(),
}));

import {
  parseCatalogOutput,
  parseMcpServersFromConfig,
  removeMcpServerFromConfig,
  setMcpServerEnabledInConfig,
  upsertMcpServerInConfig,
} from "../src/main/mcp-servers";

describe("MCP server config management", () => {
  it("parses the local hermes mcp catalog table output", () => {
    const entries = parseCatalogOutput(`
  MCP Catalog + configured servers:

  Name               Status                   Description
  ------------------ ------------------------ -----------
  linear             available                Find, create, and update Linear issues, projects, and comments.
  n8n                available                Manage and inspect n8n workflows from Hermes (stdio bridge, no public port).

  Install: hermes mcp install <name>    Picker: hermes mcp
`);

    expect(entries).toMatchObject([
      {
        name: "linear",
        description:
          "Find, create, and update Linear issues, projects, and comments.",
        installed: false,
      },
      {
        name: "n8n",
        description:
          "Manage and inspect n8n workflows from Hermes (stdio bridge, no public port).",
        installed: false,
      },
    ]);
  });

  it("parses HTTP and stdio MCP servers with args and env", () => {
    const servers = parseMcpServersFromConfig(`model:
  provider: openai

mcp_servers:
  notion:
    url: "https://mcp.notion.com/mcp"
    auth: "oauth"
  github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "redacted"
    enabled: false

memory:
  provider: honcho
`);

    expect(servers).toEqual([
      {
        name: "notion",
        type: "http",
        transport: "http",
        enabled: true,
        detail: "https://mcp.notion.com/mcp",
        url: "https://mcp.notion.com/mcp",
        command: undefined,
        args: [],
        env: {},
        auth: "oauth",
        tools: undefined,
      },
      {
        name: "github",
        type: "stdio",
        transport: "stdio",
        enabled: false,
        detail: "npx",
        url: undefined,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "redacted" },
        auth: undefined,
        tools: undefined,
      },
    ]);
  });

  it("adds a new mcp_servers block without disturbing neighboring config", () => {
    const next = upsertMcpServerInConfig(
      `model:
  provider: openai
`,
      {
        name: "linear",
        type: "http",
        url: "https://mcp.linear.app/mcp",
      },
    );

    expect(next).toContain(`model:
  provider: openai

mcp_servers:
  linear:
    url: "https://mcp.linear.app/mcp"
`);
  });

  it("appends a server to an existing block and preserves later sections", () => {
    const next = upsertMcpServerInConfig(
      `mcp_servers:
  github:
    command: "npx"

memory:
  provider: honcho
`,
      {
        name: "notion",
        type: "http",
        url: "https://mcp.notion.com/mcp",
        auth: "oauth",
      },
    );

    expect(next).toContain(`mcp_servers:
  github:
    command: "npx"
  notion:
    url: "https://mcp.notion.com/mcp"
    auth: "oauth"

memory:
  provider: honcho`);
  });

  it("removes only the requested server and keeps the mcp_servers block when others remain", () => {
    const next = removeMcpServerFromConfig(
      `mcp_servers:
  github:
    command: "npx"
  notion:
    url: "https://mcp.notion.com/mcp"

memory:
  provider: honcho
`,
      "github",
    );

    expect(next).not.toContain("github:");
    expect(next).toContain(`mcp_servers:
  notion:
    url: "https://mcp.notion.com/mcp"`);
    expect(next).toContain(`memory:
  provider: honcho`);
  });

  it("removes the mcp_servers block when the last server is removed", () => {
    const next = removeMcpServerFromConfig(
      `model:
  provider: openai

mcp_servers:
  github:
    command: "npx"

memory:
  provider: honcho
`,
      "github",
    );

    expect(next).not.toContain("mcp_servers:");
    expect(next).toContain(`model:
  provider: openai`);
    expect(next).toContain(`memory:
  provider: honcho`);
  });

  it("inserts and updates enabled flags inside the targeted server block", () => {
    const disabled = setMcpServerEnabledInConfig(
      `mcp_servers:
  github:
    command: "npx"
  notion:
    url: "https://mcp.notion.com/mcp"
    enabled: false
`,
      "github",
      false,
    );

    expect(disabled).toContain(`  github:
    command: "npx"
    enabled: false
  notion:`);

    const enabled = setMcpServerEnabledInConfig(disabled, "notion", true);
    expect(enabled).toContain(`  notion:
    url: "https://mcp.notion.com/mcp"
    enabled: true`);
  });

  it("updates the targeted server when manual blank lines separate server blocks", () => {
    const next = setMcpServerEnabledInConfig(
      `mcp_servers:
  github:
    command: "npx"

  notion:
    url: "https://mcp.notion.com/mcp"
`,
      "notion",
      false,
    );

    expect(next).toContain(`  github:
    command: "npx"

  notion:
    url: "https://mcp.notion.com/mcp"
    enabled: false`);
  });
});
