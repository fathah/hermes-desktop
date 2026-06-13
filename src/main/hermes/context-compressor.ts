export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export type ChatContent = string | ContentPart[];

export interface ChatMessage {
  role: string;
  content: ChatContent;
  name?: string;
  tool_call_id?: string;
}

export class ContextCompressor {
  private pruneLimit: number;
  private keepChars: number;
  private budgetChars: number;

  constructor(options?: { pruneLimit?: number; keepChars?: number; budgetChars?: number }) {
    this.pruneLimit = options?.pruneLimit ?? 8000;
    this.keepChars = options?.keepChars ?? 2000;
    this.budgetChars = options?.budgetChars ?? 40000; // ~10k tokens
  }

  /**
   * Main entrypoint to compress message history before sending to the model API.
   */
  public compress(messages: ChatMessage[]): ChatMessage[] {
    if (!messages || messages.length === 0) return [];

    // Step 1: Prune individual oversized tool outputs or text segments
    let processed = messages.map((msg) => {
      // We prune tool outputs, assistant messages containing tool responses, or general system/user files
      const shouldPrune = msg.role === "tool" || msg.role === "assistant" || msg.role === "system";
      if (shouldPrune) {
        return {
          ...msg,
          content: this.pruneContent(msg.content),
        };
      }
      return msg;
    });

    // Step 2: Budget-based history compaction if total size is still too large
    processed = this.enforceBudget(processed);

    return processed;
  }

  /**
   * Truncates long strings in the middle, leaving head and tail.
   */
  private pruneText(text: string): string {
    if (text.length <= this.pruneLimit) {
      return text;
    }

    const truncatedCount = text.length - 2 * this.keepChars;
    if (truncatedCount <= 0) return text;

    const head = text.slice(0, this.keepChars);
    const tail = text.slice(-this.keepChars);

    return `${head}\n\n... [Truncated ${truncatedCount} characters of tool output] ...\n\n${tail}`;
  }

  private pruneContent(content: ChatContent): ChatContent {
    if (typeof content === "string") {
      return this.pruneText(content);
    }

    if (Array.isArray(content)) {
      return content.map((part) => {
        if (part.type === "text" && part.text) {
          return {
            ...part,
            text: this.pruneText(part.text),
          };
        }
        return part;
      });
    }

    return content;
  }

  private getContentLength(content: ChatContent): number {
    if (typeof content === "string") {
      return content.length;
    }
    if (Array.isArray(content)) {
      return content.reduce((sum, part) => {
        if (part.type === "text" && part.text) {
          return sum + part.text.length;
        }
        return sum;
      }, 0);
    }
    return 0;
  }

  /**
   * Compresses older messages if the total token budget is exceeded.
   */
  private enforceBudget(messages: ChatMessage[]): ChatMessage[] {
    let totalLength = messages.reduce((sum, m) => sum + this.getContentLength(m.content), 0);

    if (totalLength <= this.budgetChars) {
      return messages;
    }

    // We keep the system prompts (usually at index 0 or near start)
    // and the latest 3 turns (conversation head/tail preservation).
    const sysMsgs: ChatMessage[] = [];
    const restMsgs: ChatMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "system" && i < 3) {
        sysMsgs.push(msg);
      } else {
        restMsgs.push(msg);
      }
    }

    // Identify which messages are candidates for memory shrinking.
    // The latest 3 messages must remain untouched to keep short-term context.
    const keepTailCount = Math.min(restMsgs.length, 3);
    const tailMsgs = restMsgs.slice(restMsgs.length - keepTailCount);
    const candidateMsgs = restMsgs.slice(0, restMsgs.length - keepTailCount);

    // Compress candidates starting from the oldest tool/assistant responses.
    for (let i = 0; i < candidateMsgs.length; i++) {
      const msg = candidateMsgs[i];
      if (msg.role === "tool" || msg.role === "assistant") {
        const currentLen = this.getContentLength(msg.content);
        if (currentLen > 100) {
          // Compress the content to a bare minimum descriptor
          candidateMsgs[i] = {
            ...msg,
            content: `[Tool ${msg.name || "call"} output compressed to save context]`,
          };
          totalLength -= currentLen - 50; // approximate reduction
          if (totalLength <= this.budgetChars) {
            break;
          }
        }
      }
    }

    return [...sysMsgs, ...candidateMsgs, ...tailMsgs];
  }
}
