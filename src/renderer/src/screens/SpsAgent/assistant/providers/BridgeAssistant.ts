// BridgeAssistant.ts — routes assistant requests through the Electron main process,
// which calls the user's running Hermes gateway (/v1/chat/completions) with their
// configured model + tools + memory and returns a validated AssistantResult.
// Output is re-validated defensively here. Falls back to a chat reply on any error.
import { validateResult } from "../validate";
import type { AssistantProvider, AssistantResult, PageContext } from "../types";

export class BridgeAssistant implements AssistantProvider {
  async respond(prompt: string, ctx: PageContext): Promise<AssistantResult> {
    try {
      const raw = await window.hermesAPI.spsAssistant(prompt, {
        blocks: ctx.blocks.map((b) => ({ type: b.type, text: b.text })),
        pageTitle: ctx.pageTitle,
      });
      return (
        validateResult(raw) ?? {
          kind: "chat",
          reply: [
            String((raw as { reply?: string[] })?.reply?.[0] ?? "No response."),
          ],
        }
      );
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
