/**
 * Codex adapter — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (+ archived).
 * Two format generations are handled tolerantly:
 *
 *   New (2026+): enveloped lines `{type, timestamp, payload}`.
 *     - `session_meta`  → payload.cwd / payload.id / payload.git.branch
 *     - `event_msg` user_message / agent_message → the CLEAN human conversation
 *       (payload.message). Chosen over `response_item`/message to dedupe and to
 *       skip AGENTS.md / permissions-instruction noise.
 *   Old (2025): bare lines `{type:"message", role, content}` plus a header line
 *     `{id, instructions, timestamp}` (no cwd available).
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

function roots(): string[] {
  const override = process.env.HERMES_EC_CODEX_ROOT;
  if (override) return [override];
  const base = path.join(os.homedir(), ".codex");
  return [path.join(base, "sessions"), path.join(base, "archived_sessions")];
}

/** Last-resort conversation id: the uuid embedded in `rollout-<...>-<uuid>.jsonl`. */
function idFromFilename(absPath: string): string {
  const stem = path.basename(absPath, ".jsonl");
  const match = stem.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match ? match[1] : stem;
}

export const codexAdapter: SourceAdapter = {
  source: "codex",

  roots,

  available() {
    return roots().some((r) => statFile(r) !== null);
  },

  async discoverFiles() {
    const out: DiscoveredFile[] = [];
    for (const base of roots()) {
      const files = walkFiles(
        base,
        (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
        6,
      );
      for (const absPath of files) {
        const stat = statFile(absPath);
        if (!stat) continue;
        out.push({
          source: "codex",
          absPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          strategy: "append",
        });
      }
    }
    return out;
  },

  async parseSlice(
    file: DiscoveredFile,
    fromOffset: number,
  ): Promise<ParseResult> {
    const fallbackId = idFromFilename(file.absPath);
    const messages: ParsedMessage[] = [];
    let conversationId: string | null = null;
    let projectPath: string | null = null;
    let gitBranch: string | null = null;
    let title: string | null = null;
    let startedAt: number | null = null;
    let lastAt: number | null = null;

    const pushMessage = (
      role: "user" | "assistant",
      rawText: string,
      offset: number,
      ts: number | null,
    ): void => {
      const text = capMessage(rawText.trim());
      if (!text) return;
      if (ts !== null) {
        if (startedAt === null || ts < startedAt) startedAt = ts;
        if (lastAt === null || ts > lastAt) lastAt = ts;
      }
      if (role === "user" && !title) title = deriveTitle(text);
      messages.push({
        conversationId: fallbackId,
        seq: offset,
        role,
        ts,
        text,
      });
    };

    for await (const { obj, offset } of readJsonlFrom(
      file.absPath,
      fromOffset,
    )) {
      const type = obj.type;
      const payload = obj.payload as Record<string, unknown> | undefined;
      const envelopeTs = isoToEpoch(obj.timestamp);

      // — New format: session metadata —
      if (type === "session_meta" && payload) {
        if (typeof payload.cwd === "string") projectPath = payload.cwd;
        if (typeof payload.id === "string" && !conversationId) {
          conversationId = payload.id;
        }
        const git = payload.git as Record<string, unknown> | undefined;
        if (git && typeof git.branch === "string") gitBranch = git.branch;
        const metaTs = isoToEpoch(payload.timestamp) ?? envelopeTs;
        if (metaTs !== null && startedAt === null) startedAt = metaTs;
        continue;
      }

      // — New format: clean conversation events —
      if (type === "event_msg" && payload) {
        const pType = payload.type;
        const message =
          typeof payload.message === "string" ? payload.message : "";
        if (pType === "user_message")
          pushMessage("user", message, offset, envelopeTs);
        else if (pType === "agent_message") {
          pushMessage("assistant", message, offset, envelopeTs);
        }
        continue;
      }

      // — Old format: header line with the session id —
      if (!type && typeof obj.id === "string" && "instructions" in obj) {
        if (!conversationId) conversationId = obj.id;
        if (envelopeTs !== null && startedAt === null) startedAt = envelopeTs;
        continue;
      }

      // — Old format: bare message line —
      if (type === "message") {
        const role = obj.role;
        if (role === "user" || role === "assistant") {
          pushMessage(role, extractText(obj.content), offset, envelopeTs);
        }
        continue;
      }
    }

    const convId = conversationId ?? fallbackId;
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
