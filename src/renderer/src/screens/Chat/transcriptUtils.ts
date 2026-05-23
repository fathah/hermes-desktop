import type { ChatMessage } from "./types";
import { isBubbleMessage } from "./types";

export type TranscriptFormat = "text" | "markdown";

/**
 * Serialise a conversation into a clipboard-ready transcript (issue #298).
 *
 * - `text`     → plain `You: …` / `Hermes: …` blocks.
 * - `markdown` → `**You:**` / `**Hermes:**` headed blocks.
 *
 * Blocks are separated by a blank line. Exported for unit testing.
 */
export function buildChatTranscript(
  messages: ChatMessage[],
  format: TranscriptFormat,
): string {
  // Transcripts cover the user-visible chat — drop history-only sub-rows
  // (reasoning, tool_call, tool_result) that have no `.content` shape.
  return messages
    .filter(isBubbleMessage)
    .map((m) => {
      const speaker = m.role === "user" ? "You" : "Hermes";
      const content = (m.content ?? "").trim();
      return format === "markdown"
        ? `**${speaker}:**\n\n${content}`
        : `${speaker}: ${content}`;
    })
    .join("\n\n");
}
