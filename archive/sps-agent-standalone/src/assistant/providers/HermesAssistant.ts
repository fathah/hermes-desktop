// HermesAssistant.ts — real provider. Calls the repo's OpenAI-compatible Hermes
// server (/v1/chat/completions, proxied by Vite) and validates the model's output
// against the AssistantResult union, falling back to a chat reply if off-contract.
// No API key in the browser — auth lives behind the proxy / Hermes config.
import type { Block } from "../../types";
import type { AssistantProvider, AssistantResult, PageContext } from "../types";
import { validateResult } from "../validate";

const MODEL = import.meta.env.VITE_HERMES_MODEL || "anthropic/claude-opus-4.6";

const SYSTEM = `You are the SPS Agent workspace assistant inside a Notion-style document.
You can answer questions, rewrite text as a tracked change, append blocks, or act on the task board.

Respond with EXACTLY ONE JSON object (no prose, no markdown fence) matching one of these shapes:
{"kind":"chat","reply":["..."]}
{"kind":"append","reply":["..."],"label":"short label","at":"top"|"bottom","blocks":[{"type":"h3|p|todo|li|callout|quote","text":"...","done":false,"emoji":"🧭"}]}
{"kind":"diff","reply":["..."],"label":"short label","edits":[{"find":"first ~18 chars of the target paragraph","html":"the rewritten text"}]}
{"kind":"db","reply":["..."],"label":"short label","action":{"type":"markDone","who":"maya|theo|priya|sam|null"} | {"type":"addTask","title":"..."} | {"type":"view","view":"board|table|list|gallery|calendar"}}

Use "diff" to rewrite/tighten existing text, "append" to add new blocks, "db" for board actions, "chat" otherwise.`;

function pageToText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === "database" ? "[task board]" : b.text))
    .filter(Boolean)
    .join("\n");
}

export class HermesAssistant implements AssistantProvider {
  async respond(prompt: string, ctx: PageContext): Promise<AssistantResult> {
    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `Page title: ${ctx.pageTitle}\n\nPage content:\n${pageToText(ctx.blocks)}\n\nRequest: ${prompt}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });
      if (!res.ok) throw new Error(`Hermes ${res.status}`);
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          kind: "chat",
          reply: [text || "I couldn't parse a structured response."],
        };
      }
      const valid = validateResult(parsed);
      return (
        valid ?? {
          kind: "chat",
          reply: [text || "I couldn't structure that as an action."],
        }
      );
    } catch (err) {
      return {
        kind: "chat",
        reply: [
          `I couldn't reach the assistant backend (${err instanceof Error ? err.message : "error"}). Start the Hermes gateway, or set VITE_ASSISTANT_PROVIDER=mock for offline mode.`,
        ],
      };
    }
  }
}
