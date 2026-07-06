import { executeAgentCommand } from "./executeAgentCommand";
import { parseSlashCommand } from "./parseSlashCommand";
import { prepareModelSubmission } from "./prepareModelSubmission";
import type {
  SlashCommandCatalog,
  SlashCommandContext,
  SlashCommandResult,
} from "./types";

/**
 * Single entry point for all slash command routing.
 */
// @lat: [[chat-commands#Slash command execution#Central command router]]
export async function handleSlashCommand(
  rawInput: string,
  catalog: SlashCommandCatalog,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  const parsed = parseSlashCommand(rawInput);
  if (!parsed.ok) {
    return { type: "error", message: parsed.error };
  }

  const commandDef = catalog.resolve(parsed.command.normalizedName);
  if (!commandDef) {
    return {
      type: "error",
      message: `Unknown command: /${parsed.command.name}`,
    };
  }

  // Busy check policy
  if (
    context.isModelBusy &&
    commandDef.target !== "model" &&
    commandDef.allowWhileBusy === false
  ) {
    return {
      type: "error",
      message: `/${parsed.command.name} cannot run while the current turn is active`,
    };
  }

  // Attachment check policy. Desktop commands are local UI actions / info
  // displays that never consume attachments — they leave any staged files in
  // the composer for the next real message — so they're exempt, matching the
  // pre-central-router behavior where local commands ran unconditionally.
  // Without this exemption, typing e.g. `/new` with a file staged would error
  // ("/new does not accept attachments"); and since `uiAction` commands push
  // no user bubble, that error would render orphaned with no preceding turn.
  // Only agent/model commands, which actually route content upstream, must
  // declare `supportsAttachments`.
  if (
    commandDef.target !== "desktop" &&
    context.attachments.length > 0 &&
    commandDef.supportsAttachments !== true
  ) {
    return {
      type: "error",
      message: `/${parsed.command.name} does not accept attachments`,
    };
  }

  switch (commandDef.target) {
    case "desktop": {
      const res = await commandDef.execute(parsed.command, context);
      if (res.type === "error") {
        return { type: "error", message: res.message };
      }
      return { type: "handled", output: res.output };
    }

    case "agent": {
      return executeAgentCommand(commandDef, parsed.command, context);
    }

    case "model": {
      const draft = await commandDef.format(
        {
          command: commandDef.name,
          args: parsed.command.args,
          rawInput,
          selectedText: context.selectedText,
          attachments: context.attachments,
          profile: context.profile,
          sessionId: context.sessionId,
        },
        context,
      );

      const prep = await prepareModelSubmission(
        draft,
        { type: "desktop-command", command: commandDef.name },
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
  }
}
