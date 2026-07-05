import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "crypto";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { getActiveProfileNameSync, safeWriteFile } from "./utils";
import { HERMES_HOME } from "./installer/paths";
import {
  readDesktopConfig,
  writeDesktopConfig,
  getConnectionConfig,
} from "./config";
import { isGatewayRunning, sendMessage } from "./hermes";
import { runJobHeadless, tickScheduler } from "./scheduler";
import { execFile } from "child_process";
import { createCronJob } from "./cronjobs";
import { getSpsNoteIndex } from "./note-index";
import { resolveSpsVaultDir } from "./sps-storage";
import { writeSpsCapture } from "./sps-capture";
import { formatLogError, log } from "./log";
import {
  exportPageMarkdownTo,
  exportRowMarkdownTo,
  readPageMarkdownFrom,
} from "./sps-vault";
import { buildContextPack } from "./context-packs";

let serverInstance: ReturnType<typeof createServer> | null = null;
let currentPort = 8645;
let authToken = "";
let calendarFeedToken = "";

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

function ensureCalendarFeedToken(): string {
  const config = readDesktopConfig();
  if (
    typeof config.calendarFeedToken === "string" &&
    config.calendarFeedToken
  ) {
    calendarFeedToken = config.calendarFeedToken;
    return calendarFeedToken;
  }

  calendarFeedToken = randomBytes(32).toString("hex");
  config.calendarFeedToken = calendarFeedToken;
  writeDesktopConfig(config);
  return calendarFeedToken;
}

function hasBearerControlToken(req: IncomingMessage): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return authHeader.substring(7).trim() === authToken;
}

function isCalendarAuthorized(req: IncomingMessage, url: URL): boolean {
  if (hasBearerControlToken(req)) return true;
  if (url.searchParams.get("feedToken") === calendarFeedToken) return true;
  // Compatibility for existing calendar subscriptions. Keep this calendar-only:
  // general control endpoints still require the Authorization header below.
  return url.searchParams.get("token") === authToken;
}

function getICalDates(dueStr: string): { start: string; end: string } | null {
  const match = dueStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [_, y, m, d] = match;
    const year = parseInt(y);
    const month = parseInt(m) - 1;
    const day = parseInt(d);
    const startD = new Date(Date.UTC(year, month, day));
    const endD = new Date(Date.UTC(year, month, day + 1));
    const fmt = (date: Date): string => {
      const ys = String(date.getUTCFullYear());
      const ms = String(date.getUTCMonth() + 1).padStart(2, "0");
      const ds = String(date.getUTCDate()).padStart(2, "0");
      return `${ys}${ms}${ds}`;
    };
    return { start: fmt(startD), end: fmt(endD) };
  }

  const parsed = new Date(dueStr);
  if (!isNaN(parsed.getTime())) {
    const startD = new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
    const endD = new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate() + 1,
      ),
    );
    const fmt = (date: Date): string => {
      const ys = String(date.getUTCFullYear());
      const ms = String(date.getUTCMonth() + 1).padStart(2, "0");
      const ds = String(date.getUTCDate()).padStart(2, "0");
      return `${ys}${ms}${ds}`;
    };
    return { start: fmt(startD), end: fmt(endD) };
  }
  return null;
}

