import { prepareModelSubmission } from "./prepareModelSubmission";
import type {
  AgentSlashCommand,
  ParsedSlashCommand,
  SlashCommandContext,
  SlashCommandResult,
} from "./types";

/**
 * Forwards agent commands through gateway JSON-RPC (`slash.exec` / `command.dispatch`).
 */
// @lat: [[chat-commands#Slash command execution#Central command router#Agent commands]]
export async function executeAgentCommand(
  _commandDef: AgentSlashCommand,
  parsed: ParsedSlashCommand,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  const outcome = await context.executeAgentSlash(
    parsed.rawInput,
    context.addSystemMessage,
  );

  if (outcome.kind === "done") {
    return { type: "handled" };
  }

  if (outcome.kind === "error") {
    return { type: "error", message: outcome.message };
  }

  // outcome.kind === "send"
  const prep = await prepareModelSubmission(
    { content: outcome.message, attachments: context.attachments },
    {
      type: outcome.source === "skill" ? "agent-skill" : "agent-send",
      command: parsed.name,
    },
    context,
  );

  if (!prep.ok) {
    return { type: "error", message: prep.error };
  }

  if (context.isModelBusy) {
    context.enqueuePrompt(prep.submission);
    return { type: "queued", submission: prep.submission };
  }

  await context.submitPrompt(prep.submission);
  return { type: "submitted", submission: prep.submission };
}
