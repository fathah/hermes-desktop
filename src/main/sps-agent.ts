// sps-agent.ts — main-process backend for the SPS Agent workspace view.
//
// Three IPC handlers, all of which can only be done safely/really in the main
// process (not the sandboxed renderer):
//   • sps:unfurl    — SSRF-hardened link preview with IP PINNING (closes the
//                     DNS-rebinding TOCTOU: the validated address is the one the
//                     socket connects to, and every redirect hop is re-validated).
//   • sps:assistant — routes to the user's running Hermes gateway
//                     (/v1/chat/completions), returning a structured AssistantResult.
//                     Real model + tools + memory; no canned logic, no browser key.
//   • sps:load / sps:save — durable workspace persistence under the profile home.
import { promises as fs } from "fs";
import { join, dirname } from "path";
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";
import {
  getApiUrl,
  getRemoteAuthHeader,
  isRemoteMode,
  buildRetrievalSystemMessage,
} from "./hermes";
import { profileHome, getActiveProfileNameSync } from "./utils";
import { assembleVaultContext, type VaultContextUsage } from "./sps-context";
import { resolveSpsVaultDir } from "./sps-storage";
import {
  buildIngestMessages,
  parseChangeset,
  readUnprocessedCaptures,
  readWikiSchema,
  type IngestChangeset,
} from "./sps-ingest";

// ───────────────────────── SSRF guard ─────────────────────────
const BLOCKED_RANGES = new Set([
  "unspecified",
  "loopback",
  "linkLocal",
  "uniqueLocal",
  "private",
  "reserved",
  "broadcast",
  "carrierGradeNat",
]);

function ipIsBlocked(addr: string): boolean {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.parse(addr);
  } catch {
    return true;
  }
  if (ip.kind() === "ipv6") {
    const v6 = ip as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address();
  }
  return BLOCKED_RANGES.has(ip.range());
}

/**
 * undici connect `lookup`: resolve the hostname, reject if ANY resolved address
 * is non-public, and PIN the connection to the validated address. Because undici
 * re-invokes this for every connection — including each redirect hop — a public
 * URL cannot 302 into an internal address, and there is no second unguarded DNS
 * resolution for a rebinding attacker to win.
 */
function guardedLookup(
  hostname: string,
  _options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  const pin = (addr: string): void => {
    const family = net.isIP(addr);
    if (!family || ipIsBlocked(addr)) {
      callback(new Error("blocked host"), "", 0);
      return;
    }
    callback(null, addr, family);
  };
  if (net.isIP(host)) {
    pin(host);
    return;
  }
  dns.lookup(host, { all: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    if (!addresses.length) {
      callback(new Error("unresolved host"), "", 0);
      return;
    }
    if (addresses.some((a) => ipIsBlocked(a.address))) {
      callback(new Error("blocked host"), "", 0);
      return;
    }
    pin(addresses[0].address);
  });
}

// Exported so other main-process fetchers (e.g. src/main/openalex.ts) reuse the
// SAME IP-pinning dispatcher instead of cloning the SSRF guard — keeps the
// load-bearing audit surface single-sourced (see CLAUDE.md).
export const guardedAgent = new Agent({ connect: { lookup: guardedLookup } });

// ───────────────────────── unfurl ─────────────────────────
interface BookmarkMeta {
  url: string;
  title: string;
  desc: string;
  favicon?: string;
  image?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function pick(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}
function absolute(base: string, ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref, base).href;
  } catch {
    return undefined;
  }
}

export async function spsUnfurl(raw: string): Promise<BookmarkMeta> {
  let target: URL;
  try {
    target = new URL(raw.startsWith("http") ? raw : "https://" + raw);
  } catch {
    throw new Error("invalid url");
  }
  if (!/^https?:$/.test(target.protocol)) throw new Error("blocked scheme");

  const res = await undiciFetch(target.href, {
    dispatcher: guardedAgent, // every hop validated + IP-pinned
    redirect: "follow",
    signal: AbortSignal.timeout(6000),
    headers: { "User-Agent": "SPSAgentBot/1.0 (+link-preview)" },
  });
  const html = (await res.text()).slice(0, 200_000);
  const finalUrl = res.url || target.href;
  const host = new URL(finalUrl).hostname.replace("www.", "");
  const title =
    pick(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]) || host;
  const desc =
    pick(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ]) || "";
  const image = absolute(
    finalUrl,
    pick(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    ]),
  );
  const favicon =
    absolute(
      finalUrl,
      pick(html, [
        /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
      ]),
    ) || absolute(finalUrl, "/favicon.ico");
  return { url: finalUrl, title, desc, image, favicon };
}

// ───────────────────────── assistant (gateway-backed) ─────────────────────────
type DbView = "board" | "table" | "list" | "gallery" | "calendar";
type DbAction =
  | { type: "markDone"; who?: string | null }
  | { type: "addTask"; title: string }
  | { type: "view"; view: DbView };
