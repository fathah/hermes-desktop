import { describe, expect, it } from "vitest";
import { agentCommandsFromCatalog, createSlashCatalog } from "./commandCatalog";
import type { AgentSlashCommand, DesktopSlashCommand } from "./types";

const status: AgentSlashCommand = {
  name: "status",
  description: "Show status",
  category: "Agent",
  source: "agent",
  target: "agent",
};

describe("slash command catalog", () => {
  it("normalizes upstream command and alias names with leading slashes", () => {
    const upstream = agentCommandsFromCatalog({
      pairs: [["/new", "Start a session"]],
      canon: { "/reset": "/new", "/new": "/new" },
    });
    const catalog = createSlashCatalog({
      agentCommands: upstream.commands,
      aliases: upstream.aliases,
    });

    expect(catalog.resolve("/new")?.name).toBe("new");
    expect(catalog.resolve("reset")?.name).toBe("new");
  });

  it("rejects duplicate canonical names", () => {
    const desktop: DesktopSlashCommand = {
      name: "status",
      description: "Desktop status",
      category: "Desktop",
      source: "desktop",
      target: "desktop",
      execute: async () => ({ type: "handled" }),
    };

    expect(() =>
      createSlashCatalog({
        agentCommands: [status],
        desktopCommands: [desktop],
      }),
    ).toThrow("Duplicate slash command: /status");
  });

  it("rejects aliases that collide with canonical commands", () => {
    expect(() =>
      createSlashCatalog({
        agentCommands: [
          { ...status, aliases: ["inspect"] },
          { ...status, name: "inspect" },
        ],
      }),
    ).toThrow("Duplicate slash command: /inspect");
  });

  it("ignores alias entries that duplicate an already-registered command", () => {
    const upstream = agentCommandsFromCatalog({
      pairs: [
        ["/compact", "Compact and summarize the conversation"],
        ["/compress", "Compress conversation with optional focus topic"],
      ],
      canon: { compact: "compress" },
    });

    const catalog = createSlashCatalog({
      agentCommands: upstream.commands,
      aliases: upstream.aliases,
    });

    expect(catalog.resolve("/compact")?.name).toBe("compact");
    expect(catalog.resolve("/compress")?.name).toBe("compress");
  });
});
