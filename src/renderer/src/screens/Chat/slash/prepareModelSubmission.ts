import type {
  ModelPromptDraft,
  ModelSubmissionSource,
  PreparedModelSubmission,
  SlashCommandContext,
} from "./types";

export type PrepareSubmissionResult =
  | { ok: true; submission: PreparedModelSubmission }
  | { ok: false; error: string };

/**
 * Normalizes, validates, and packages draft prompt content into a final submission.
 */
// @lat: [[chat-commands#Slash command execution#Central command router#Model commands]]
export async function prepareModelSubmission(
  draft: ModelPromptDraft,
  source: ModelSubmissionSource,
  _context: SlashCommandContext,
): Promise<PrepareSubmissionResult> {
  const content = draft.content.trim();
  if (!content) {
    return {
      ok: false,
      error: `/${source.command} produced an empty model prompt`,
    };
  }

  const attachments = draft.attachments ?? [];

  return {
    ok: true,
    submission: {
      content,
      attachments,
      metadata: {
        source: "slash-command",
        route: source.type,
        command: source.command,
      },
    },
  };
}