interface AssistantBlock {
  type: string;
  text: string;
  done?: boolean;
  emoji?: string;
}
type AssistantResult = (
  | { kind: "chat"; reply: string[] }
  | {
      kind: "append";
      reply: string[];
      label: string;
      at: "top" | "bottom";
      blocks: AssistantBlock[];
    }
  | {
      kind: "diff";
      reply: string[];
      label: string;
      edits: { find: string; html: string }[];
    }
  | { kind: "db"; reply: string[]; label: string; action: DbAction }
  | {
      kind: "page";
      reply: string[];
      label: string;
      title: string;
      template?: string;
    }
  | {
      kind: "ssh";
      reply: string[];
      label: string;
      action: "start" | "stop";
    }
  | {
      kind: "config";
      reply: string[];
      label: string;
      provider: string;
      key: string;
    }
) & {
  // What the user's own workspace contributed to this reply (drives the trust
  // chip). Attached after validation, omitted when nothing was injected.
  context?: VaultContextUsage;
};

interface PageContext {
  blocks: { type: string; text: string }[];
  pageTitle: string;
  /** Private notes the user pinned to text on this page (unarchived). Injected
   *  into the user turn as authoritative intent; counted in the trust chip. */
  notes?: string[];
}

const ALLOWED_BLOCK_TYPES = new Set([
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
]);

const SYSTEM_PROMPT = `You are the SPS Agent workspace assistant inside a Notion-style document.
You can answer questions, rewrite text as a tracked change, append blocks, or act on the task board.
Respond with EXACTLY ONE JSON object (no prose, no markdown fence) matching one of:
{"kind":"chat","reply":["..."]}
{"kind":"append","reply":["..."],"label":"short label","at":"top"|"bottom","blocks":[{"type":"h3|p|todo|li|callout|quote","text":"...","done":false,"emoji":"🧭"}]}
{"kind":"diff","reply":["..."],"label":"short label","edits":[{"find":"first ~18 chars of the target paragraph","html":"the rewritten text"}]}
{"kind":"db","reply":["..."],"label":"short label","action":{"type":"markDone","who":"maya|theo|priya|sam|null"} | {"type":"addTask","title":"..."} | {"type":"view","view":"board|table|list|gallery|calendar"}}
{"kind":"page","reply":["..."],"label":"short label","title":"Page Title","template":"prd|meeting|research|blank"}
{"kind":"ssh","reply":["..."],"label":"short label","action":"start|stop"}
{"kind":"config","reply":["..."],"label":"short label","provider":"openai|anthropic|google","key":"api_key_here"}
Use "diff" to rewrite/tighten existing text, "append" to add new blocks, "db" for board actions, "page" to create new pages, "ssh" to connect/disconnect the remote tunnel, "config" to set provider API credentials, "chat" otherwise.`;

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
function asReply(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [];
}
function validateResult(raw: unknown): AssistantResult | null {
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
        .filter(
          (b): b is Record<string, unknown> =>
            !!b &&
            typeof b === "object" &&
            ALLOWED_BLOCK_TYPES.has(
              String((b as Record<string, unknown>).type),
            ),
        )
        .map((b) => ({
          type: String(b.type),
          text: typeof b.text === "string" ? b.text : "",
          done: b.done === true ? true : undefined,
          emoji: typeof b.emoji === "string" ? b.emoji : undefined,
        }));
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
      if (typeof r.label !== "string" || typeof r.title !== "string") return null;
      return {
        kind: "page",
        reply,
        label: r.label,
        title: r.title,
        template: typeof r.template === "string" ? r.template : undefined,
      };
    }
    case "ssh": {
      if (typeof r.label !== "string" || (r.action !== "start" && r.action !== "stop")) return null;
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

function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

function pageToText(blocks: { type: string; text: string }[]): string {
  return blocks
    .map((b) => (b.type === "database" ? "[task board]" : b.text))
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the OpenAI-style messages for an SPS assistant request. Pure/testable.
 * The grounding system message (when present) goes AFTER the SYSTEM_PROMPT so
 * its JSON-shape contract stays first, and before the user turn — it only adds
 * workspace context, never reshapes the required structured-output instruction.
 */
export function buildSpsAssistantMessages(
  prompt: string,
  ctx: PageContext,
  grounding?: { role: "system"; content: string } | null,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  if (grounding) messages.push(grounding);
  const cleanNotes = (ctx.notes ?? []).map((n) => n.trim()).filter(Boolean);
  const notesSection = cleanNotes.length
    ? `\n\nYour notes on this page (private annotations you pinned — treat as authoritative intent):\n${cleanNotes
        .map((n) => `- ${n}`)
        .join("\n")}`
    : "";
  messages.push({
    role: "user",
    content: `Page title: ${ctx.pageTitle}\n\nPage content:\n${pageToText(ctx.blocks)}${notesSection}\n\nRequest: ${prompt}`,
  });
  return messages;
}

export async function spsAssistant(
  prompt: string,
  ctx: PageContext,
  profile?: string,
  groundInWorkspace?: boolean,
): Promise<AssistantResult> {
  try {
    // KB grounding: local-only (the vault lives on this machine). Reuses the
    // chat path's retrieval verbatim so the co-author reads ingested docs.
    const grounding =
      groundInWorkspace && !isRemoteMode()
        ? await buildRetrievalSystemMessage(prompt, profile)
        : null;
    const url = `${getApiUrl(profile)}/v1/chat/completions`;
    // Ground the run in the user's own vault + memory (Milestone 1A) AND, when
    // enabled, the opt-in KB retrieval (`grounding`). Both are merged into one
    // system message placed after the SYSTEM_PROMPT by buildSpsAssistantMessages,
    // so the structured-output contract stays first.
    const vaultContext = await assembleVaultContext(
      prompt,
      ctx.pageTitle,
      profile,
    );
    const extraGrounding = [grounding?.content, vaultContext.text]
      .filter(Boolean)
      .join("\n\n");
    const combinedGrounding = extraGrounding
      ? { role: "system" as const, content: extraGrounding }
      : null;
    // Page annotations the user pinned are their own notes too — fold them into
    // the trust chip's note count so it reflects everything that grounded the run.
    const pageNoteCount = (ctx.notes ?? [])
      .map((n) => n.trim())
      .filter(Boolean).length;
    const used = {
      ...vaultContext.used,
      notes: vaultContext.used.notes + pageNoteCount,
    };
    const usedAnything = used.notes + used.memory + used.rules > 0;
    const context: VaultContextUsage | undefined = usedAnything
      ? used
      : undefined;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: "hermes-agent",
        stream: false,
        messages: buildSpsAssistantMessages(prompt, ctx, combinedGrounding),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`gateway ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    const valid = validateResult(parsed);
    const result: AssistantResult = valid ?? {
      kind: "chat",
      reply: [content || "I couldn't structure that as an action."],
    };
    return context ? { ...result, context } : result;
  } catch (err) {
    return {
      kind: "chat",
      reply: [
        `I couldn't reach the assistant: ${err instanceof Error ? err.message : "error"}. Make sure the Hermes gateway is running and a model is configured.`,
      ],
    };
  }
}

