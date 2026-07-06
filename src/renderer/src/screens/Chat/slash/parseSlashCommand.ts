import type { ParsedSlashCommand } from "./types";

export type ParseSlashCommandResult =
  | { ok: true; command: ParsedSlashCommand }
  | { ok: false; error: string };

/**
 * Normalizes and splits raw input into command name and argument payload.
 */
export function parseSlashCommand(rawInput: string): ParseSlashCommandResult {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) {
    return { ok: false, error: "Input is not a slash command" };
  }

  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash.trim()) {
    return { ok: false, error: "Empty slash command" };
  }

  // Split on first whitespace sequence
  const match = withoutSlash.match(/^(\S+)(?:\s+(.*))?$/s);
  if (!match) {
    return { ok: false, error: "Invalid slash command format" };
  }

  const name = match[1];
  const args = match[2] ?? "";

  return {
    ok: true,
    command: {
      rawInput,
      name,
      normalizedName: name.toLowerCase(),
      args,
    },
  };
}
