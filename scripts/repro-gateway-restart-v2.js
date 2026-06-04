/**
 * Same scenario as v1, but more robust:
 *   - Verify gateway healthy BEFORE starting
 *   - Verify chat clear (no stuck error bubbles) BEFORE starting
 *   - After kill, wait for gateway respawn via repeated /health probes
 *     (the desktop respawns on the next chat send, so we need to TRY
 *     to send and detect respawn)
 *
 * Detects error bubbles (`.chat-message-agent` containing "Error:") as
 * a separate signal from successful agent responses.
 */

const { attach } = require("./e2e-attach");
const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const STATE_DB = path.join(os.homedir(), "AppData", "Local", "hermes", "state.db");
const GATEWAY_PID_FILE = path.join(os.homedir(), "AppData", "Local", "hermes", "gateway.pid");

function snapshotSessions() {
  const py = `
import sqlite3, json
db = sqlite3.connect(r"${STATE_DB.replace(/\\/g, "\\\\")}")
rows = [
  {"id": r[0], "started_at": r[1], "message_count": r[2], "model": r[3]}
  for r in db.execute(
    "SELECT id, started_at, message_count, model FROM sessions ORDER BY started_at DESC LIMIT 20"
  )
]
print(json.dumps({"rows": rows}))
`;
  const out = execFileSync("python", ["-c", py], { encoding: "utf-8" });
  return JSON.parse(out);
}

function readGatewayPid() {
  try {
    return JSON.parse(fs.readFileSync(GATEWAY_PID_FILE, "utf-8")).pid;
  } catch {
    return null;
  }
}

function probeHealth() {
  try {
    execSync("curl -s --max-time 1 http://127.0.0.1:8642/health", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function killGateway() {
  const pid = readGatewayPid();
  if (!pid) return null;
  try {
    execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
    return pid;
  } catch {
    return null;
  }
}

async function waitForChatIdle(page, prevAgentBubbleCount, label = "") {
  // Wait for SOMETHING to happen — stop button appears OR an error appears
  await page.waitForFunction(
    (prev) => {
      const stop = document.querySelector("button.chat-stop-btn");
      const agentBubbles = document.querySelectorAll(".chat-bubble-agent").length;
      // Either streaming started OR a new agent bubble appeared (error or otherwise)
      return stop !== null || agentBubbles > prev;
    },
    prevAgentBubbleCount,
    { timeout: 15_000, polling: 100 },
  );
  // If streaming started, wait for it to end
  if (await page.evaluate(() => document.querySelector("button.chat-stop-btn") !== null)) {
    await page.waitForFunction(
      () => document.querySelector("button.chat-stop-btn") === null,
      { timeout: 180_000, polling: 250 },
    );
  }
  // Settle 500ms
  await new Promise((r) => setTimeout(r, 500));
}

async function countAgentBubbles(page) {
  return await page.evaluate(() => document.querySelectorAll(".chat-bubble-agent").length);
}

async function lastAgentText(page) {
  return await page.evaluate(() => {
    const all = document.querySelectorAll(".chat-bubble-agent");
    return all.length === 0 ? null : all[all.length - 1].textContent.trim().slice(0, 100);
  });
}

async function sendTurn(page, text, label) {
  const prev = await countAgentBubbles(page);
  const t0 = Date.now();
  await page.fill("textarea.chat-input", text);
  await page.keyboard.press("Enter");
  await waitForChatIdle(page, prev, label);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const lastText = await lastAgentText(page);
  const isError = lastText && lastText.startsWith("Error:");
  return { elapsed, lastText, isError };
}

(async () => {
  const { browser, page } = await attach();

  // Preflight: gateway must be up
  if (!probeHealth()) {
    console.log("[preflight] gateway is DOWN — aborting. Restart dev electron first.");
    await browser.close();
    process.exit(2);
  }
  console.log(`[preflight] gateway healthy, pid=${readGatewayPid()}`);

  // Preflight: clear any stuck chat state
  await page.click("button.chat-clear-btn");
  await new Promise((r) => setTimeout(r, 500));
  const stuckMsgs = await page.evaluate(
    () => document.querySelectorAll(".chat-message").length,
  );
  console.log(`[preflight] chat cleared, ${stuckMsgs} messages remaining`);
  console.log();

  const before = snapshotSessions();
  const beforeIds = new Set(before.rows.map((r) => r.id));

  // Turn 1
  console.log("[turn 1] sending...");
  const r1 = await sendTurn(page, "Reply with the single token PONG1", "t1");
  console.log(`  ${r1.elapsed}s | text: ${r1.lastText} | error=${r1.isError}`);
  let newRows = snapshotSessions().rows.filter((r) => !beforeIds.has(r.id));
  console.log(`  new state.db rows: ${newRows.map((r) => `${r.id.slice(0,30)}…(${r.message_count})`).join(", ")}`);

  // Turn 2
  console.log("[turn 2] sending...");
  const r2 = await sendTurn(page, "Reply with the single token PONG2", "t2");
  console.log(`  ${r2.elapsed}s | text: ${r2.lastText} | error=${r2.isError}`);
  newRows = snapshotSessions().rows.filter((r) => !beforeIds.has(r.id));
  console.log(`  new state.db rows: ${newRows.map((r) => `${r.id.slice(0,30)}…(${r.message_count})`).join(", ")}`);

  // DISRUPTION
  console.log();
  const oldPid = readGatewayPid();
  const killedPid = killGateway();
  console.log(`[disruption] killed gateway pid=${killedPid}`);
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`[disruption] post-kill health=${probeHealth()}`);
  console.log();

  // Turn 3 — desktop should respawn gateway
  console.log("[turn 3] sending — desktop should respawn the gateway...");
  const r3 = await sendTurn(page, "Reply with the single token PONG3", "t3");
  console.log(`  ${r3.elapsed}s | text: ${r3.lastText} | error=${r3.isError}`);
  const newPid = readGatewayPid();
  console.log(`  new gateway pid=${newPid} (was ${oldPid}, changed=${newPid !== oldPid})`);

  // Verdict
  const final = snapshotSessions();
  const finalNew = final.rows.filter((r) => !beforeIds.has(r.id));
  console.log();
  console.log("[final] new session rows for this conversation:");
  for (const r of finalNew) {
    console.log(`  ${r.id}  msgs=${r.message_count}`);
  }
  console.log();

  if (r3.isError) {
    console.log(`[VERDICT] ⚠️  Turn 3 errored — desktop didn't recover. Error: ${r3.lastText}`);
  } else if (finalNew.length === 1) {
    console.log(
      `[VERDICT] ✅ Conversation survived gateway kill. 1 row, ${finalNew[0].message_count} msgs (expected 6).`,
    );
  } else if (finalNew.length > 1) {
    console.log(
      `[VERDICT] 🔴 FORKED across gateway restart. ${finalNew.length} rows for 3 turns. Proliferation reproduced!`,
    );
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
