/**
 * Paste adapter (P5.1) — indexes conversations the user PASTED in (tools with no
 * export, chiefly Perplexity). The paste IPC stages each capture as a tiny
 * `{ origin, text }` JSON envelope under the source's import root; this adapter
 * discovers those envelopes and runs the raw text through the heuristic
 * `parsePastedConversation`. One envelope ≈ one conversation. Like every adapter
 * it only emits fragments — redaction happens downstream in db.applyFragments.
 */
import {
  readWholeJson,
  statFile,
  walkFiles,
  type DiscoveredFile,
  type ParseResult,
  type SourceAdapter,
} from "./types";
import { importRootFor } from "../import-roots";
import { parsePastedConversation } from "../paste-parse";

/** The staged payload: the raw pasted text + the tool it was copied from. */
interface PasteEnvelope {
  origin?: string;
  text?: string;
}

export const pasteAdapter: SourceAdapter = {
  source: "paste",

  roots() {
    return [importRootFor("paste")];
  },

  available() {
    return statFile(importRootFor("paste")) !== null;
  },

  async discoverFiles() {
    const root = importRootFor("paste");
    const files = walkFiles(
      root,
      (name) => name.toLowerCase().endsWith(".json"),
      3,
    );
    const out: DiscoveredFile[] = [];
    for (const absPath of files) {
      const stat = statFile(absPath);
      if (!stat) continue;
      out.push({
        source: "paste",
        absPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        strategy: "replace",
      });
    }
    return out;
  },

  async parseSlice(file: DiscoveredFile): Promise<ParseResult> {
    const raw = readWholeJson(file.absPath);
    const env: PasteEnvelope =
      raw && typeof raw === "object" ? (raw as PasteEnvelope) : {};
    const parsed = parsePastedConversation(
      typeof env.text === "string" ? env.text : "",
      {
        origin: typeof env.origin === "string" ? env.origin : "",
        mtimeMs: file.mtimeMs,
      },
    );
    return {
      conversation: null,
      conversations: parsed.conversation ? [parsed.conversation] : [],
      messages: parsed.messages,
      bytesConsumed: file.size,
    };
  },
};