function readJsonRequest(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("JSON body must be an object."));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Handle incoming HTTP requests securely.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(
    req.url || "",
    `http://${req.headers.host || "127.0.0.1"}`,
  );

  // iCal calendar feed synchronization route
  if (req.method === "GET" && url.pathname === "/calendar.ics") {
    if (!isCalendarAuthorized(req, url)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Unauthorized. Token mismatch or missing." }),
      );
      return;
    }

    const profile = getActiveProfileNameSync();
    getSpsNoteIndex(profile)
      .then((index) => {
        const notes = index.query({
          filters: [{ prop: "due", op: "exists" }],
        });

        const ical = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Hermes//SPS Task Sync//EN",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
        ];

        for (const note of notes) {
          const dueStr = String(note.props.due || "");
          const dates = getICalDates(dueStr);
          if (!dates) continue;

          const uid = `${note.path.replace(/\//g, "-")}@hermes`;
          const title = String(
            note.props.title || note.title || basename(note.path, ".md"),
          );
          const status = String(note.props.status || "todo");
          const prio = String(note.props.prio || "med");
          const assignee = String(
            note.props.who || note.props.assignee || "you",
          );
          const desc = `Status: ${status}\\nPriority: ${prio}\\nAssignee: ${assignee}`;
          const nowStr =
            new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

          ical.push(
            "BEGIN:VEVENT",
            `UID:${uid}`,
            `DTSTAMP:${nowStr}`,
            `DTSTART;VALUE=DATE:${dates.start}`,
            `DTEND;VALUE=DATE:${dates.end}`,
            `SUMMARY:${title}`,
            `DESCRIPTION:${desc}`,
            "STATUS:CONFIRMED",
            "END:VEVENT",
          );
        }

        ical.push("END:VCALENDAR");

        res.writeHead(200, {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": "attachment; filename=calendar.ics",
        });
        res.end(ical.join("\r\n"));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Internal server error: ${err.message}` }),
        );
      });
    return;
  }

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

  if (!hasBearerControlToken(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized. Token mismatch." }));
    return;
  }

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

  if (req.method === "GET" && url.pathname === "/sps/status") {
    const profile = getActiveProfileNameSync();
    getSpsNoteIndex(profile)
      .then((index) => writeJson(res, 200, index.status()))
      .catch((err) =>
        writeJson(res, 500, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "GET" && url.pathname === "/sps/search") {
    const profile = getActiveProfileNameSync();
    const q = url.searchParams.get("q") || "";
    const limit = Number(url.searchParams.get("limit") || 20);
    getSpsNoteIndex(profile)
      .then((index) => writeJson(res, 200, index.search(q, limit)))
      .catch((err) =>
        writeJson(res, 500, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "GET" && url.pathname === "/sps/page") {
    const profile = getActiveProfileNameSync();
    const page = (url.searchParams.get("page") || "").replace(/\.md$/i, "");
    readPageMarkdownFrom(resolveSpsVaultDir(profile), page)
      .then((markdown) =>
        markdown === null
          ? writeJson(res, 404, { error: "Page not found." })
          : writeJson(res, 200, { page, markdown }),
      )
      .catch((err) =>
        writeJson(res, 500, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/context-pack") {
    void readJsonRequest(req)
      .then((payload) => {
        const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
        if (!pageId) {
          writeJson(res, 400, { error: "Missing required field: pageId." });
          return;
        }
        const profile = getActiveProfileNameSync();
        return buildContextPack(
          {
            pageId,
            depth:
              typeof payload.depth === "number" ? payload.depth : undefined,
            includeBacklinks: payload.includeBacklinks !== false,
            includeTasks: payload.includeTasks !== false,
            includeSources: payload.includeSources !== false,
            maxBytes:
              typeof payload.maxBytes === "number"
                ? payload.maxBytes
                : undefined,
            save: payload.save === true,
          },
          profile,
        ).then((result) => writeJson(res, 200, result));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/capture") {
    void readJsonRequest(req)
      .then((payload) => {
        const body = typeof payload.body === "string" ? payload.body : "";
        if (!body.trim()) {
          writeJson(res, 400, { error: "Missing required field: body." });
          return;
        }
        const profile = getActiveProfileNameSync();
        return writeSpsCapture(resolveSpsVaultDir(profile), {
          source: payload.source === "web" ? "web" : "quick-note",
          body,
          title: typeof payload.title === "string" ? payload.title : undefined,
          description:
            typeof payload.description === "string"
              ? payload.description
              : undefined,
          via: typeof payload.via === "string" ? payload.via : "local-api",
          url: typeof payload.url === "string" ? payload.url : undefined,
          selection:
            typeof payload.selection === "string"
              ? payload.selection
              : undefined,
          highlights: Array.isArray(payload.highlights)
            ? payload.highlights.filter(
                (h): h is string => typeof h === "string",
              )
            : undefined,
          capturedAt:
            typeof payload.capturedAt === "number"
              ? payload.capturedAt
              : Date.now(),
        }).then((result) => writeJson(res, result.success ? 200 : 500, result));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/page") {
    void readJsonRequest(req)
      .then((payload) => {
        const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
        const markdown =
          typeof payload.markdown === "string" ? payload.markdown : "";
        if (!pageId || !markdown) {
          writeJson(res, 400, {
            error: "Missing required fields: pageId and markdown.",
          });
          return;
        }
        const profile = getActiveProfileNameSync();
        return exportPageMarkdownTo(
          resolveSpsVaultDir(profile),
          pageId,
          markdown,
        ).then((ok) => writeJson(res, ok ? 200 : 400, { success: ok }));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/task") {
    void readJsonRequest(req)
      .then((payload) => {
        const dbFolder =
          typeof payload.dbFolder === "string" ? payload.dbFolder : "tasks";
        const rowId =
          typeof payload.rowId === "string"
            ? payload.rowId
            : `task_${Date.now()}`;
        const markdown =
          typeof payload.markdown === "string" ? payload.markdown : "";
        if (!markdown) {
          writeJson(res, 400, { error: "Missing required field: markdown." });
          return;
        }
        const profile = getActiveProfileNameSync();
        return exportRowMarkdownTo(
          resolveSpsVaultDir(profile),
          dbFolder,
          rowId,
          markdown,
        ).then((ok) => writeJson(res, ok ? 200 : 400, { success: ok, rowId }));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
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

  if (req.method === "POST" && url.pathname === "/cron/create") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { schedule, prompt, name, deliver, opts } = payload;
        if (!schedule) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Missing required field: 'schedule'." }),
          );
          return;
        }

        const profile = getActiveProfileNameSync();
        const result = await createCronJob(
          schedule,
          prompt,
          name,
          deliver,
          profile,
          opts,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Invalid JSON body.",
          }),
        );
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

    const cleanup = (): void => {
      serverInstance?.removeListener("listening", onListening);
      serverInstance?.removeListener("error", onError);
    };

    const onListening = (): void => {
      cleanup();
      currentPort = port;
      log.info("control-server", {
        msg: "running successfully",
        url: `http://127.0.0.1:${port}`,
        port,
      });

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

    const onError = (err: { code?: string }): void => {
      cleanup();
      if (err.code === "EADDRINUSE" && maxAttempts > 0) {
        log.warn("control-server", {
          msg: "port in use; retrying",
          port,
          nextPort: port + 1,
        });
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function controlServerTokenFile(): string {
  return join(HERMES_HOME, "control-server.token");
}

function writeControlTokenFile(token: string): string {
  const tokenPath = controlServerTokenFile();
  safeWriteFile(tokenPath, `${token}\n`);
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    /* best effort */
  }
  return tokenPath;
}

export function renderShellHelperScript(
  port: number,
  tokenFilePath: string,
): string {
  return `#!/bin/bash
# Auto-generated by Hermes Control Server
DESKTOP_JSON="$HOME/.hermes/desktop.json"
PORT="${port}"
TOKEN_FILE=${shellQuote(tokenFilePath)}
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\\r\\n')"

if [ -z "$TOKEN" ]; then
  echo "Hermes control-server token is unavailable."
  exit 1
fi

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
}

export function renderSpsHelperScript(
  port: number,
  tokenFilePath: string,
): string {
  return `#!/bin/bash
# Auto-generated by Hermes Control Server
PORT="${port}"
TOKEN_FILE=${shellQuote(tokenFilePath)}
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\\r\\n')"
BASE="http://127.0.0.1:$PORT"

if [ -z "$TOKEN" ]; then
  echo "Hermes control-server token is unavailable."
  exit 1
fi

case "$1" in
  status)
    curl -s -H "Authorization: Bearer $TOKEN" "$BASE/sps/status"
    ;;
  search)
    if [ -z "$2" ]; then
      echo "Usage: sps search <query>"
      exit 1
    fi
    curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "q=$2" "$BASE/sps/search"
    ;;
  read)
    if [ -z "$2" ]; then
      echo "Usage: sps read <pageId>"
      exit 1
    fi
    curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "page=$2" "$BASE/sps/page"
    ;;
  capture)
    if [ -z "$2" ]; then
      echo "Usage: sps capture <text> [url]"
      exit 1
    fi
    BODY="$2"
    URL="$3"
    JSON_PAYLOAD=$(node -e 'const [body,url]=process.argv.slice(1); const payload=url ? {source:"web", body, url} : {source:"quick-note", body}; process.stdout.write(JSON.stringify(payload));' "$BODY" "$URL")
    curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$JSON_PAYLOAD" "$BASE/sps/capture"
    ;;
  *)
    echo "Usage: sps status | search <query> | read <pageId> | capture <text> [url]"
    exit 1
    ;;
