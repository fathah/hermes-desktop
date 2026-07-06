import type { Attachment } from "./attachments";

export type DesktopSessionContinuationItem =
  | {
      kind: "user";
      content: string;
      attachments?: Attachment[];
    }
  | {
      kind: "assistant";
      content: string;
      error?: string;
      attachments?: Attachment[];
    }
  | {
      kind: "reasoning";
      text: string;
    }
  | {
      kind: "tool_call";
      callId: string;
      name: string;
      args: string;
    }
  | {
      kind: "tool_result";
      callId: string;
      name: string;
      content: string;
      attachments?: Attachment[];
    };

export interface DesktopSessionLocalError {
  error: string;
  userContent: string;
}
