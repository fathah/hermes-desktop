/**
 * Test what happens when the gateway dies mid-conversation:
 *   - Start a chat (turn 1 → session row created with desk-X)
 *   - Send turn 2 (appends to desk-X)
 *   - Force-kill the gateway process
 *   - Wait for desktop to bring it back up (or relaunch manually)
 *   - Send turn 3 → does it continue the same desk-X, or fork to a new row?
 *
 * If it forks, that's a real proliferation scenario worth knowing about.
 */

const { attach } = require("./e2e-attach");
const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const STATE_DB = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "hermes",
  "state.db",
);
const GATEWAY_PID_FILE = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "hermes",
  "gateway.pid",
);

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
    const data = JSON.parse(fs.readFileSync(GATEWAY_PID_FILE, "utf-8"));
    return data.pid;
  } catch {
    return null;
  }
}

function killGateway() {
  const pid = readGatewayPid();
  if (!pid) return false;
  try {
    execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
    return pid;
  } catch {
    return false;
  }
}

async function waitForGatewayHealthy(timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      execSync("curl -s --max-time 2 http://127.0.0.1:8642/health", {
        stdio: "ignore",
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function waitForChatIdle(page, prevAgentBubbleCount) {
  await page.waitForFunction(
    () => document.querySelector("button.chat-stop-btn") !== null,
    { timeout: 10_000, polling: 100 },
  );
  await page.waitForFunction(
    () => document.querySelector("button.chat-stop-btn") === null,
    { timeout: 180_000, polling: 250 },
  );
  await page.waitForFunction(
    (prev) => document.querySelectorAll(".chat-bubble-agent").length > prev,
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

async function sendTurn(page, text, prev) {
  const t0 = Date.now();
  await page.fill("textarea.chat-input", text);
  await page.keyboard.press("Enter");
  await waitForChatIdle(page, prev);
  return ((Date.now() - t0) / 1000).toFixed(1);
}

(async () => {
  const { browser, page } = await attach();
  await page.click("button.chat-clear-btn");
  await new Promise((r) => setTimeout(r, 300));

  const before = snapshotSessions();
  const beforeIds = new Set(before.rows.map((r) => r.id));
  let prevAgent = await countAgentBubbles(page);

  // Turn 1
  console.log("[turn 1] sending normally...");
  const t1 = await sendTurn(page, "Turn 1: reply PONG1", prevAgent);
  prevAgent = await countAgentBubbles(page);
  console.log(`  ${t1}s  state.db new rows: ${
    snapshotSessions().rows.filter(r => !beforeIds.has(r.id)).map(r => `${r.id.slice(0,30)}…(${r.message_count})`).join(", ")
  }`);

  // Turn 2
  console.log("[turn 2] sending normally...");
  const t2 = await sendTurn(page, "Turn 2: reply PONG2", prevAgent);
  prevAgent = await countAgentBubbles(page);
  console.log(`  ${t2}s  state.db new rows: ${
    snapshotSessions().rows.filter(r => !beforeIds.has(r.id)).map(r => `${r.id.slice(0,30)}…(${r.message_count})`).join(", ")
  }`);

  // KILL gateway. The desktop doesn't autonomously restart it — only the
  // next chat-send IPC checks `isGatewayRunning()` and respawns. So we
  // kill, give the OS a beat to clean up the process, then immediately
  // send turn 3 and let the desktop handle the restart.
  console.log();
  const killedPid = killGateway();
  console.log(`[disruption] killed gateway pid=${killedPid}`);
  await new Promise((r) => setTimeout(r, 1500)); // OS cleanup
  console.log();

  // Turn 3 — desktop's send-message IPC should respawn the gateway. The
  // question is what session id gets used.
  console.log("[turn 3] sending after gateway kill — desktop should respawn gateway...");
  const t3 = await sendTurn(page, "Turn 3: reply PONG3", prevAgent);
  console.log(`  ${t3}s  new gateway pid=${readGatewayPid()}`);

  const final = snapshotSessions();
  const finalNew = final.rows.filter((r) => !beforeIds.has(r.id));
  console.log();
  console.log("[final] new session rows for this conversation:");
  for (const r of finalNew) {
    console.log(`  ${r.id}  msgs=${r.message_count}  ${r.model}`);
  }
  console.log();

  if (finalNew.length === 1) {
    console.log(
      `[VERDICT] ✅ Survived gateway restart. 1 row, ${finalNew[0].message_count} msgs (expected 6).`,
    );
  } else if (finalNew.length > 1) {
    console.log(
      `[VERDICT] 🔴 FORKED across gateway restart. ${finalNew.length} rows created for 3 turns.`,
    );
  } else {
    console.log(`[VERDICT] ⚠️  Unexpected — 0 new rows. State.db check failed?`);
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
