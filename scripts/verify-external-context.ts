// Standalone runtime proof for the External Context Bridge index. Runs under
// Electron's node (ELECTRON_RUN_AS_NODE=1) so the Electron-ABI better-sqlite3
// binary loads. Bundled via esbuild and executed by verify-external-context.sh.
//
// Proves: per-source indexing, FTS search + provenance, index-time redaction
// (a seeded sk-ant key + a known secret never reach messages OR messages_fts),
// incremental append (only the delta is indexed), truncation → full reparse,
// and rebuild. From commit 7 it also asserts the MCP stdio roundtrip.
import Database from "better-sqlite3";
import crypto from "crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ExternalContextDb } from "../src/main/external-context/db";
import { scanExternalSources } from "../src/main/external-context/index";
import type { ExternalSource } from "../src/shared/external-context";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok -", msg);
}

const SK_ANT =
  "" +
  [
    "sk-ant-a",
    "pi03-LEA",
    "KED01234",
    "56789LEA",
    "KED01234",
    "56789LEA",
    "KED01-se",
    "cretx",
  ].join("") +
  "";
const KNOWN_SECRET = "remote-bearer-token-abcdef123456";
const ALL_ON: Record<ExternalSource, boolean> = {
  "claude-code": true,
  codex: true,
  gemini: true,
  grok: true,
  // Import sources have no live adapter/fixtures here — enabling them is a
  // no-op (scan skips sources without a registered adapter), but the literal
  // must stay exhaustive over ExternalSource.
  chatgpt: true,
  "claude-ai": true,
  "grok-export": true,
  "gemini-takeout": true,
  paste: true,
};

function seedClaude(
  root: string,
  sessionId: string,
  extraSecret: boolean,
): string {
  const dir = join(root, "-Users-test-proj");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "user",
      cwd: "/Users/test/proj",
      gitBranch: "main",
      sessionId,
      timestamp: "2026-06-10T09:00:01.000Z",
      message: {
        role: "user",
        content: extraSecret
          ? `design the widget pipeline using ${SK_ANT} and token ${KNOWN_SECRET}`
          : "design the widget pipeline",
      },
    }),
    JSON.stringify({
      type: "assistant",
      cwd: "/Users/test/proj",
      gitBranch: "main",
      sessionId,
      timestamp: "2026-06-10T09:00:05.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Batch the widgets in a worker pool." },
        ],
      },
    }),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function seedCodex(root: string): void {
  const dir = join(root, "2026", "06", "04");
  mkdirSync(dir, { recursive: true });
  const id = "99999999-8888-7777-6666-555555555555";
  const lines = [
    JSON.stringify({
      type: "session_meta",
      timestamp: "2026-06-04T10:00:00.000Z",
      payload: {
        id,
        cwd: "/Users/test/codexproj",
        git: { branch: "feature/x" },
        timestamp: "2026-06-04T10:00:00.000Z",
      },
    }),
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-06-04T10:00:02.000Z",
      payload: { type: "user_message", message: "search the affine repo" },
    }),
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-06-04T10:00:10.000Z",
      payload: { type: "agent_message", message: "Found and summarised it." },
    }),
  ];
  writeFileSync(
    join(dir, `rollout-2026-06-04T10-00-00-${id}.jsonl`),
    lines.join("\n") + "\n",
  );
}

function seedGemini(root: string): void {
  const projectPath = "/tmp/gem-verify-project";
  const hash = crypto.createHash("sha256").update(projectPath).digest("hex");
  const histDir = join(root, "history", "gemproj");
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, ".project_root"), projectPath + "\n");
  const chatDir = join(root, "tmp", "gemproj", "chats");
  mkdirSync(chatDir, { recursive: true });
  const blob = {
    kind: "chat",
    sessionId: "gem-verify-0001",
    projectHash: hash,
    startTime: "2026-06-08T12:00:00.000Z",
    lastUpdated: "2026-06-08T12:05:00.000Z",
    summary: "Save to Knowledge Base",
    messages: [
      {
        id: "g1",
        timestamp: "2026-06-08T12:00:01.000Z",
        type: "user",
        content: [{ text: "save to the knowledge base please" }],
      },
      {
        id: "g2",
        timestamp: "2026-06-08T12:00:30.000Z",
        type: "gemini",
        content: [{ text: "Add an IPC handler that writes a vault page." }],
      },
    ],
  };
  writeFileSync(join(chatDir, "session-x.json"), JSON.stringify(blob, null, 2));
}

