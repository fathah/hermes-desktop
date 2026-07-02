// Built Electron proof for remote chat transport fallback.
//
// Usage: npm run build && node scripts/remote-chat-smoke.mjs
//
// Launches the built app against a throwaway HERMES_HOME in Remote mode and a
// local gateway stub shaped like the Hermes v0.17 dashboard/API mismatch:
// /v1/chat/completions rejects with 405 HTML, then /api/chat/completions streams.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "http";

const OK_TEXT = "REMOTE_CHAT_SMOKE_OK";
const AUTH_TOKEN = "remote-chat-smoke-key";
const OUT = process.env.SMOKE_OUT || join(tmpdir(), "remote-chat-smoke");
mkdirSync(OUT, { recursive: true });

const requests = [];

function collectBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

function record(req, body = "") {
  requests.push({
    method: req.method || "",
    url: req.url || "",
    auth: req.headers.authorization || "",
    body,
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    record(req);
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/openapi.json" || req.url === "/v1/capabilities") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const body = await collectBody(req);
  record(req, body);

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    res.writeHead(405, { "content-type": "text/html" });
    res.end("<html>dashboard shell</html>");
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat/completions") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "x-hermes-session-id": "remote-chat-smoke-session",
    });
    res.write(`data: {"choices":[{"delta":{"content":"${OK_TEXT}"}}]}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("remote chat smoke gateway did not bind to a TCP port");
}

const GATEWAY_URL = `http://127.0.0.1:${address.port}`;
const HOME = mkdtempSync(join(tmpdir(), "hermes-remote-chat-smoke-"));
const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
mkdirSync(vault, { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "");
writeFileSync(
  join(HOME, "config.yaml"),
  [
    "model:",
    "  provider: auto",
    "  default: remote-chat-smoke",
    "  model: remote-chat-smoke",
  ].join("\n") + "\n",
);
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify(
    {
      onboardingCompleted: true,
      schedulerEnabled: false,
      connectionMode: "remote",
      remoteUrl: GATEWAY_URL,
      remoteApiKey: AUTH_TOKEN,
    },
    null,
    2,
  ),
);
writeFileSync(
  join(sps, "workspace.json"),
  JSON.stringify(
    {
      tree: [{ id: "home", children: [] }],
      meta: { home: { icon: "home", title: "Home", cover: null } },
      docs: { home: [{ id: "h1", type: "h1", text: "Home" }] },
      comments: [],
      trash: [],
      page: "home",
    },
    null,
    2,
  ),
);
writeFileSync(join(vault, "home.md"), `---\ntitle: "Home"\n---\n\n# Home\n`);

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);
console.log("GATEWAY=", GATEWAY_URL);
console.log(
  "SEAM_AUDIT=",
  JSON.stringify({
    proof: "fallback-v1-405-to-api",
    app: "built-electron",
    connectionMode: "remote",
    gatewayUrl: GATEWAY_URL,
  }),
);

const watchdog = setTimeout(() => {
  console.log("REMOTE_CHAT_SMOKE_FAIL: WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000);
watchdog.unref();

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("  ok -", message);
}

let app;
try {
  app = await electron.launch({
    args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
    env: {
      ...process.env,
      AUTO_API_KEY: "",
      HERMES_HOME: HOME,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });

  const win = await app.firstWindow();
  win.on("console", (msg) => {
    if (msg.type() === "error")
      console.log("BROWSER_CONSOLE_ERROR:", msg.text());
  });
  win.on("pageerror", (error) => {
    console.log("BROWSER_PAGE_ERROR:", error.message);
  });

  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector(".app", { timeout: 30000 });
  await win.waitForTimeout(1000);

  const chatProof = await win.evaluate(
    async ({ okText, runId }) => {
      const chunks = [];
      const errors = [];
      let doneSessionId = "";
      const cleanups = [
        window.hermesAPI.onChatChunk((chunk, rid) => {
          if (rid === runId) chunks.push(chunk);
        }),
        window.hermesAPI.onChatDone((sessionId, rid) => {
          if (rid === runId) doneSessionId = sessionId || "";
        }),
        window.hermesAPI.onChatError((error, rid) => {
          if (rid === runId) errors.push(error);
        }),
      ];

      try {
        const result = await window.hermesAPI.sendMessage(
          `Return exactly ${okText}.`,
          "default",
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          runId,
        );
        return { result, chunks, errors, doneSessionId };
      } finally {
        for (const off of cleanups) off();
      }
    },
    { okText: OK_TEXT, runId: "remote-chat-smoke-run" },
  );

  const responseText = [
    chatProof.result?.response || "",
    ...chatProof.chunks,
  ].join("");
  const v1Posts = requests.filter(
    (r) => r.method === "POST" && r.url === "/v1/chat/completions",
  );
  const apiPosts = requests.filter(
    (r) => r.method === "POST" && r.url === "/api/chat/completions",
  );

  assert(chatProof.errors.length === 0, "no chat error");
  assert(responseText.includes(OK_TEXT), `response/chunks contain ${OK_TEXT}`);
  assert(v1Posts.length === 1, "/v1/chat/completions was hit once");
  assert(apiPosts.length === 1, "/api/chat/completions was hit once");
  assert(
    apiPosts[0]?.auth === `Bearer ${AUTH_TOKEN}`,
    "remote auth header was passed through",
  );
  assert(
    chatProof.doneSessionId === "remote-chat-smoke-session",
    "chat done carried the streamed session id",
  );

  console.log("REMOTE_CHAT_SMOKE_PASS");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log("REMOTE_CHAT_SMOKE_FAIL:", message);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
