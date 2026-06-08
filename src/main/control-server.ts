import { createServer, IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { getActiveProfileNameSync } from "./utils";
import {
  readDesktopConfig,
  writeDesktopConfig,
  getConnectionConfig,
} from "./config";
import { isGatewayRunning, sendMessage } from "./hermes";
import { runJobHeadless, tickScheduler } from "./scheduler";
import { exec } from "child_process";

let serverInstance: ReturnType<typeof createServer> | null = null;
let currentPort = 8645;
let authToken = "";

/**
 * Generate a secure token if one is not already present, and store it in desktop.json.
 */
function ensureAuthToken(): string {
  const config = readDesktopConfig();
  if (
    typeof config.controlServerToken === "string" &&
    config.controlServerToken
  ) {
    authToken = config.controlServerToken;
    return authToken;
  }

  authToken = randomBytes(32).toString("hex");
  config.controlServerToken = authToken;
  writeDesktopConfig(config);
  return authToken;
}

/**
 * Handle incoming HTTP requests securely.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  // Enforce security checks: check Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Unauthorized. Missing or invalid Bearer token.",
      }),
    );
    return;
  }

  const token = authHeader.substring(7).trim();
  if (token !== authToken) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized. Token mismatch." }));
    return;
  }

  const url = new URL(
    req.url || "",
    `http://${req.headers.host || "127.0.0.1"}`,
  );

  if (req.method === "GET" && url.pathname === "/state") {
    const profile = getActiveProfileNameSync();
    const conn = getConnectionConfig();
    const gatewayRunning = isGatewayRunning(profile);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        profile,
        connectionMode: conn.mode,
        gatewayRunning,
        controlPort: currentPort,
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/query") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { message, resumeSessionId, groundInWorkspace } = payload;
        if (!message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Missing required field: 'message'." }),
          );
          return;
        }

        const profile = getActiveProfileNameSync();

        // Handle SSE streaming or full response based on Accept header
        const acceptsEventStream = req.headers.accept === "text/event-stream";

        if (acceptsEventStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          sendMessage(
            message,
            {
              onChunk: (chunk) => {
                res.write(
                  `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`,
                );
              },
              onDone: (sessionId) => {
                res.write(
                  `data: ${JSON.stringify({ type: "done", sessionId })}\n\n`,
                );
                res.end();
              },
              onError: (err) => {
                res.write(
                  `data: ${JSON.stringify({ type: "error", error: err })}\n\n`,
                );
                res.end();
              },
            },
            profile,
            resumeSessionId,
            undefined,
            undefined,
            undefined,
            groundInWorkspace,
          );
        } else {
          let fullText = "";
          sendMessage(
            message,
            {
              onChunk: (chunk) => {
                fullText += chunk;
              },
              onDone: (sessionId) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ response: fullText, sessionId }));
              },
              onError: (err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err }));
              },
            },
            profile,
            resumeSessionId,
            undefined,
            undefined,
            undefined,
            groundInWorkspace,
          );
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body." }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/cron/trigger") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { jobId, jobName } = payload;
        if (!jobId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Missing required field: 'jobId'." }),
          );
          return;
        }

        const profile = getActiveProfileNameSync();
        // Spawns headless routines execution asynchronously
        const success = await runJobHeadless(
          jobId,
          jobName || "Manual Trigger",
          profile,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body." }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/cron/trigger-due") {
    const profile = getActiveProfileNameSync();
    void tickScheduler(profile);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found." }));
}

/**
 * Try listening on a port. Fallbacks dynamically if the port is in use.
 */
function listenOnPort(port: number, maxAttempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!serverInstance) {
      reject(new Error("Server instance not initialized."));
      return;
    }

    const cleanup = () => {
      serverInstance?.removeListener("listening", onListening);
      serverInstance?.removeListener("error", onError);
    };

    const onListening = () => {
      cleanup();
      currentPort = port;
      console.log(
        `[CONTROL SERVER] Running successfully on http://127.0.0.1:${port}`,
      );

      // Save port and token back to desktop.json so external clients can auto-discover it
      const config = readDesktopConfig();
      config.controlServerPort = port;
      writeDesktopConfig(config);

      writeShellHelper(port, authToken);
      writeCronScript();

      const backgroundEnabled = config.backgroundSchedulingEnabled !== false;
      manageLaunchAgent(backgroundEnabled);

      resolve(port);
    };

    const onError = (err: { code?: string }) => {
      cleanup();
      if (err.code === "EADDRINUSE" && maxAttempts > 0) {
        console.warn(
          `[CONTROL SERVER] Port ${port} is in use, retrying on ${port + 1}...`,
        );
        resolve(listenOnPort(port + 1, maxAttempts - 1));
      } else {
        reject(err);
      }
    };

    serverInstance.on("listening", onListening);
    serverInstance.on("error", onError);
    serverInstance.listen(port, "127.0.0.1");
  });
}

