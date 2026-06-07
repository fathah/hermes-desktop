// BridgeAssistant.ts — routes assistant requests through the Electron main process,
// which calls the user's running Hermes gateway (/v1/chat/completions) with their
// configured model + tools + memory and returns a validated AssistantResult.
// Output is re-validated defensively here. Falls back to a chat reply on any error.
import { validateResult } from "../validate";
import { getGroundInWorkspace } from "../../../../lib/grounding";
import type {
  AssistantContext,
  AssistantProvider,
  AssistantResult,
  PageContext,
} from "../types";

/** Narrow the IPC payload's context summary, dropping anything malformed. */
function readContext(raw: unknown): AssistantContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = (raw as { context?: unknown }).context;
  if (!c || typeof c !== "object") return undefined;
  const r = c as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && v >= 0 ? v : 0);
  const ctx: AssistantContext = {
    notes: num(r.notes),
    memory: num(r.memory),
    rules: num(r.rules),
  };
  if (ctx.notes + ctx.memory + ctx.rules === 0) return undefined;
  return ctx;
}

export class BridgeAssistant implements AssistantProvider {
  async respond(prompt: string, ctx: PageContext): Promise<AssistantResult> {
    try {
      const raw = await window.hermesAPI.spsAssistant(
        prompt,
        {
          blocks: ctx.blocks.map((b) => ({ type: b.type, text: b.text })),
          pageTitle: ctx.pageTitle,
          ...(ctx.notes && ctx.notes.length ? { notes: ctx.notes } : {}),
        },
        undefined,
        getGroundInWorkspace(),
      );
      const validated = validateResult(raw) ?? {
        kind: "chat" as const,
        reply: [
          String((raw as { reply?: string[] })?.reply?.[0] ?? "No response."),
        ],
      };
      // validateResult rebuilds the object and drops unknown fields, so re-attach
      // the trust-chip context summary from the raw IPC payload.
      const context = readContext(raw);
      return context ? { ...validated, context } : validated;
    } catch (err) {
      return {
        kind: "chat",
        reply: [
          `Assistant error: ${err instanceof Error ? err.message : "unknown"}.`,
        ],
      };
    }
  }
}
