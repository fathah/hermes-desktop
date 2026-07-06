import { describe, expect, it } from "vitest";
import {
  agentCommandsFromCatalog,
  createSlashCatalog,
  reconcileSlashCatalog,
} from "./commandCatalog";
import type {
  AgentSlashCommand,
  DesktopSlashCommand,
  SlashCommandDefinition,
} from "./types";

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

  it("drops a canon alias whose name is already a standalone command", () => {
    // Regression for #802 / #804: the backend can expose the same name both as
    // a first-class command (via `pairs`) and as an alias of another command
    // (via `canon`) — e.g. `/compact` is a standalone TUI command *and* an
    // alias of `/compress`. The reconciled catalog must not list the name in
    // both `commands` and `aliases`, or createSlashCatalog throws and the app
    // crashes on agent connect.
    const discovered = agentCommandsFromCatalog({
      pairs: [
        ["/compress", "Compress conversation context"],
        ["/compact", "Toggle compact display mode"],
      ],
      canon: { "/compact": "/compress" },
    });

    expect(discovered.aliases).not.toHaveProperty("compact");
    expect(discovered.commands.map((c) => c.name)).toContain("compact");

    expect(() =>
      createSlashCatalog({
        agentCommands: discovered.commands,
        aliases: discovered.aliases,
      }),
    ).not.toThrow();

    const catalog = createSlashCatalog({
      agentCommands: discovered.commands,
      aliases: discovered.aliases,
    });
    // The standalone command wins deterministically.
    expect(catalog.resolve("/compact")?.name).toBe("compact");
  });
});

describe("reconcileSlashCatalog", () => {
  const help: SlashCommandDefinition = {
    name: "help",
    aliases: ["commands"],
    description: "Show available commands",
    category: "Desktop",
    source: "desktop",
    target: "desktop",
    execute: async () => ({ type: "handled" }),
  };

  it("does not crash when a backend command's name collides with a desktop alias", () => {
    // Regression for #813 (same class as #802 / #804): `help` aliases `commands`
    // and the backend also exposes a `/commands` command. Filtering backend
    // commands only against desktop *names* (not desktop *aliases*) let
    // `commands` register as an agent command, so `help`'s alias registration
    // then threw `Duplicate slash command alias: /commands`, crashing startup.
    let catalog!: ReturnType<typeof reconcileSlashCatalog>;
    expect(() => {
      catalog = reconcileSlashCatalog({
        catalog: { pairs: [["/commands", "List agent commands"]], canon: {} },
        desktopCommands: [help],
        fallbackAgentCommands: [],
      });
    }).not.toThrow();
    // Desktop authoring wins: `/commands` resolves to the desktop `help` command.
    expect(catalog.resolve("commands")?.name).toBe("help");
  });

  it("lets desktop commands win over a same-named backend command", () => {
    const catalog = reconcileSlashCatalog({
      catalog: { pairs: [["/help", "Agent help"]], canon: {} },
      desktopCommands: [help],
      fallbackAgentCommands: [],
    });
    expect(catalog.resolve("help")?.source).toBe("desktop");
  });

  it("still exposes non-colliding backend commands", () => {
    const catalog = reconcileSlashCatalog({
      catalog: { pairs: [["/status", "Agent status"]], canon: {} },
      desktopCommands: [help],
      fallbackAgentCommands: [],
    });
    expect(catalog.resolve("status")?.source).toBe("agent");
    expect(catalog.resolve("commands")?.name).toBe("help");
  });
});
