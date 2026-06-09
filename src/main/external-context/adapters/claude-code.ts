/**
 * Claude Code adapter — `~/.claude/projects/<encodedProject>/<sessionId>.jsonl`.
 * One append-only JSONL per session; every line carries `cwd`/`gitBranch`, and
 * `message.content` is a string (user) or a list of content blocks (assistant).
 */
import os from "node:os";
import path from "node:path";
import {
  capMessage,
  deriveTitle,
  extractText,
  isoToEpoch,
  readJsonlFrom,
  statFile,
  walkFiles,
  type DiscoveredFile,
  type ParseResult,
  type ParsedConversation,
  type ParsedMessage,
  type SourceAdapter,
} from "./types";

function root(): string {
  return (
    process.env.HERMES_EC_CLAUDE_ROOT ||
    path.join(os.homedir(), ".claude", "projects")
  );
}

export const claudeCodeAdapter: SourceAdapter = {
  source: "claude-code",

  roots() {
    return [root()];
  },

  available() {
    return statFile(root()) !== null;
  },

  async discoverFiles() {
    const base = root();
    const files = walkFiles(base, (name) => name.endsWith(".jsonl"), 4);
    const out: DiscoveredFile[] = [];
    for (const absPath of files) {
      const stat = statFile(absPath);
      if (!stat) continue;
      out.push({
        source: "claude-code",
        absPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        strategy: "append",
      });
    }
    return out;
  },

  async parseSlice(
    file: DiscoveredFile,
    fromOffset: number,
  ): Promise<ParseResult> {
    const fallbackId = path.basename(file.absPath, ".jsonl");
    const messages: ParsedMessage[] = [];
    let conversationId: string | null = null;
    let projectPath: string | null = null;
    let gitBranch: string | null = null;
    let title: string | null = null;
    let startedAt: number | null = null;
    let lastAt: number | null = null;

    for await (const { obj, offset } of readJsonlFrom(
      file.absPath,
      fromOffset,
    )) {
      const type = obj.type;
      if (typeof obj.cwd === "string" && !projectPath) projectPath = obj.cwd;
      if (typeof obj.gitBranch === "string" && !gitBranch && obj.gitBranch) {
        gitBranch = obj.gitBranch;
      }
      if (typeof obj.sessionId === "string" && !conversationId) {
        conversationId = obj.sessionId;
      }
      if (type !== "user" && type !== "assistant") continue;

      const message = obj.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const text = capMessage(extractText(message.content).trim());
      if (!text) continue;

      const ts = isoToEpoch(obj.timestamp);
      if (ts !== null) {
        if (startedAt === null || ts < startedAt) startedAt = ts;
        if (lastAt === null || ts > lastAt) lastAt = ts;
      }
      if (type === "user" && !title) title = deriveTitle(text);

      messages.push({
        conversationId: conversationId ?? fallbackId,
        seq: offset,
        role: type,
        ts,
        text,
      });
    }

    const convId = conversationId ?? fallbackId;
    // Stamp the conversationId onto any message that was queued before we saw it.
    for (const m of messages) m.conversationId = convId;

    const conversation: ParsedConversation = {
      conversationId: convId,
      projectPath,
      gitBranch,
      title,
      startedAt,
      lastAt,
    };

    return { conversation, messages, bytesConsumed: file.size };
  },
};