function seedGrok(root: string): void {
  const dir = join(
    root,
    "%2Ftmp%2Fgrok-verify",
    "11111111-2222-3333-4444-555555555555",
  );
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "system",
      content: "You are an AI coding assistant.",
    }),
    JSON.stringify({
      type: "user",
      content: [{ type: "text", text: "steelman the bridge idea" }],
    }),
    JSON.stringify({
      type: "assistant",
      content: "It makes Hermes the continuity layer.",
    }),
  ];
  writeFileSync(join(dir, "chat_history.jsonl"), lines.join("\n") + "\n");
}

/** Seed a ChatGPT export (conversations.json) into the import root: one branched
 *  conversation (chosen vs abandoned answer) with a secret in the opening user
 *  message, plus one linear conversation. Returns the staged file path. */
function seedChatGpt(importRoot: string): string {
  const dir = join(importRoot, "chatgpt");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "deadbeefcafef00d.json");
  const branched = {
    title: "Imported branched chat",
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
    conversation_id: "c-import-branched",
    current_node: "a-chosen",
    mapping: {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          author: { role: "user" },
          create_time: 1_700_000_001,
          content: {
            content_type: "text",
            parts: [`my key is ${SK_ANT} and token ${KNOWN_SECRET}`],
          },
        },
        parent: "root",
        children: ["a-abandoned", "a-chosen"],
      },
      "a-abandoned": {
        id: "a-abandoned",
        message: {
          author: { role: "assistant" },
          create_time: 1_700_000_002,
          content: { content_type: "text", parts: ["abandonedreply variant"] },
        },
        parent: "u1",
        children: [],
      },
      "a-chosen": {
        id: "a-chosen",
        message: {
          author: { role: "assistant" },
          create_time: 1_700_000_003,
          content: { content_type: "text", parts: ["chosenreply variant"] },
        },
        parent: "u1",
        children: [],
      },
    },
  };
  const linear = {
    title: "Imported linear chat",
    create_time: 1_700_001_000,
    update_time: 1_700_001_100,
    conversation_id: "c-import-linear",
    current_node: "l-a",
    mapping: {
      "l-u": {
        id: "l-u",
        message: {
          author: { role: "user" },
          create_time: 1_700_001_001,
          content: { content_type: "text", parts: ["plain question"] },
        },
        parent: null,
        children: ["l-a"],
      },
      "l-a": {
        id: "l-a",
        message: {
          author: { role: "assistant" },
          create_time: 1_700_001_002,
          content: { content_type: "text", parts: ["plain answer"] },
        },
        parent: "l-u",
        children: [],
      },
    },
  };
  writeFileSync(file, JSON.stringify([branched, linear]));
  return file;
}

/** Seed a Claude.ai export (linear chat_messages) with a secret in the opening
 *  human message, into the import root. */
function seedClaudeAi(importRoot: string): void {
  const dir = join(importRoot, "claude-ai");
  mkdirSync(dir, { recursive: true });
  const conv = {
    uuid: "c-claudeai-1",
    name: "Imported Claude.ai chat",
    created_at: "2026-02-01T00:00:00.000000Z",
    updated_at: "2026-02-01T00:05:00.000000Z",
    chat_messages: [
      {
        sender: "human",
        created_at: "2026-02-01T00:00:00.000000Z",
        content: [
          {
            type: "text",
            text: `store this key ${SK_ANT} and ${KNOWN_SECRET}`,
          },
        ],
      },
      {
        sender: "assistant",
        created_at: "2026-02-01T00:00:03.000000Z",
        content: [{ type: "text", text: "claudeaireply acknowledged" }],
      },
    ],
  };
  writeFileSync(join(dir, "1a2b3c4d.json"), JSON.stringify([conv]));
}

/** Seed a Grok session export (`{type, content}` JSONL) with a secret in the
 *  user turn, into the import root. */
function seedGrokExport(importRoot: string): void {
  const dir = join(importRoot, "grok-export");
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "system", content: "be terse" }),
    JSON.stringify({
      type: "user",
      content: [
        { type: "text", text: `my secret ${KNOWN_SECRET} and ${SK_ANT}` },
      ],
    }),
    JSON.stringify({ type: "assistant", content: "grokexportreply noted." }),
  ];
  writeFileSync(join(dir, "f00dbabe.jsonl"), lines.join("\n") + "\n");
}

/** Seed a Gemini Takeout MyActivity.json: two prompts within a session and one
 *  after a > 30-min gap (→ two pseudo-conversations), with a secret in a title. */