function writeShellHelper(port: number, token: string): void {
  try {
    const binDir = join(homedir(), ".hermes", "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const helperPath = join(binDir, "hermes-ask");
    const scriptContent = `#!/bin/bash
# Auto-generated by Hermes Control Server
DESKTOP_JSON="$HOME/.hermes/desktop.json"
PORT="${port}"
TOKEN="${token}"

if [ "$1" = "--state" ] || [ "$1" = "-s" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/state"
elif [ "$1" = "--trigger-due" ] || [ "$1" = "-d" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" -X POST "http://127.0.0.1:$PORT/cron/trigger-due"
elif [ "$1" = "--trigger" ] || [ "$1" = "-t" ]; then
  if [ -z "$2" ]; then
    echo "Usage: hermes-ask --trigger <jobId> [jobName]"
    exit 1
  fi
  curl -s -H "Authorization: Bearer $TOKEN" -X POST -H "Content-Type: application/json" -d "{\\"jobId\\":\\"$2\\",\\"jobName\\":\\"$3\\"}" "http://127.0.0.1:$PORT/cron/trigger"
else
  if [ -z "$1" ]; then
    echo "Usage: hermes-ask <message> OR hermes-ask --state OR hermes-ask --trigger-due OR hermes-ask --trigger <jobId>"
    exit 1
  fi
  curl -s -H "Authorization: Bearer $TOKEN" -X POST -H "Content-Type: application/json" -d "{\\"message\\":\\"$1\\"}" "http://127.0.0.1:$PORT/query"
fi
`;
    writeFileSync(helperPath, scriptContent, "utf-8");
    chmodSync(helperPath, 0o755);
    console.log(`[CONTROL SERVER] Generated OS-native CLI tool: ${helperPath}`);
  } catch {
    console.error("[CONTROL SERVER] Failed to write hermes-ask shell helper");
  }
}

function writeCronScript(): void {
  try {
    const binDir = join(homedir(), ".hermes", "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const cronPath = join(binDir, "hermes-cron.js");
    const cronContent = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const home = os.homedir();
const hermesHome = path.join(home, '.hermes');
const desktopJsonPath = path.join(hermesHome, 'desktop.json');

let activeProfile = 'default';
if (fs.existsSync(desktopJsonPath)) {
  try {
    const desktopConfig = JSON.parse(fs.readFileSync(desktopJsonPath, 'utf-8'));
    if (desktopConfig.activeProfile) {
      activeProfile = desktopConfig.activeProfile;
    }
  } catch (err) {}
}

const profileDir = path.join(hermesHome, activeProfile);
const jobsPath = path.join(profileDir, 'cron', 'jobs.json');

if (!fs.existsSync(jobsPath)) {
  process.exit(0);
}

try {
  const data = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));
  const jobs = data.jobs || [];
  const now = Date.now();

  for (const job of jobs) {
    if (job.enabled && job.state !== 'paused' && job.state !== 'completed' && job.next_run_at) {
      const nextRun = new Date(job.next_run_at).getTime();
      if (nextRun <= now) {
        const jobId = job.id;
        const lockFile = path.join('/tmp', \`hermes-routine-\${jobId}.lock\`);
        
        if (fs.existsSync(lockFile)) {
          console.log(\`Job \${jobId} is currently locked. Skipping.\`);
          continue;
        }

        // Acquire lock
        fs.writeFileSync(lockFile, String(process.pid), 'utf-8');

        console.log(\`[DAEMON] Triggering due job: "\${job.name}" (ID: \${jobId})\`);
        
        const pythonPath = process.platform === 'win32'
          ? path.join(hermesHome, 'venv', 'Scripts', 'python.exe')
          : path.join(hermesHome, 'venv', 'bin', 'python');

        const runArgs = ['-m', 'hermes_agent', 'cron', 'run', jobId];
        if (activeProfile && activeProfile !== 'default') {
          runArgs.push('-p', activeProfile);
        }

        const res = spawnSync(pythonPath, runArgs, {
          cwd: path.join(hermesHome, 'hermes-agent'),
          env: {
            ...process.env,
            HERMES_HOME: hermesHome,
            HOME: home,
            FAZM_HEADLESS: '1'
          }
        });

        console.log(\`[DAEMON] Job \${jobId} finished with code \${res.status}\`);

        // Release lock
        try {
          fs.unlinkSync(lockFile);
        } catch (err) {}
      }
    }
  }
} catch (err) {
  console.error('Error running background cron scheduler:', err);
}
`;
    writeFileSync(cronPath, cronContent, "utf-8");
    chmodSync(cronPath, 0o755);
    console.log(`[CONTROL SERVER] Generated headless cron script: ${cronPath}`);
  } catch {
    console.error("[CONTROL SERVER] Failed to write hermes-cron script");
  }
}

function findNodePath(): string {
  const commonPaths = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }
  return process.execPath;
}

export function manageLaunchAgent(enabled: boolean): void {
  if (process.platform !== "darwin") return;

  const home = homedir();
  const plistDir = join(home, "Library", "LaunchAgents");
  const plistPath = join(plistDir, "com.nousresearch.hermes-scheduler.plist");
  const logsDir = join(home, ".hermes", "logs");

  if (!existsSync(plistDir)) {
    try {
      mkdirSync(plistDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  const bootoutCmd = `launchctl bootout gui/$(id -u) "${plistPath}"`;
  exec(bootoutCmd, () => {
    if (!enabled) {
      try {
        if (existsSync(plistPath)) {
          unlinkSync(plistPath);
        }
      } catch {
        // ignore
      }
      return;
    }

    const nodePath = findNodePath();
    const cronScriptPath = join(home, ".hermes", "bin", "hermes-cron.js");
    const isElectron = nodePath === process.execPath;
    const envBlock = isElectron
      ? `    <key>EnvironmentVariables</key>\n    <dict>\n        <key>ELECTRON_RUN_AS_NODE</key>\n        <string>1</string>\n    </dict>`
      : "";

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nousresearch.hermes-scheduler</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${cronScriptPath}</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
${envBlock}
    <key>StandardOutPath</key>
    <string>${logsDir}/launchd-scheduler.log</string>
    <key>StandardErrorPath</key>
    <string>${logsDir}/launchd-scheduler.log</string>
</dict>
</plist>
`;

    try {
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      writeFileSync(plistPath, plistContent, "utf-8");

      const bootstrapCmd = `launchctl bootstrap gui/$(id -u) "${plistPath}"`;
      exec(bootstrapCmd, (err) => {
        if (err) {
          console.error(
            "[CONTROL SERVER] Failed to bootstrap launchd plist:",
            err,
          );
        } else {
          console.log(
            "[CONTROL SERVER] Successfully bootstrapped launchd plist",
          );
        }
      });
    } catch (err) {
      console.error("[CONTROL SERVER] Error writing LaunchAgent plist:", err);
    }
  });
}

/**
 * Start the control server.
 */
export async function startControlServer(): Promise<number> {
  if (serverInstance) {
    console.warn("[CONTROL SERVER] Server is already running.");
    return currentPort;
  }

  ensureAuthToken();

  serverInstance = createServer(handleRequest);
  try {
    const port = await listenOnPort(8645);
    return port;
  } catch (err) {
    console.error("[CONTROL SERVER] Failed to start control server:", err);
    serverInstance = null;
    throw err;
  }
}

/**
 * Stop the control server.
 */
export function stopControlServer(): void {
  if (serverInstance) {
    console.log("[CONTROL SERVER] Stopping control server.");
    serverInstance.close();
    serverInstance = null;
  }
}
