/** Registry of all source adapters, keyed by source. */
import type { ExternalSource } from "../../../shared/external-context";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";
import { grokAdapter } from "./grok";
import type { SourceAdapter } from "./types";

export const ADAPTERS: Record<ExternalSource, SourceAdapter> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  grok: grokAdapter,
};

export const ALL_ADAPTERS: SourceAdapter[] = Object.values(ADAPTERS);

export * from "./types";
