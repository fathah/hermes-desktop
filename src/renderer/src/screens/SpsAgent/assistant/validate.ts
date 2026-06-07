// validate.ts — guard untrusted model output against the AssistantResult union.
// Anything off-contract returns null; the provider then falls back to a chat reply.
import { blk } from "../lib/ids";
import type { Block, BlockType, DbView } from "../types";
import type { AssistantResult, DbAction } from "./types";

const BLOCK_TYPES: BlockType[] = [
  "p",
  "h1",
  "h2",
  "h3",
  "todo",
  "li",
  "numli",
  "toggle",
  "quote",
  "callout",
  "code",
  "divider",
];

function asReply(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [];
}

function coerceBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = (r.type as BlockType) || "p";
  if (!BLOCK_TYPES.includes(type)) return null;
  const extra: Partial<Block> = {};
  if (type === "todo") extra.done = Boolean(r.done);
  if (typeof r.emoji === "string") extra.emoji = r.emoji;
  return blk(type, typeof r.text === "string" ? r.text : "", extra);
}

function coerceAction(raw: unknown): DbAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "markDone")
    return { type: "markDone", who: typeof r.who === "string" ? r.who : null };
  if (r.type === "addTask")
    return { type: "addTask", title: String(r.title || "New task") };
  if (
    r.type === "view" &&
    ["board", "table", "list", "gallery", "calendar"].includes(String(r.view))
  )
    return { type: "view", view: r.view as DbView };
  return null;
}

export function validateResult(raw: unknown): AssistantResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const reply = asReply(r.reply);

  switch (r.kind) {
    case "chat":
      return reply.length ? { kind: "chat", reply } : null;
    case "append": {
      if (
        typeof r.label !== "string" ||
        (r.at !== "top" && r.at !== "bottom") ||
        !Array.isArray(r.blocks)
      )
        return null;
      const blocks = r.blocks
        .map(coerceBlock)
        .filter((b): b is Block => b !== null);
      return blocks.length
        ? { kind: "append", reply, label: r.label, at: r.at, blocks }
        : null;
    }
    case "diff": {
      if (typeof r.label !== "string" || !Array.isArray(r.edits)) return null;
      const edits = r.edits.filter(
        (e): e is { find: string; html: string } =>
          !!e &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).find === "string" &&
          typeof (e as Record<string, unknown>).html === "string",
      );
      return edits.length
        ? { kind: "diff", reply, label: r.label, edits }
        : null;
    }
    case "db": {
      if (typeof r.label !== "string") return null;
      const action = coerceAction(r.action);
      return action ? { kind: "db", reply, label: r.label, action } : null;
    }
    case "page": {
      if (typeof r.label !== "string" || typeof r.title !== "string")
        return null;
      return {
        kind: "page",
        reply,
        label: r.label,
        title: r.title,
        template: typeof r.template === "string" ? r.template : undefined,
      };
    }
    case "ssh": {
      if (
        typeof r.label !== "string" ||
        (r.action !== "start" && r.action !== "stop")
      )
        return null;
      return {
        kind: "ssh",
        reply,
        label: r.label,
        action: r.action as "start" | "stop",
      };
    }
    case "config": {
      if (
        typeof r.label !== "string" ||
        typeof r.provider !== "string" ||
        typeof r.key !== "string"
      )
        return null;
      return {
        kind: "config",
        reply,
        label: r.label,
        provider: r.provider,
        key: r.key,
      };
    }
    default:
      return null;
  }
}
