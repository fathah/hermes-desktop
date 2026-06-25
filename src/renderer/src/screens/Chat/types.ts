export type {
  Attachment,
  AttachmentKind,
} from "../../../../shared/attachments";

import type { Attachment } from "../../../../shared/attachments";

/**
 * Visible chat bubble (user or assistant). Used for live streaming and as
 * one of the variants of the broader `ChatMessage` history union.
 */
export interface ChatBubbleMessage {
  id: string;
  kind?: "user" | "assistant"; // optional for backward compat; absent ⇒ user/assistant by role
  role: "user" | "agent";
  content: string;
  attachments?: Attachment[];
  /** Renderer-local or streamed assistant failure metadata. */
  error?: string;
  /** True while an optimistic assistant bubble is still being finalized. */
  pending?: boolean;
  /** True for UI-only messages that do not have a canonical state.db row. */
  localOnly?: boolean;
  /** Renderer-local turn identity used to anchor local failures. */
  turnId?: string;
  /** Epoch-ms the message was recorded; surfaced as a hover timestamp. */
  timestamp?: number;
}

/**
 * Sub-row attached to an assistant turn, surfaced as a collapsible widget
 * in the chat transcript. Created by the main-process session loader from
 * the agent's state DB (`reasoning*` / `tool_calls` / `role='tool'` rows)
 * — none of these have a live-streaming counterpart in the desktop yet.
 */
export interface ReasoningMessage {
  id: string;
  kind: "reasoning";
  role: "agent";
  text: string;
}

export interface ToolCallMessage {
  id: string;
  kind: "tool_call";
  role: "agent";
  callId: string;
  name: string;
  args: string;
  status?: "running" | "completed" | "failed";
}

export interface ToolResultMessage {
  id: string;
  kind: "tool_result";
  role: "agent";
  callId: string;
  name: string;
  content: string;
  attachments?: Attachment[];
}

/**
 * An inline clarifying question from the agent (`clarify.request`). Rendered as
 * a card in the transcript: choice buttons when `choices` is non-empty, else an
 * open-ended textarea, plus an auto-choose toggle and a skip ("let Hermes
 * decide") control. `resolved` flips once the user answers/skips so the card
 * disables its controls and shows the chosen answer.
 */
export interface ClarifyMessage {
  id: string;
  kind: "clarify";
  role: "agent";
  requestId: string;
  question: string;
  choices: string[];
  answer?: string;
  resolved?: boolean;
}

export type ChatMessage =
  | ChatBubbleMessage
  | ReasoningMessage
  | ToolCallMessage
  | ToolResultMessage
  | ClarifyMessage;

export interface ActiveTurn {
  turnId: string;
  userId: string;
  startIndex: number;
  status: "running" | "failed" | "completed";
}

export interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: {
    provider: string;
    model: string;
    label: string;
    baseUrl: string;
  }[];
}

export interface UsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  /** Latest turn's prompt tokens = current context-window occupancy (NOT
   *  summed across turns, unlike promptTokens). Drives the context gauge. */
  contextTokens?: number;
  /** Latest turn's prompt-cache read/write tokens, if the provider reports them. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
