import { describe, it, expect } from "vitest";
import {
  renderMcpServerEntry,
  upsertMcpServerInYaml,
  type McpServerEntry,
} from "../src/main/installer";

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
