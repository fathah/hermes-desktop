/**
 * Slash-command execution pipeline for dashboard (gateway) chat.
 *
 * Mirrors hermes-agent's reference client (`web/src/lib/slashExec.ts`, itself a
 * port of the Ink TUI's `createSlashHandler.ts`). Without this, the desktop
 * sent a typed `/compact` (and friends) to the agent as a literal user prompt
 * via `prompt.submit`, so the model just echoed it back as prose — useless.
 * Real slash commands must go through the gateway's `slash.exec` RPC, which
 * runs the registry-backed command, with a `command.dispatch` fallback for
 * commands that resolve to an alias, a plugin, a skill, or an agent prompt.
 *
 * The pipeline is intentionally transport-agnostic: it takes a bare `request`
 * function plus a `sys` callback for rendering output, and *returns* a `send`
 * directive rather than dispatching it. That keeps the streaming agent-turn
 * lifecycle (loading state, active turn, prompt.submit) in the caller, where
 * the rest of the chat actions already manage it.
 */

/** Minimal view of the gateway client's `request` method. Non-generic so test
 *  mocks and the generic `DashboardGatewayClient.request` are both assignable;
 *  callers narrow the resolved value themselves. */
export type GatewayRequest = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

interface SlashExecResponse {
  output?: string;
  warning?: string;
}

type CommandDispatchResponse =
  | { type: "exec" | "plugin"; output?: string }
  | { type: "alias"; target: string }
  | { type: "skill"; name: string; message?: string }
  | { type: "send"; message: string };

/**
 * Terminal outcome of running a slash command.
 *  - `done`  — the command produced output (already rendered via `sys`).
 *  - `send`  — the command resolved to an agent prompt; the caller should run
 *              a normal streaming turn with `message`.
 *  - `error` — the command failed; `message` is a human-readable reason.
 */
export type SlashExecOutcome =
  | { kind: "done" }
  | { kind: "send"; message: string; source: "send" | "skill" }
  | { kind: "error"; message: string };

export interface ExecuteSlashOptions {
  /** Raw command including the leading slash (e.g. "/compress here"). */
  command: string;
  /** Runtime session id. Some commands are session-less; pass "" if unknown. */
  sessionId: string;
  request: GatewayRequest;
  /** Render a transcript message (command output, warnings, skill notices). */
  sys: (text: string) => void;
}

/**
 * Run a slash command through `slash.exec`, falling back to `command.dispatch`.
 * Bounded recursion via the `alias` directive is capped by `depth`.
 */
// @lat: [[chat-commands#Slash command execution#Routing pipeline]]
export async function executeSlash(
  { command, sessionId, request, sys }: ExecuteSlashOptions,
  depth = 0,
): Promise<SlashExecOutcome> {
  const { name, arg } = parseSlash(command);
  if (!name) {
    return { kind: "error", message: "empty slash command" };
  }
  // Guard against an alias cycle in config (a -> b -> a).
  if (depth > 8) {
    return { kind: "error", message: `/${name}: alias chain too deep` };
  }

  // Primary dispatcher: the registry-backed slash worker.
  try {
    const raw = await request("slash.exec", {
      command: command.replace(/^\/+/, ""),
      session_id: sessionId,
    });
    const dispatched = parseCommandDispatch(raw);
    if (dispatched) {
      return handleCommandDispatch(
        dispatched,
        { command, sessionId, request, sys },
        arg,
        name,
        depth,
      );
    }
    const r = raw as SlashExecResponse | undefined;
    const body = r?.output || `/${name}: no output`;
    sys(r?.warning ? `warning: ${r.warning}\n${body}` : body);
    return { kind: "done" };
  } catch {
    /* fall through to command.dispatch */
  }

  // Fallback: resolve client-side directives (alias / plugin / skill / send).
  let dispatched: CommandDispatchResponse | null;
  try {
    dispatched = parseCommandDispatch(
      await request("command.dispatch", {
        name,
        arg,
        session_id: sessionId,
      }),
    );
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!dispatched) {
    return { kind: "error", message: "invalid response: command.dispatch" };
  }

  return handleCommandDispatch(
    dispatched,
    { command, sessionId, request, sys },
    arg,
    name,
    depth,
  );
}

function handleCommandDispatch(
  dispatched: CommandDispatchResponse,
  options: ExecuteSlashOptions,
  arg: string,
  name: string,
  depth: number,
): Promise<SlashExecOutcome> | SlashExecOutcome {
  const { sessionId, request, sys } = options;

  switch (dispatched.type) {
    case "exec":
    case "plugin":
      sys(dispatched.output ?? "(no output)");
      return { kind: "done" };

    case "alias":
      return executeSlash(
        {
          command: `/${dispatched.target}${arg ? ` ${arg}` : ""}`,
          sessionId,
          request,
          sys,
        },
        depth + 1,
      );

    case "skill":
    case "send": {
      const msg = dispatched.message?.trim() ?? "";
      if (!msg) {
        return {
          kind: "error",
          message:
            dispatched.type === "skill"
              ? `/${name}: skill payload missing message`
              : `/${name}: empty message`,
        };
      }
      if (dispatched.type === "skill")
        sys(`⚡ loading skill: ${dispatched.name}`);
      return { kind: "send", message: msg, source: dispatched.type };
    }
  }
}

/** Split "/name rest of args" into its name and trimmed argument string. */
export function parseSlash(command: string): { name: string; arg: string } {
  // `s` (dotAll) flag so a multi-line argument is captured: without it `.`
  // stops at the first newline and the whole match fails, so a valid command
  // with a multi-line body (e.g. `/remember` a multi-line note) would parse to
  // an empty name and be rejected as "empty slash command". Mirrors the sibling
  // parser in slash/parseSlashCommand.ts, which already uses the flag.
  const m = command.replace(/^\/+/, "").match(/^(\S+)\s*(.*)$/s);
  return m ? { name: m[1], arg: m[2].trim() } : { name: "", arg: "" };
}

function parseCommandDispatch(raw: unknown): CommandDispatchResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;

  switch (r.type) {
    case "exec":
    case "plugin":
      return { type: r.type, output: str(r.output) };
    case "alias":
      return typeof r.target === "string"
        ? { type: "alias", target: r.target }
        : null;
    case "skill":
      return typeof r.name === "string"
        ? { type: "skill", name: r.name, message: str(r.message) }
        : null;
    case "send":
      return typeof r.message === "string"
        ? { type: "send", message: r.message }
        : null;
    default:
      return null;
  }
}
