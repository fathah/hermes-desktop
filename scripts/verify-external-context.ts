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

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "ec-verify-"));
  const claudeRoot = join(work, "claude");
  const codexRoot = join(work, "codex");
  const geminiRoot = join(work, "gemini");
  const grokRoot = join(work, "grok");
  const dbPath = join(work, "external-context.db");

  process.env.HERMES_EC_CLAUDE_ROOT = claudeRoot;
  process.env.HERMES_EC_CODEX_ROOT = codexRoot;
  process.env.HERMES_EC_GEMINI_ROOT = geminiRoot;
  process.env.HERMES_EC_GROK_ROOT = grokRoot;

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
