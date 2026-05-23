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

export type ChatMessage =
  | ChatBubbleMessage
  | ReasoningMessage
  | ToolCallMessage
  | ToolResultMessage;

/**
 * Type guard: `true` when `m` is a `ChatBubbleMessage` — i.e. a visible
 * user / assistant chat bubble. The other `ChatMessage` variants
 * (`ReasoningMessage`, `ToolCallMessage`, `ToolResultMessage`) are
 * history-only sub-rows attached to an assistant turn (see PR #327) and
 * have a different shape — they have no `.content` on `ReasoningMessage`,
 * no `.content` on `ToolCallMessage`, etc.
 *
 * Consumers that read `.content` / `.attachments` directly off a
 * `ChatMessage` (the live-stream chunk appender, the copy-as-transcript
 * builder, the send-to-agent history mapper) must filter or narrow with
 * this guard first. Routed-by-`kind` consumers (MessageList) do not need
 * it — they discriminate exhaustively.
 */
export function isBubbleMessage(m: ChatMessage): m is ChatBubbleMessage {
  return m.kind === undefined || m.kind === "user" || m.kind === "assistant";
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
}
