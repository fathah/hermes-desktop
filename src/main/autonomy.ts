// autonomy.ts — scoped auto-approve policy for dangerous-command approvals (M2B).
//
// The gateway asks the desktop to approve risky operations (hermes.approval.request).
// "Scoped autonomy" auto-approves ONLY provably-safe, read-only terminal commands
// and ALWAYS prompts for everything else (writes, deletes, installs, network sends,
// anything chained/redirected, and any non-terminal tool). This is the deliberately
// conservative inverse of the article's "YOLO" mode — an ALLOWLIST, not a denylist —
// because the host machine holds the user's security-guarding and cafe business data.
//
// Pure + dependency-free so it is unit-testable; the config gate + the actual
// approve/deny call live in the IPC layer (index.ts).
import type { ApprovalRequest } from "./sse-parser";

// Single, well-known inspection binaries with no mutating power. `git` is allowed
// only for the read-only subcommands enumerated below.
const SAFE_BINARIES = new Set([
  "ls",
  "pwd",
  "cat",
  "echo",
  "whoami",
  "date",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "stat",
  "file",
  "which",
  "env",
  "printenv",
  "ps",
  "df",
  "du",
  "tree",
  "id",
  "uname",
  "hostname",
  "cut",
  "sort",
  "uniq",
  "git",
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "describe",
  "rev-parse",
  "blame",
  "shortlog",
  "tag",
]);

// Any shell metacharacter means we can no longer reason about the command as a
// single safe invocation (chaining, redirection, substitution, globbing, etc.) —
// fail closed.
const SHELL_METACHARS = /[;&|<>`$(){}\\!*?~\n\r]/;

/**
 * Is this a single, read-only terminal command we can safely auto-approve?
 * Conservative: rejects anything with shell metacharacters, anything whose
 * binary is not on the allowlist, and any `git` invocation that is not a
 * read-only subcommand.
 */
export function isCommandSafe(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (SHELL_METACHARS.test(cmd)) return false;
  const parts = cmd.split(/\s+/);
  const binary = parts[0];
  if (!SAFE_BINARIES.has(binary)) return false;
  if (binary === "git") {
    const subcommand = parts[1] ?? "";
    return SAFE_GIT_SUBCOMMANDS.has(subcommand);
  }
  return true;
}

/**
 * Decide whether a dangerous-command approval request qualifies for scoped
 * auto-approval. Only terminal commands matched by `isCommandSafe` qualify;
 * a request with no command text (an unknown/structured tool action) can never
 * be proven safe, so it always prompts.
 */
export function canAutoApprove(req: ApprovalRequest): boolean {
  if (!req.command) return false;
  return isCommandSafe(req.command);
}