function seedGeminiTakeout(importRoot: string): void {
  const dir = join(importRoot, "gemini-takeout");
  mkdirSync(dir, { recursive: true });
  const base = Date.UTC(2026, 4, 1, 10, 0, 0);
  const records = [
    {
      header: "Gemini Apps",
      title: "Prompted geminitakeoutreply please",
      time: new Date(base).toISOString(),
      products: ["Gemini Apps"],
    },
    {
      header: "Gemini Apps",
      title: `leaking ${SK_ANT} and ${KNOWN_SECRET}`,
      time: new Date(base + 10 * 60 * 1000).toISOString(),
      products: ["Gemini Apps"],
    },
    {
      header: "Gemini Apps",
      title: "a prompt after a long break",
      time: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
      products: ["Gemini Apps"],
    },
  ];
  writeFileSync(join(dir, "9988aabb.json"), JSON.stringify(records));
}

/** Seed a PASTED capture (P5.1): a `{ origin, text }` envelope with a secret in
 *  the user turn, staged under the paste import root. The heuristic parser turns
 *  it into one conversation (user + assistant), so the index-time redaction that
 *  rides through applyFragments must scrub it exactly like every other source. */
function seedPaste(importRoot: string): void {
  const dir = join(importRoot, "paste");
  mkdirSync(dir, { recursive: true });
  const text = [
    "You said:",
    `capture this paste key ${SK_ANT} and token ${KNOWN_SECRET}`,
    "Perplexity",
    "pastedreply acknowledged",
  ].join("\n");
  writeFileSync(
    join(dir, "cafef00d.json"),
    JSON.stringify({ origin: "Perplexity", text }),
  );
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "ec-verify-"));
  const claudeRoot = join(work, "claude");
  const codexRoot = join(work, "codex");
  const geminiRoot = join(work, "gemini");
  const grokRoot = join(work, "grok");
  const importRoot = join(work, "imports");
  const dbPath = join(work, "external-context.db");

  process.env.HERMES_EC_CLAUDE_ROOT = claudeRoot;
  process.env.HERMES_EC_CODEX_ROOT = codexRoot;
  process.env.HERMES_EC_GEMINI_ROOT = geminiRoot;
  process.env.HERMES_EC_GROK_ROOT = grokRoot;
  // Pin the import root so the scan is hermetic (and never touches a real home).
  process.env.HERMES_EC_IMPORT_ROOT = importRoot;

  const claudeFile = seedClaude(
    claudeRoot,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    true,
  );
  seedCodex(codexRoot);
  seedGemini(geminiRoot);
  seedGrok(grokRoot);

  const db = new ExternalContextDb(dbPath);

  console.log("Scan — backfill all four sources:");
  const indexed = await scanExternalSources(db, ALL_ON, [KNOWN_SECRET]);
  assert(indexed >= 6, `indexed messages across sources (got ${indexed})`);

  const stats = db.sourceStats();
  assert(
    stats["claude-code"].conversations === 1,
    "claude-code: 1 conversation",
  );
  assert(stats["claude-code"].messages === 2, "claude-code: 2 messages");
  assert(stats.codex.conversations === 1, "codex: 1 conversation");
  assert(stats.codex.messages === 2, "codex: 2 messages (clean event channel)");
  assert(stats.gemini.conversations === 1, "gemini: 1 conversation");
  assert(stats.grok.conversations === 1, "grok: 1 conversation");

  console.log("\nSearch — FTS + provenance:");
  const hits = db.search("widget");
  assert(hits.length >= 1, "search('widget') returns a hit");
  assert(hits[0].source === "claude-code", "hit carries source provenance");
  assert(
    hits[0].projectPath === "/Users/test/proj",
    "hit carries project path",
  );
  const codexHits = db.search("affine", { source: "codex" });
  assert(codexHits.length === 1, "source-filtered search works");
  const gemHits = db.search("knowledge base", {
    project: "gem-verify-project",
  });
  assert(gemHits.length >= 1, "project-filtered search works (gemini)");

  console.log("\nTime window — listConversationsSince (digest query):");
  const allConvs = db.listConversationsSince(0);
  assert(allConvs.length === 4, "since(0) returns all 4 conversations");
  // Fixtures: codex last_at = 2026-06-04, gemini = 2026-06-08, claude = 2026-06-10.
  const sinceJun9 = db.listConversationsSince(Date.UTC(2026, 5, 9));
  assert(
    sinceJun9.every((c) => c.source !== "codex" && c.source !== "gemini"),
    "window since Jun 9 excludes the Jun-4 codex + Jun-8 gemini sessions",
  );
  assert(sinceJun9.length < allConvs.length, "the window narrows the set");
  const codexOnly = db.listConversationsSince(0, { source: "codex" });
  assert(
    codexOnly.length === 1 && codexOnly[0].source === "codex",
    "source-scoped listConversationsSince works",
  );

  console.log("\nRedaction — secrets must NOT reach the index:");
  const raw = new Database(dbPath, { readonly: true });
  const msgRows = raw.prepare("SELECT text FROM messages").all() as Array<{
    text: string;
  }>;
  const ftsRows = raw.prepare("SELECT text FROM messages_fts").all() as Array<{
    text: string;
  }>;
  const allMsgText = msgRows.map((r) => r.text).join("\n");
  const allFtsText = ftsRows.map((r) => r.text).join("\n");
  assert(
    !allMsgText.includes(SK_ANT),
    "seeded sk-ant key absent from messages",
  );
  assert(!allMsgText.includes("sk-ant-api03"), "no sk-ant prefix in messages");
  assert(
    !allMsgText.includes(KNOWN_SECRET),
    "known secret absent from messages",
  );
  assert(
    !allFtsText.includes(SK_ANT),
    "seeded sk-ant key absent from messages_fts",
  );
  assert(
    !allFtsText.includes(KNOWN_SECRET),
    "known secret absent from messages_fts",
  );
  assert(
    allMsgText.includes("[REDACTED]"),
    "[REDACTED] token present in messages",
  );
  assert(
    db.search("LEAKED0123456789").length === 0,
    "FTS cannot retrieve the leaked key",
  );
  // The conversation TITLE is derived from the first (secret-bearing) message —
  // it must be redacted too, or it would leak via search hits / viewer / KB.
  const titleRows = raw
    .prepare("SELECT title FROM conversations WHERE title IS NOT NULL")
    .all() as Array<{ title: string }>;
  const allTitles = titleRows.map((r) => r.title).join("\n");
  assert(
    !allTitles.includes("sk-ant-api03"),
    "derived titles never leak the sk-ant key",
  );
  raw.close();

  console.log("\nIncremental — append indexes only the delta:");
  const before = db.totals().messages;
  appendFileSync(
    claudeFile,
    JSON.stringify({
      type: "assistant",
      cwd: "/Users/test/proj",
      gitBranch: "main",
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timestamp: "2026-06-10T09:10:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "One more appended thought." }],
      },
    }) + "\n",
  );
  const delta = await scanExternalSources(db, ALL_ON, [KNOWN_SECRET]);
  assert(
    delta === 1,
    `rescan indexed exactly the 1 appended message (got ${delta})`,
  );
  assert(
    db.totals().messages === before + 1,
    "total messages grew by exactly 1",
  );

  console.log("\nTruncation — shrink triggers full reparse:");
  writeFileSync(
    claudeFile,
    JSON.stringify({
      type: "user",
      cwd: "/Users/test/proj",
      gitBranch: "main",
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timestamp: "2026-06-10T09:00:01.000Z",
      message: { role: "user", content: "rewritten shorter file" },
    }) + "\n",
  );
  await scanExternalSources(db, ALL_ON, [KNOWN_SECRET]);
  assert(stats["claude-code"] !== undefined, "stats sanity");
  assert(
    db.sourceStats()["claude-code"].messages === 1,
    "truncated file reparsed to 1 message",
  );

  console.log("\nRebuild — drop + reindex from disk:");
  db.rebuild();
  assert(db.totals().messages === 0, "rebuild empties the index");
  await scanExternalSources(db, ALL_ON, [KNOWN_SECRET]);
  assert(
    db.totals().messages > 0,
    "rescan after rebuild repopulates from disk",
  );

  console.log(
    "\nImport — export adapters (ChatGPT / Claude.ai / Grok / Gemini Takeout):",
  );
  seedChatGpt(importRoot);
  seedClaudeAi(importRoot);
  seedGrokExport(importRoot);
  seedGeminiTakeout(importRoot);
  seedPaste(importRoot);
  const importIndexed = await scanExternalSources(db, ALL_ON, [KNOWN_SECRET]);
  assert(
    importIndexed >= 13,
    `import sources indexed messages (got ${importIndexed})`,
  );

  // ChatGPT — multi-conversation node-graph + canonical branch.
  const chatStats = db.sourceStats().chatgpt;
  assert(
    chatStats.conversations === 2,
    `chatgpt: 2 conversations from one export (got ${chatStats.conversations})`,
  );
  assert(
    db.search("chosenreply", { source: "chatgpt" }).length >= 1,
    "chatgpt canonical (current_node) branch is indexed",
  );
  assert(
    db.search("abandonedreply", { source: "chatgpt" }).length === 0,
    "chatgpt abandoned branch is NOT indexed",
  );

  // Claude.ai — linear chat_messages.
  const claudeAiStats = db.sourceStats()["claude-ai"];
  assert(
    claudeAiStats.conversations === 1 && claudeAiStats.messages === 2,
    `claude-ai: 1 conversation / 2 messages (got ${claudeAiStats.conversations}/${claudeAiStats.messages})`,
  );
  assert(
    db.search("claudeaireply", { source: "claude-ai" }).length >= 1,
    "claude-ai linear transcript is indexed + searchable",
  );

  // Grok export — uploaded `{type, content}` session JSONL.
  const grokExportStats = db.sourceStats()["grok-export"];
  assert(
    grokExportStats.conversations === 1,
    `grok-export: 1 conversation from one session file (got ${grokExportStats.conversations})`,
  );
  assert(
    db.search("grokexportreply", { source: "grok-export" }).length >= 1,
    "grok-export session is indexed + searchable",
  );

  // Gemini Takeout — MyActivity.json grouped into pseudo-conversations.
  const takeoutStats = db.sourceStats()["gemini-takeout"];
  assert(
    takeoutStats.conversations === 2,
    `gemini-takeout: 2 pseudo-conversations from the >30min gap (got ${takeoutStats.conversations})`,
  );
  assert(
    db.search("geminitakeoutreply", { source: "gemini-takeout" }).length >= 1,
    "gemini-takeout activity is indexed + searchable",
  );

  // Paste — a `{ origin, text }` envelope run through the heuristic parser.
  const pasteStats = db.sourceStats().paste;
  assert(
    pasteStats.conversations === 1 && pasteStats.messages === 2,
    `paste: 1 conversation / 2 messages from one envelope (got ${pasteStats.conversations}/${pasteStats.messages})`,
  );
  assert(
    db.search("pastedreply", { source: "paste" }).length >= 1,
    "pasted capture is indexed + searchable",
  );

  // Idempotent re-scan across all import sources.
  const reIndexed = await scanExternalSources(db, ALL_ON, [KNOWN_SECRET]);
  assert(
    reIndexed === 0,
    `re-importing identical bytes indexes nothing (got ${reIndexed})`,
  );
  assert(
    db.sourceStats().chatgpt.conversations === 2,
    "import conversation counts are stable after an idempotent re-scan",
  );

  // Redaction holds for EVERY imported source (the seeded key/secret bearing
  // messages must be redacted at index time, same as the live sources).
  const rawImport = new Database(dbPath, { readonly: true });
  const importMsgText = (
    rawImport
      .prepare(
        `SELECT m.text AS text FROM messages m
           JOIN conversations c ON c.conv_id = m.conv_id
         WHERE c.source IN ('chatgpt','claude-ai','grok-export','gemini-takeout','paste')`,
      )
      .all() as Array<{ text: string }>
  )
    .map((r) => r.text)
    .join("\n");
  rawImport.close();
  assert(
    !importMsgText.includes(SK_ANT) && !importMsgText.includes("sk-ant-api03"),
    "imports: seeded sk-ant key never reaches messages",
  );
  assert(
    !importMsgText.includes(KNOWN_SECRET),
    "imports: known secret never reaches messages",
  );
  assert(
    importMsgText.includes("[REDACTED]"),
    "imports: secret-bearing messages were redacted at index time",
  );

  console.log("\nMCP — stdio roundtrip (untrusted-fenced, read-only):");
  const serverPath = join(
    process.cwd(),
    "resources",
    "external-context-mcp.cjs",
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...(process.env as Record<string, string>),
      ELECTRON_RUN_AS_NODE: "1",
      HERMES_EXTERNAL_CONTEXT_DB: dbPath,
    },
  });
  const client = new Client(
    { name: "verify", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);
  assert(
    toolNames.includes("search_external_context") &&
      toolNames.includes("read_external_conversation") &&
      toolNames.includes("list_external_sources"),
    "MCP server exposes all three tools",
  );
  const searchRes = (await client.callTool({
    name: "search_external_context",
    arguments: { query: "widget" },
  })) as { content: Array<{ type: string; text: string }> };
  const mcpText = searchRes.content.map((c) => c.text).join("\n");
  assert(
    mcpText.includes("UNTRUSTED"),
    "MCP response opens with the untrusted banner",
  );
  assert(
    mcpText.includes("<external_transcripts>"),
    "MCP wraps excerpts in a fence",
  );
  assert(
    !mcpText.includes("LEAKED0123456789"),
    "MCP response never leaks the redacted key",
  );
  await client.close();

  db.close();
  rmSync(work, { recursive: true, force: true });
  console.log("\nALL EXTERNAL-CONTEXT CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
