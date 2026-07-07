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
  model?: string;
  provider?: string;
  councilGroupId?: string;
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

export interface ToolGroupMessage {
  id: string;
  kind: "tool_group";
  role: "agent";
  messages: Array<ReasoningMessage | ToolCallMessage | ToolResultMessage>;
}

export interface CouncilTurnMessage {
  id: string;
  kind: "council_turn";
  role: "agent";
  responses: {
    [modelKey: string]: {
      modelLabel: string;
      seatId?: string;
      seatName?: string;
      rolePrompt?: string;
      rubric?: string;
      provider: string;
      model: string;
      content: string;
      isLoading: boolean;
      reasoning?: string;
      error?: string;
      toolProgress?: string;
      approval?: string;
      verdict?: import("../../../../shared/council").CouncilVerdict;
      rationale?: string;
      messageId?: string | number;
    };
  };
  prompt?: string;
}

export type ChatMessage =
  | ChatBubbleMessage
  | ReasoningMessage
  | ToolCallMessage
  | ToolResultMessage
  | ToolGroupMessage
  | CouncilTurnMessage;

export interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: {
    provider: string;
    model: string;
    label: string;
    baseUrl: string;
    disabled?: boolean;
    disabledReasonKey?: string;
  }[];
}

export interface UsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}
