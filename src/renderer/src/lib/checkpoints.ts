/**
 * Checkpoint slash-command helper.
 *
 * The gateway exposes checkpoints via the `/rollback` slash command (no HTTP
 * endpoint). The Chat surface sends this command to open the rollback listing.
 */

export function listCommand(): string {
  return "/rollback";
}
