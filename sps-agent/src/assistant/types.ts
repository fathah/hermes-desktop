// assistant/types.ts — the assistant contract. These shapes ARE the architecture:
// the editor already understands this typed union, so any provider (mock, Hermes,
// Anthropic proxy) is a drop-in as long as it returns AssistantResult.
import type { Block, DbView, PersonKey } from "../types";

/** A structured action the assistant can take on the task database. */
export type DbAction =
  | { type: "markDone"; who?: PersonKey | null }
  | { type: "addTask"; title: string }
  | { type: "view"; view: DbView };

/** The discriminated result every AssistantProvider must return. */
export type AssistantResult =
  | { kind: "chat"; reply: string[] }
  | {
      kind: "append";
      reply: string[];
      label: string;
      at: "top" | "bottom";
      blocks: Block[];
    }
  | {
      kind: "diff";
      reply: string[];
      label: string;
      edits: { find: string; html: string }[];
    }
  | { kind: "db"; reply: string[]; label: string; action: DbAction };

/** Context handed to the provider so it can reason about the current page. */
export interface PageContext {
  blocks: Block[];
  pageTitle: string;
}

export interface AssistantProvider {
  respond(prompt: string, ctx: PageContext): Promise<AssistantResult>;
}

/** A chat message rendered in the assistant panel. */
export interface AgentMessage {
  id: string;
  role: "user" | "bot";
  text: string[];
  proposalId?: string;
  label?: string;
  status?: "pending" | "applied" | "rejected";
  diff?: boolean;
  dbAction?: DbAction;
}
