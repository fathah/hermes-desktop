/**
 * Gemini adapter — `~/.gemini/tmp/<projectDir>/chats/session-*.json`. Each chat
 * is a single whole-file JSON blob (rewritten in place), so the cursor strategy
 * is "replace": on any mtime/size change the conversation is re-parsed from
 * scratch. The real project path is recovered by matching `projectHash`
 * (== sha256 of the project root) against `~/.gemini/history/<slug>/.project_root`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  capMessage,
  deriveTitle,
  extractText,
  isoToEpoch,
  readWholeJson,
  statFile,
  walkFiles,
  type DiscoveredFile,
  type ParseResult,
  type ParsedConversation,
  type ParsedMessage,
  type SourceAdapter,
} from "./types";

function base(): string {
  return (
    process.env.HERMES_EC_GEMINI_ROOT || path.join(os.homedir(), ".gemini")
  );
}

/** Build projectHash → real path from the .project_root markers under history/. */
function buildProjectMap(): Map<string, string> {
  const map = new Map<string, string>();
  const historyRoot = path.join(base(), "history");
  const markers = walkFiles(historyRoot, (name) => name === ".project_root", 2);
  for (const marker of markers) {
    let projectPath: string;
    try {
      projectPath = fs.readFileSync(marker, "utf8").trim();
    } catch {
      continue;
    }
    if (!projectPath) continue;
    const hash = crypto.createHash("sha256").update(projectPath).digest("hex");
    map.set(hash, projectPath);
  }
  return map;
}

/** Map Gemini's role values to our normalised user/assistant. */
function normaliseRole(raw: unknown): "user" | "assistant" | null {
  if (raw === "user") return "user";
  if (raw === "gemini" || raw === "model" || raw === "assistant")
    return "assistant";
  return null;
}

// Cache the project map per adapter instance; rebuilt on each discoverFiles call.
let projectMap: Map<string, string> = new Map();

export const geminiAdapter: SourceAdapter = {
  source: "gemini",

  roots() {
    return [path.join(base(), "tmp")];
  },

  available() {
    return statFile(path.join(base(), "tmp")) !== null;
  },

  async discoverFiles() {
    projectMap = buildProjectMap();
    const tmpRoot = path.join(base(), "tmp");
    const files = walkFiles(
      tmpRoot,
      (name, abs) =>
        name.endsWith(".json") && abs.includes(`${path.sep}chats${path.sep}`),
      4,
    );
    const out: DiscoveredFile[] = [];
    for (const absPath of files) {
      const stat = statFile(absPath);
      if (!stat) continue;
      out.push({
        source: "gemini",
        absPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        strategy: "replace",
      });
    }
    return out;
  },

  async parseSlice(file: DiscoveredFile): Promise<ParseResult> {
    const fallbackId = path.basename(file.absPath, ".json");
    const parsed = readWholeJson(file.absPath);
    const empty: ParseResult = {
      conversation: null,
      messages: [],
      bytesConsumed: file.size,
    };
    if (!parsed || typeof parsed !== "object") return empty;

    const root = parsed as Record<string, unknown>;
    const rawMessages = Array.isArray(root.messages) ? root.messages : [];
    const conversationId =
      typeof root.sessionId === "string" ? root.sessionId : fallbackId;
    const projectHash =
      typeof root.projectHash === "string" ? root.projectHash : "";
    const projectPath = projectMap.get(projectHash) ?? null;
    const summary = typeof root.summary === "string" ? root.summary.trim() : "";
    const startedAt = isoToEpoch(root.startTime);
    const lastAt = isoToEpoch(root.lastUpdated);

    const messages: ParsedMessage[] = [];
    let derivedTitle: string | null = null;
    rawMessages.forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const m = raw as Record<string, unknown>;
      const role = normaliseRole(m.type ?? m.role);
      if (!role) return;
      const text = capMessage(extractText(m.content).trim());
      if (!text) return;
      if (role === "user" && !derivedTitle) derivedTitle = deriveTitle(text);
      messages.push({
        conversationId,
        seq: index,
        role,
        ts: isoToEpoch(m.timestamp),
        text,
      });
    });

    const conversation: ParsedConversation = {
      conversationId,
      projectPath,
      gitBranch: null,
      title: summary || derivedTitle,
      startedAt,
      lastAt,
    };

    return { conversation, messages, bytesConsumed: file.size };
  },
};