// ───────────────────────── ingest (second-brain loop) ─────────────────────────

export interface IngestResult {
  ok: boolean;
  changeset?: IngestChangeset;
  captureCount: number;
  error?: string;
}

/**
 * Process unprocessed inbox captures into a proposed wiki changeset.
 * READ-ONLY over the vault: returns a changeset the desktop reviews/commits —
 * this never writes pages itself (the propose-then-commit keystone).
 */
export async function spsIngestInbox(profile?: string): Promise<IngestResult> {
  try {
    if (isRemoteMode()) {
      return {
        ok: false,
        captureCount: 0,
        error: "Ingest needs a local workspace.",
      };
    }
    const vaultDir = resolveSpsVaultDir(profile);
    const captures = await readUnprocessedCaptures(vaultDir);
    if (captures.length === 0) {
      return {
        ok: true,
        captureCount: 0,
        changeset: {
          summary: "No unprocessed captures.",
          pages: [],
          captures: [],
          memory: [],
        },
      };
    }
    const schema = await readWikiSchema(vaultDir);
    const messages = buildIngestMessages(schema, captures);
    const url = `${getApiUrl(profile)}/v1/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model: "hermes-agent", stream: false, messages }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        captureCount: captures.length,
        error: `gateway ${res.status}: ${body.slice(0, 160)}`,
      };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const changeset = parseChangeset(extractJson(content));
    if (!changeset) {
      return {
        ok: false,
        captureCount: captures.length,
        error: "The agent didn't return a usable changeset.",
      };
    }
    return { ok: true, captureCount: captures.length, changeset };
  } catch (err) {
    return {
      ok: false,
      captureCount: 0,
      error: err instanceof Error ? err.message : "ingest error",
    };
  }
}

// ───────────────────────── persistence ─────────────────────────
function workspacePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "workspace.json",
  );
}

export async function spsLoad(profile?: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(workspacePath(profile), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function spsSave(ws: unknown, profile?: string): Promise<boolean> {
  try {
    const p = workspacePath(profile);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(ws), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Copy the JSON blob to a timestamped backup before a vault migration (S6). */
export async function spsBackupWorkspace(
  profile?: string,
): Promise<string | null> {
  try {
    const p = workspacePath(profile);
    const backup = `${p}.bak-${Date.now()}`;
    await fs.copyFile(p, backup);
    return backup;
  } catch {
    return null;
  }
}

export type { PageContext };
