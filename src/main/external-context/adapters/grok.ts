/**
 * Grok adapter — `~/.grok/sessions/<urlEncodedProjectPath>/<uuid>/chat_history.jsonl`.
 * Append-only JSONL of `{type, content}` lines (system / user / assistant /
 * reasoning / tool_result). User content is a list of text blocks; assistant
 * content is a string. There are no per-message timestamps, so conversation
 * recency falls back to the file mtime. The project path is the url-decoded
 * grandparent directory; the conversation id is the uuid parent directory.
 */
import os from "node:os";
import path from "node:path";
import {
  capMessage,
  deriveTitle,
  extractText,
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
    process.env.HERMES_EC_GROK_ROOT ||
    path.join(os.homedir(), ".grok", "sessions")
  );
}

function decodeProjectPath(encoded: string): string | null {
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded || null;
  } catch {
    return encoded || null;
  }
}

export const grokAdapter: SourceAdapter = {
  source: "grok",

  roots() {
    return [root()];
  },

  available() {
    return statFile(root()) !== null;
  },

  async discoverFiles() {
    const files = walkFiles(root(), (name) => name === "chat_history.jsonl", 4);
    const out: DiscoveredFile[] = [];
    for (const absPath of files) {
      const stat = statFile(absPath);
      if (!stat) continue;
      out.push({
        source: "grok",
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
    const uuidDir = path.basename(path.dirname(file.absPath));
    const encodedProject = path.basename(
      path.dirname(path.dirname(file.absPath)),
    );
    const projectPath = decodeProjectPath(encodedProject);

    const messages: ParsedMessage[] = [];
    let title: string | null = null;

    for await (const { obj, offset } of readJsonlFrom(
      file.absPath,
      fromOffset,
    )) {
      const role = obj.type;
      if (role !== "user" && role !== "assistant") continue;
      const text = capMessage(extractText(obj.content).trim());
      if (!text) continue;
      if (role === "user" && !title) title = deriveTitle(text);
      messages.push({
        conversationId: uuidDir,
        seq: offset,
        role,
        ts: null,
        text,
      });
    }

    const conversation: ParsedConversation = {
      conversationId: uuidDir,
      projectPath,
      gitBranch: null,
      title,
      startedAt: null,
      lastAt: file.mtimeMs,
    };

    return { conversation, messages, bytesConsumed: file.size };
  },
};