esac
`;
}

function writeShellHelper(port: number, token: string): void {
  try {
    const binDir = join(homedir(), ".hermes", "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const helperPath = join(binDir, "hermes-ask");
    const tokenPath = writeControlTokenFile(token);
    safeWriteFile(helperPath, renderShellHelperScript(port, tokenPath));
    chmodSync(helperPath, 0o755);
    writeSpsHelper(binDir, port, tokenPath);
    log.info("control-server", {
      msg: "generated OS-native CLI tool",
      path: helperPath,
    });
  } catch (err) {
    log.error("control-server", {
      msg: "failed to write hermes-ask shell helper",
      error: formatLogError(err),
    });
  }
}

function writeSpsHelper(binDir: string, port: number, tokenPath: string): void {
  const helperPath = join(binDir, "sps");
  safeWriteFile(helperPath, renderSpsHelperScript(port, tokenPath));
  chmodSync(helperPath, 0o755);
}

export function renderCronScript(): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const home = os.homedir();
const hermesHome = path.join(home, '.hermes');
const desktopJsonPath = path.join(hermesHome, 'desktop.json');

function formatCronError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    if (json) return json;
  } catch (err) {}
  return String(error);
}

function writeCronLog(level, payload) {
  try {
    const logsDir = path.join(hermesHome, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope: 'control-server.cron',
      ...payload
    }) + '\\n';
    fs.appendFileSync(path.join(logsDir, 'desktop.log'), line, 'utf-8');
  } catch (err) {}
}

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
const appLaunchProfileDir = activeProfile && activeProfile !== 'default'
  ? path.join(hermesHome, 'profiles', activeProfile)
  : hermesHome;
const appLauncherPath = path.join(appLaunchProfileDir, 'sps-agent', 'app-launcher.json');

function writeAuditLog(action, command) {
  try {
    const logsDir = path.join(hermesHome, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logsDir, 'audit.log'), JSON.stringify({
      ts: Date.now(),
      action,
      command,
      profile: activeProfile
    }) + '\\n', 'utf-8');
  } catch (err) {}
}

function appDayKey(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function appWeekKey(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dow);
  return appDayKey(monday);
}

function appPeriodKey(schedule, d) {
  if (schedule.cadence === 'weekly') return appWeekKey(d);
  if (schedule.cadence === 'monthly') return d.getFullYear() + '-' + (d.getMonth() + 1);
  return appDayKey(d);
}

function appHasRunThisPeriod(schedule, nowDate) {
  return !!schedule.lastRunAt &&
    appPeriodKey(schedule, new Date(schedule.lastRunAt)) === appPeriodKey(schedule, nowDate);
}

function appInRunWindow(schedule, nowDate) {
  if (nowDate.getHours() !== schedule.hour) return false;
  if (schedule.cadence === 'weekly') return nowDate.getDay() === 1;
  if (schedule.cadence === 'monthly') return nowDate.getDate() === 1;
  return true;
}

function appMissedRunWindow(schedule, nowDate) {
  if (!schedule.enabled || !schedule.runWhenClosed) return false;
  if (appHasRunThisPeriod(schedule, nowDate)) return false;
  if (schedule.cadence === 'weekly') {
    return nowDate.getDay() > 1 ||
      (nowDate.getDay() === 1 && nowDate.getHours() > schedule.hour);
  }
  if (schedule.cadence === 'monthly') {
    return nowDate.getDate() > 1 ||
      (nowDate.getDate() === 1 && nowDate.getHours() > schedule.hour);
  }
  return nowDate.getHours() > schedule.hour;
}

function saveAppLauncher(data) {
  fs.writeFileSync(appLauncherPath, JSON.stringify(data, null, 2), 'utf-8');
}

function runAppLaunchSchedule(schedule, data, nowMs) {
  const targets = Array.isArray(data.targets) ? data.targets : [];
  let failed = '';

  for (const targetId of schedule.targetIds || []) {
    const target = targets.find((item) => item && item.id === targetId);
    if (!target || target.enabled === false) {
      failed = 'Launch target is unavailable.';
      continue;
    }
    if (!target.locator || target.locator.kind !== 'macos-app') {
      failed = 'Run while closed supports macOS app targets only.';
      continue;
    }
    const args = target.locator.bundleId
      ? ['-b', target.locator.bundleId]
      : [target.locator.appPath];
    const res = spawnSync('/usr/bin/open', args, { shell: false });
    target.lastRunAt = Date.now();
    target.lastStatus = res.error || res.status !== 0 ? 'failed' : 'ok';
    if (target.lastStatus === 'failed') {
      target.lastError = res.error ? formatCronError(res.error) : 'open exited with status ' + res.status;
      failed = target.lastError;
      writeAuditLog('app-launch.failure.scheduled', 'macos-app:' + target.label);
    } else {
      delete target.lastError;
      writeAuditLog('app-launch.run.scheduled', 'macos-app:' + target.label);
    }
  }

  schedule.lastRunAt = nowMs;
  schedule.lastStatus = failed ? 'failed' : 'ok';
  if (failed) schedule.lastError = failed;
  else delete schedule.lastError;
}

function runAppLaunchSchedules(nowMs) {
  if (process.platform !== 'darwin' || !fs.existsSync(appLauncherPath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(appLauncherPath, 'utf-8'));
    const schedules = Array.isArray(data.schedules) ? data.schedules : [];
    const nowDate = new Date(nowMs);
    let changed = false;

    for (const schedule of schedules) {
      if (!schedule || schedule.enabled !== true || schedule.runWhenClosed !== true) continue;
      if (appInRunWindow(schedule, nowDate) && !appHasRunThisPeriod(schedule, nowDate)) {
        runAppLaunchSchedule(schedule, data, nowMs);
        writeAuditLog('app-launch.schedule.run.scheduled', schedule.label);
        changed = true;
      } else if (appMissedRunWindow(schedule, nowDate)) {
        schedule.lastRunAt = nowMs;
        schedule.lastStatus = 'skipped';
        schedule.lastError = 'Scheduled hour passed before Hermes could run it.';
        writeAuditLog('app-launch.schedule.skipped', schedule.label);
        changed = true;
      }
    }

    if (changed) saveAppLauncher(data);
  } catch (err) {
    writeCronLog('error', {
      msg: 'error running app launch scheduler',
      error: formatCronError(err)
    });
  }
}

if (fs.existsSync(jobsPath)) {
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
          writeCronLog('info', {
            msg: 'job is currently locked; skipping',
            jobId
          });
          continue;
        }

        // Acquire lock
        fs.writeFileSync(lockFile, String(process.pid), 'utf-8');

        writeCronLog('info', {
          msg: 'triggering due job',
          jobId,
          jobName: job.name
        });
        
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

        writeCronLog('info', {
          msg: 'job finished',
          jobId,
          status: res.status
        });

        // Release lock
        try {
          fs.unlinkSync(lockFile);
        } catch (err) {}
      }
    }
  }
} catch (err) {
  writeCronLog('error', {
    msg: 'error running background cron scheduler',
    error: formatCronError(err)
  });
}
}

runAppLaunchSchedules(Date.now());
`;
}

