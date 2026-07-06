import type { Attachment } from "../../../../../shared/attachments";
import type { SlashExecOutcome } from "../slashExec";

export type SlashCommandTarget = "desktop" | "agent" | "model";

export interface SlashCommandMetadata {
  name: string;
  aliases?: string[];
  description: string;
  category: string;
  argsHint?: string;
  source: "desktop" | "agent" | "skill" | "plugin" | "quick-command";
  allowWhileBusy?: boolean;
  supportsAttachments?: boolean;
  /** Pure desktop UI action (open a page/picker, toggle a mode, reset the
   *  chat) that produces no transcript output. When true, the router does not
   *  echo a `/command` user bubble — it would just be a dangling artifact for
   *  an action whose effect is the UI change itself. */
  uiAction?: boolean;
}

export interface ParsedSlashCommand {
  rawInput: string;
  name: string;
  normalizedName: string;
  args: string;
}

export interface DesktopDialog {
  type: string;
  props?: Record<string, unknown>;
}

export interface ModelSubmissionSource {
  type: "desktop-command" | "agent-send" | "agent-skill";
  command: string;
}

export interface PreparedModelSubmission {
  content: string;
  attachments: Attachment[];
  metadata: {
    source: "slash-command";
    route: ModelSubmissionSource["type"];
    command: string;
  };
}

export interface SlashCommandContext {
  profile?: string;
  sessionId?: string;
  selectedText?: string;
  attachments: Attachment[];
  isModelBusy: boolean;

  executeAgentSlash: (
    command: string,
    sys: (text: string) => void,
  ) => Promise<SlashExecOutcome>;
  submitPrompt: (submission: PreparedModelSubmission) => Promise<void>;
  enqueuePrompt: (submission: PreparedModelSubmission) => void;
  addSystemMessage: (content: string) => void;
  executeDesktopSlash: (command: string) => Promise<boolean>;
  renderSlashHelp: () => string;

  openSettings: (section?: string) => void;
  openDialog: (dialog: DesktopDialog) => void;
  startNewChat: () => void;
  clearTranscript: () => void;
}

export type DesktopCommandResult =
  | { type: "handled"; output?: string }
  | { type: "error"; message: string };

export interface DesktopSlashCommand extends SlashCommandMetadata {
  target: "desktop";
  execute: (
    input: ParsedSlashCommand,
    context: SlashCommandContext,
  ) => Promise<DesktopCommandResult>;
}

export interface AgentSlashCommand extends SlashCommandMetadata {
  target: "agent";
}

export interface ModelCommandInput {
  command: string;
  args: string;
  rawInput: string;
  selectedText?: string;
  attachments: Attachment[];
  profile?: string;
  sessionId?: string;
}

export interface ModelPromptDraft {
  content: string;
  attachments?: Attachment[];
  metadata?: Record<string, string>;
}

export type ModelCommandFormatter = (
  input: ModelCommandInput,
  context: SlashCommandContext,
) => Promise<ModelPromptDraft>;

export interface ModelSlashCommand extends SlashCommandMetadata {
  target: "model";
  format: ModelCommandFormatter;
}

export type SlashCommandDefinition =
  | DesktopSlashCommand
  | AgentSlashCommand
  | ModelSlashCommand;

export type SlashCommandResult =
  | { type: "handled"; output?: string }
  | { type: "submitted"; submission: PreparedModelSubmission }
  | { type: "queued"; submission: PreparedModelSubmission }
  | { type: "error"; message: string };

export interface SlashCommandCatalog {
  commands: SlashCommandDefinition[];
  byName: Map<string, SlashCommandDefinition>;
  aliases: Map<string, string>;
  resolve: (name: string) => SlashCommandDefinition | undefined;
}

export interface AgentCommandsCatalogResponse {
  canon?: Record<string, string>;
  categories?: Array<{
    name: string;
    pairs: [string, string][];
  }>;
  pairs?: [string, string][];
  warning?: string;
}
