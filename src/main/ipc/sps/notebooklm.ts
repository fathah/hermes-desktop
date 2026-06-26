import { safeHandle } from "../safe-handle";
import {
  commandExists,
  listMcpServerEntries,
  notebookLmCliCommand,
  notebookLmMcpEntry,
  setMcpServerEnabled,
  writeMcpServerEntry,
} from "../../installer";
import { isGatewayRunning, restartGateway } from "../../hermes";

type NotebookLmMcpSource =
  | "env"
  | "user-bin"
  | "path"
  | "claude-code"
  | "existing";

interface NotebookLmMcpStatus {
  registered: boolean;
  alreadyPresent: boolean;
  commandFound: boolean;
  command: string;
  args: string[];
  source: NotebookLmMcpSource;
  nlmCommand: string | null;
  restarted: boolean;
  message: string;
}

export function registerSpsNotebookLmIpc(): void {
  safeHandle("sps-notebooklm-ensure-mcp", (_event, profile?: string) =>
    ensureNotebookLmMcpRegistered(profile),
  );
  safeHandle("sps-notebooklm-status", (_event, profile?: string) =>
    notebookLmMcpStatus(profile),
  );
}

function ensureNotebookLmMcpRegistered(profile?: string): NotebookLmMcpStatus {
  const name = "notebooklm-mcp";
  const current = listMcpServerEntries(profile).find((s) => s.name === name);
  if (current) {
    const wasRunning = isGatewayRunning(profile);
    const commandFound = commandExists(current.entry.command);
    const repaired = !commandFound ? notebookLmMcpEntry() : null;
    const shouldRepair = !!repaired?.commandFound;
    if (shouldRepair) {
      writeMcpServerEntry(
        name,
        {
          command: repaired.command,
          args: repaired.args,
          env: {},
          enabled: true,
        },
        profile,
      );
      if (wasRunning) void restartGateway(profile);
      return {
        registered: true,
        alreadyPresent: true,
        commandFound: true,
        command: repaired.command,
        args: repaired.args,
        source: repaired.source,
        nlmCommand: notebookLmCliCommand(),
        restarted: wasRunning,
        message:
          repaired.source === "claude-code"
            ? "NotebookLM MCP was repaired using the local command from Claude Code."
            : "NotebookLM MCP was repaired and enabled for this Hermes profile.",
      };
    }
    if (!current.enabled) {
      setMcpServerEnabled(name, true, profile);
      if (wasRunning) void restartGateway(profile);
    }
    return {
      registered: true,
      alreadyPresent: true,
      commandFound,
      command: current.entry.command,
      args: current.entry.args,
      source: "existing",
      nlmCommand: notebookLmCliCommand(),
      restarted: !current.enabled && wasRunning,
      message: commandFound
        ? "NotebookLM MCP is enabled for this Hermes profile."
        : "NotebookLM MCP is configured, but the command could not be found.",
    };
  }

  const entry = notebookLmMcpEntry();
  if (!entry.commandFound) {
    return {
      registered: false,
      alreadyPresent: false,
      commandFound: false,
      command: entry.command,
      args: entry.args,
      source: entry.source,
      nlmCommand: notebookLmCliCommand(),
      restarted: false,
      message:
        "NotebookLM MCP command not found. Install notebooklm-mcp-cli, make notebooklm-mcp available on PATH, or set HERMES_NOTEBOOKLM_MCP_COMMAND.",
    };
  }
  const wasRunning = isGatewayRunning(profile);
  writeMcpServerEntry(
    name,
    { command: entry.command, args: entry.args, env: {}, enabled: true },
    profile,
  );
  if (wasRunning) void restartGateway(profile);
  return {
    registered: true,
    alreadyPresent: false,
    commandFound: true,
    command: entry.command,
    args: entry.args,
    source: entry.source,
    nlmCommand: notebookLmCliCommand(),
    restarted: wasRunning,
    message:
      entry.source === "claude-code"
        ? "NotebookLM MCP is enabled using the local command from Claude Code."
        : "NotebookLM MCP is enabled for this Hermes profile.",
  };
}

function notebookLmMcpStatus(profile?: string): NotebookLmMcpStatus & {
  restarted: false;
} {
  const name = "notebooklm-mcp";
  const current = listMcpServerEntries(profile).find((s) => s.name === name);
  if (current) {
    const commandFound = commandExists(current.entry.command);
    const repairEntry = !commandFound ? notebookLmMcpEntry() : null;
    if (!commandFound && repairEntry?.commandFound) {
      return {
        registered: false,
        alreadyPresent: true,
        commandFound: true,
        command: repairEntry.command,
        args: repairEntry.args,
        source: repairEntry.source,
        nlmCommand: notebookLmCliCommand(),
        restarted: false,
        message:
          repairEntry.source === "claude-code"
            ? "NotebookLM MCP is configured with a missing command. Enable to repair it using the local command from Claude Code."
            : "NotebookLM MCP is configured with a missing command. Enable to repair it.",
      };
    }
    return {
      registered: current.enabled,
      alreadyPresent: true,
      commandFound,
      command: current.entry.command,
      args: current.entry.args,
      source: "existing",
      nlmCommand: notebookLmCliCommand(),
      restarted: false,
      message: current.enabled
        ? "NotebookLM MCP is enabled for this Hermes profile."
        : "NotebookLM MCP is configured but disabled.",
    };
  }

  const entry = notebookLmMcpEntry();
  return {
    registered: false,
    alreadyPresent: false,
    commandFound: entry.commandFound,
    command: entry.command,
    args: entry.args,
    source: entry.source,
    nlmCommand: notebookLmCliCommand(),
    restarted: false,
    message: entry.commandFound
      ? "NotebookLM MCP is available and can be enabled."
      : "NotebookLM MCP command not found.",
  };
}
