/**
 * Reproduce (or rule out) Marat's session-proliferation symptom:
 * "I had a couple of sessions only, but it shows much more."
 *
 * Method:
 *   1. Snapshot state.db sessions count.
 *   2. Click "New chat" to ensure a fresh state.
 *   3. Send N user turns (in the SAME conversation, one after the other).
 *   4. After all turns finish, snapshot state.db again.
 *   5. Print the delta: how many new session rows + their message counts.
 *
 * Expected (correct behaviour, post-PR-#357 in v0.5.1):
 *   - Exactly ONE new session row.
 *   - That row's message_count ≈ 2 × N (each turn adds user + assistant).
 *
 * Symptom (proliferation):
 *   - MULTIPLE new session rows, each with 2-4 messages.
 */

const { attach } = require("./e2e-attach");
const { execFileSync } = require("child_process");
const path = require("path");
const os = require("os");

const STATE_DB = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "hermes",
  "state.db",
);

const N_TURNS = parseInt(process.env.TURNS || "4", 10);

// Read state.db via a Python subprocess — bypasses better-sqlite3's Electron-
// ABI quirk (the local copy is built against Electron's Node ABI, not system Node).
function snapshotSessions() {
  const py = `
import sqlite3, json, sys
db = sqlite3.connect(r"${STATE_DB.replace(/\\/g, "\\\\")}")
total = db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
rows = [
  {"id": r[0], "started_at": r[1], "message_count": r[2], "model": r[3]}
  for r in db.execute(
    "SELECT id, started_at, message_count, model FROM sessions ORDER BY started_at DESC LIMIT 30"
  )
]
print(json.dumps({"total": total, "rows": rows}))
`;
  const out = execFileSync("python", ["-c", py], { encoding: "utf-8" });
  return JSON.parse(out);
}

// ChatInput.tsx swaps the send button for a stop button (class
// `chat-stop-btn`) while `isLoading` is true. Idle = no stop button +
// answer bubble count grew.
async function waitForChatIdle(page, prevAgentBubbleCount) {
  // 1. Wait until the stop button appears (request actually started).
  await page.waitForFunction(
    () => document.querySelector("button.chat-stop-btn") !== null,
    { timeout: 5_000, polling: 100 },
  );
  // 2. Wait until the stop button disappears (stream finished).
  await page.waitForFunction(
    () => document.querySelector("button.chat-stop-btn") === null,
    { timeout: 120_000, polling: 250 },
  );
  // 3. Wait for the agent answer bubble (final, non-reasoning) count to grow.
  await page.waitForFunction(
    (prev) =>
      document.querySelectorAll(".chat-bubble-agent").length > prev,
    prevAgentBubbleCount,
    { timeout: 5_000, polling: 100 },
  );
  // 4. Settle 500ms — let any post-stream DB merge / re-render finish.
  await new Promise((r) => setTimeout(r, 500));
}

async function countAgentBubbles(page) {
  return await page.evaluate(
    () => document.querySelectorAll(".chat-bubble-agent").length,
  );
}

(async () => {
  const { browser, page } = await attach();

  console.log(`[setup] state.db: ${STATE_DB}`);
  console.log(`[setup] turns: ${N_TURNS}`);
  console.log();

  // 1. New chat to be sure we're starting clean
  console.log("[step 1] Click 'New chat' to start fresh");
  await page.click("button.chat-clear-btn");
  await new Promise((r) => setTimeout(r, 300));

  // 2. Baseline state.db
  const before = snapshotSessions();
  const beforeIds = new Set(before.rows.map((r) => r.id));
  console.log(`[step 2] state.db sessions BEFORE: ${before.total} rows`);
  console.log(`         most recent 3:`);
  for (const r of before.rows.slice(0, 3)) {
    console.log(`           ${r.id}  msgs=${r.message_count}  ${r.model}`);
  }
  console.log();

  // 3. Send N turns in the same conversation
  let prevAgentCount = await countAgentBubbles(page);
  for (let i = 1; i <= N_TURNS; i++) {
    const msg = `Turn ${i}: reply with the single word PONG${i}`;
    console.log(`[step 3.${i}] Sending: "${msg}"`);
    await page.fill("textarea.chat-input", msg);
    await page.keyboard.press("Enter");
    const t0 = Date.now();
    await waitForChatIdle(page, prevAgentCount);
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    prevAgentCount = await countAgentBubbles(page);
    console.log(`           response received in ${t}s (agent bubbles=${prevAgentCount})`);
  }
  console.log();

  // 4. Snapshot AFTER
  const after = snapshotSessions();
  const newRows = after.rows.filter((r) => !beforeIds.has(r.id));
  console.log(`[step 4] state.db sessions AFTER: ${after.total} rows`);
  console.log(`         delta: +${after.total - before.total} new row(s)`);
  console.log();
  console.log(`[result] NEW session rows from this test:`);
  for (const r of newRows) {
    console.log(`           ${r.id}  msgs=${r.message_count}  ${r.model}`);
  }
  console.log();

  // 5. Verdict
  const expectedRows = 1;
  const expectedMsgs = N_TURNS * 2;
  if (newRows.length === expectedRows) {
    const got = newRows[0];
    if (got.message_count === expectedMsgs) {
      console.log(
        `[VERDICT] ✅ No proliferation. 1 session row with ${got.message_count} messages (expected ${expectedMsgs}).`,
      );
    } else {
      console.log(
        `[VERDICT] ⚠️  1 row but unexpected message_count: got ${got.message_count}, expected ${expectedMsgs}.`,
      );
    }
  } else if (newRows.length > 1) {
    console.log(
      `[VERDICT] 🔴 PROLIFERATION REPRODUCED. Got ${newRows.length} new session rows for ${N_TURNS} turns.`,
    );
  } else {
    console.log(`[VERDICT] ⚠️  0 new rows — chat may not have hit state.db (in-flight?).`);
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