function writeCronScript(): void {
  try {
    const binDir = join(homedir(), ".hermes", "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const cronPath = join(binDir, "hermes-cron.js");
    const cronContent = renderCronScript();
    writeFileSync(cronPath, cronContent, "utf-8");
    chmodSync(cronPath, 0o755);
    log.info("control-server", {
      msg: "generated headless cron script",
      path: cronPath,
    });
  } catch (err) {
    log.error("control-server", {
      msg: "failed to write hermes-cron script",
      error: formatLogError(err),
    });
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

function launchdGuiTarget(): string | null {
  const uid = process.getuid?.();
  return typeof uid === "number" ? `gui/${uid}` : null;
}

export function manageLaunchAgent(enabled: boolean): void {
  if (process.platform !== "darwin") return;

  const home = homedir();
  const plistDir = join(home, "Library", "LaunchAgents");
  const plistPath = join(plistDir, "com.nousresearch.hermes-scheduler.plist");
  const logsDir = join(home, ".hermes", "logs");
  const guiTarget = launchdGuiTarget();
  if (!guiTarget) return;

  if (!existsSync(plistDir)) {
    try {
      mkdirSync(plistDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  execFile(
    "launchctl",
    ["bootout", guiTarget, plistPath],
    { shell: false },
    () => {
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

        execFile(
          "launchctl",
          ["bootstrap", guiTarget, plistPath],
          { shell: false },
          (err) => {
            if (err) {
              log.error("control-server", {
                msg: "failed to bootstrap launchd plist",
                error: err.message,
              });
            } else {
              log.info("control-server", {
                msg: "successfully bootstrapped launchd plist",
              });
            }
          },
        );
      } catch (err) {
        log.error("control-server", {
          msg: "error writing LaunchAgent plist",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

/**
 * Start the control server.
 */
export async function startControlServer(): Promise<number> {
  if (serverInstance) {
    log.warn("control-server", { msg: "server is already running" });
    return currentPort;
  }

  ensureAuthToken();
  ensureCalendarFeedToken();

  serverInstance = createServer(handleRequest);
  try {
    const port = await listenOnPort(8645);
    return port;
  } catch (err) {
    log.error("control-server", {
      msg: "failed to start control server",
      error: formatLogError(err),
    });
    serverInstance = null;
    throw err;
  }
}

/**
 * Stop the control server.
 */
export function stopControlServer(): Promise<void> {
  if (!serverInstance) return Promise.resolve();
  const server = serverInstance;
  serverInstance = null;
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
