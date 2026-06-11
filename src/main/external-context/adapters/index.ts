/** Registry of all source adapters, keyed by source. */
import type {
  ExternalImportSource,
  ExternalScanSource,
} from "../../../shared/external-context";
import { chatgptAdapter } from "./chatgpt";
import { claudeAiAdapter } from "./claude-ai";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";
import { geminiTakeoutAdapter } from "./gemini-takeout";
import { grokAdapter } from "./grok";
import { grokExportAdapter } from "./grok-export";
import type { SourceAdapter } from "./types";

/**
 * Live-scan adapters — exhaustive over every {@link ExternalScanSource}, so a
 * new scan source is a compile error until its adapter is registered here.
 */
export const ADAPTERS: Record<ExternalScanSource, SourceAdapter> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  grok: grokAdapter,
};

/**
 * Import adapters — filled incrementally (3.2 ChatGPT, 3.3 Claude.ai/Grok,
 * 3.4 Gemini Takeout). Partial on purpose: an import source with no adapter yet
 * is simply never scanned, and the import IPC (3.6) rejects it gracefully.
 */
export const IMPORT_ADAPTERS: Partial<
  Record<ExternalImportSource, SourceAdapter>
> = {
  chatgpt: chatgptAdapter,
  "claude-ai": claudeAiAdapter,
  "grok-export": grokExportAdapter,
  "gemini-takeout": geminiTakeoutAdapter,
};

export const ALL_ADAPTERS: SourceAdapter[] = [
  ...Object.values(ADAPTERS),
  ...Object.values(IMPORT_ADAPTERS).filter(
    (a): a is SourceAdapter => a !== undefined,
  ),
];

export * from "./types";
