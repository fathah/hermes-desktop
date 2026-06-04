/**
 * Push the session-continuity test harder: many turns + larger payloads
 * to force the gateway into context compression, which (per upstream
 * NousResearch/hermes-agent#16938) can rotate the agent's session_id.
 *
 * Snapshot state.db AFTER EACH TURN — if a new session row appears
 * mid-conversation, we've reproduced the proliferation seen in Marat's
 * screenshot. Otherwise this conversation should stay in ONE row.
 *
 * Variant knobs:
 *   TURNS         — default 12
 *   PAYLOAD_KB    — default 4   (each user message includes this much filler text)
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

const N_TURNS = parseInt(process.env.TURNS || "12", 10);
const PAYLOAD_KB = parseInt(process.env.PAYLOAD_KB || "4", 10);

function snapshotSessions() {
  const py = `
import sqlite3, json
db = sqlite3.connect(r"${STATE_DB.replace(/\\/g, "\\\\")}")
total = db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
rows = [
  {"id": r[0], "started_at": r[1], "message_count": r[2], "model": r[3]}
  for r in db.execute(
    "SELECT id, started_at, message_count, model FROM sessions ORDER BY started_at DESC LIMIT 50"
  )
]
print(json.dumps({"total": total, "rows": rows}))
`;
  const out = execFileSync("python", ["-c", py], { encoding: "utf-8" });
  return JSON.parse(out);
}

function fillerText(kb) {
  // Lorem-like deterministic filler so the request keeps changing but the
  // context grows predictably.
  const word = "context-filler-token-9c4a ";
  const targetChars = kb * 1024;
  const repeats = Math.ceil(targetChars / word.length);
  return word.repeat(repeats).slice(0, targetChars);
}

async function waitForChatIdle(page, prevAgentBubbleCount) {
  await page.waitForFunction(
    () => document.querySelector("button.chat-stop-btn") !== null,
    { timeout: 10_000, polling: 100 },
  );
  await page.waitForFunction(
    () => document.querySelector("button.chat-stop-btn") === null,
    { timeout: 300_000, polling: 250 },
  );
  await page.waitForFunction(
    (prev) =>
      document.querySelectorAll(".chat-bubble-agent").length > prev,
    prevAgentBubbleCount,
    { timeout: 10_000, polling: 100 },
  );
  await new Promise((r) => setTimeout(r, 500));
}

async function countAgentBubbles(page) {
  return await page.evaluate(
    () => document.querySelectorAll(".chat-bubble-agent").length,
  );
}

(async () => {
  const { browser, page } = await attach();

  console.log(`[setup] turns: ${N_TURNS}, payload per turn: ${PAYLOAD_KB} KB`);

  await page.click("button.chat-clear-btn");
  await new Promise((r) => setTimeout(r, 300));

  const before = snapshotSessions();
  const beforeIds = new Set(before.rows.map((r) => r.id));
  console.log(`[baseline] state.db sessions: ${before.total}`);
  console.log();

  let prevAgentCount = await countAgentBubbles(page);
  const newRowsByTurn = [];
  const filler = fillerText(PAYLOAD_KB);

  for (let i = 1; i <= N_TURNS; i++) {
    const msg = `[Turn ${i}/${N_TURNS}] Reply with the single token PONG${i}. Context appended (ignore): ${filler}`;
    process.stdout.write(`[turn ${String(i).padStart(2)}/${N_TURNS}] sending (${(msg.length / 1024).toFixed(1)} KB)... `);

    const t0 = Date.now();
    await page.fill("textarea.chat-input", msg);
    await page.keyboard.press("Enter");
    await waitForChatIdle(page, prevAgentCount);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    prevAgentCount = await countAgentBubbles(page);

    const after = snapshotSessions();
    const newRows = after.rows.filter((r) => !beforeIds.has(r.id));
    newRowsByTurn.push({
      turn: i,
      elapsed,
      newRowCount: newRows.length,
      newRows: newRows.map((r) => ({ id: r.id, msgs: r.message_count })),
    });

    const rowSummary =
      newRows.length === 0
        ? "(no new row yet?)"
        : newRows
            .map((r) => `${r.id.slice(0, 30)}…(msgs=${r.message_count})`)
            .join(" | ");
    console.log(`${elapsed}s | new rows from chat: ${newRows.length} → ${rowSummary}`);
  }

  console.log();
  const finalAfter = snapshotSessions();
  const finalNew = finalAfter.rows.filter((r) => !beforeIds.has(r.id));
  console.log(`[final] state.db sessions: ${finalAfter.total} (+${finalAfter.total - before.total})`);
  console.log(`[final] new rows from this conversation:`);
  for (const r of finalNew) {
    console.log(`          ${r.id}  msgs=${r.message_count}  ${r.model}`);
  }
  console.log();

  // Track when (or if) a SECOND row appears
  const splitTurn = newRowsByTurn.find((t) => t.newRowCount > 1);
  if (finalNew.length > 1) {
    console.log(
      `[VERDICT] 🔴 PROLIFERATION REPRODUCED. ${finalNew.length} session rows for ${N_TURNS} turns. ` +
        `Split first observed at turn ${splitTurn?.turn ?? "?"}.`,
    );
  } else {
    console.log(
      `[VERDICT] ✅ NO proliferation. 1 row across all ${N_TURNS} turns with ${finalNew[0]?.message_count ?? "?"} messages.`,
    );
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
