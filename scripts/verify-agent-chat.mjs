#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- This executable JavaScript fixture cannot use TypeScript return annotations. */
/** Actual AIAgent/tool-loop acceptance with a scripted loopback provider, not ML inference. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire, Module } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const split = arg.indexOf("=");
    return split < 0
      ? [arg.replace(/^--/, ""), true]
      : [arg.slice(2, split), arg.slice(split + 1)];
  }),
);
if (typeof args["agent-repo"] !== "string" || typeof args.python !== "string") {
  throw new Error(
    "Usage: node scripts/verify-agent-chat.mjs --agent-repo=/path/to/isolated/Agent --python=/path/to/python3.14 [--agent-ref=v0.23.1] [--ssh] [--output=/path/to/report.json]",
  );
}
const agentRepo = path.resolve(args["agent-repo"]);
const python = path.resolve(args.python);
const trial = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-agent-chat-"));
const home = path.join(trial, "home");
fs.mkdirSync(home);
const env = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  HOME: home,
  HERMES_HOME: home,
  PYTHONDONTWRITEBYTECODE: "1",
};
const children = [];
const clients = [];
const providerRequests = [];
const report = {
  agentRef: args["agent-ref"] || "explicit source checkout",
  agentRepo,
  checks: [],
  limitations: [
    "Provider responses are scripted on localhost: no actual ML inference or paid provider is used.",
    "Local and token Remote use separate sessions on an isolated loopback backend; OAuth and external deployments are not exercised.",
    "Optional SSH uses a disposable localhost daemon and forwarding tunnel, not an external host.",
    "The actual working-tree desktop client and main-process relay run outside packaged Electron UI.",
  ],
};
globalThis.window = { setTimeout, clearTimeout };
globalThis.WebSocket = WebSocket;

function loadTs(relative) {
  const filename = path.join(root, relative);
  const compiled = buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["electron"],
    logLevel: "silent",
  }).outputFiles[0].text;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = createRequire(filename).resolve.paths("ws");
  module._compile(compiled, filename);
  return module.exports;
}
const { DashboardGatewayClient } = loadTs(
  "src/renderer/src/screens/Chat/dashboardGatewayClient.ts",
);
const { createLoopbackWebSocketRelay } = loadTs(
  "src/main/dashboard-websocket-relay.ts",
);

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(check, label, timeout = 45000) {
  const stop = Date.now() + timeout;
  while (Date.now() < stop) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
function reachable(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
function child(command, argv, extraEnv = {}) {
  const log = fs.openSync(
    path.join(trial, `process-${children.length}.log`),
    "w",
  );
  const process = spawn(command, argv, {
    cwd: agentRepo,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  process.once("error", (error) => {
    process.fixtureError = error;
  });
  children.push(process);
  return process;
}

/** The provider asks the real Agent to run clarify, then checks its real tool result. */
const provider = http.createServer(async (request, response) => {
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: "compat-local-model",
            object: "model",
            owned_by: "local-fixture",
          },
        ],
      }),
    );
    return;
  }
  let text = "";
  for await (const chunk of request) text += chunk;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  const tools = (body.tools || []).map((tool) => tool.function?.name);
  const toolResults = (body.messages || [])
    .filter((message) => message.role === "tool")
    .map((message) => message.content);
  providerRequests.push({
    path: request.url,
    model: body.model,
    stream: body.stream === true,
    tools,
    toolResults,
  });
  let final = "COMPAT_AUX_OK";
  if (toolResults.length) {
    try {
      const result = JSON.parse(toolResults.at(-1));
      final =
        result.outcome === "submitted" &&
        result.responses?.[0]?.user_response === "Local" &&
        result.responses?.[1]?.user_response === "Dubai"
          ? "COMPAT_ACTUAL_AGENT_OK"
          : "COMPAT_INVALID_TOOL_RESULT";
    } catch {
      final = "COMPAT_INVALID_TOOL_RESULT";
    }
  }
  const callTool = tools.includes("clarify") && !toolResults.length;
  const toolCall = {
    id: "call_local_clarify",
    type: "function",
    function: {
      name: "clarify",
      arguments: JSON.stringify({
        questions: [
          { question: "Which target?", choices: ["Local", "Remote"] },
          { question: "Which region?" },
        ],
      }),
    },
  };
  const common = {
    id: "chatcmpl-local-fixture",
    created: Math.floor(Date.now() / 1000),
    model: "compat-local-model",
  };
  if (body.stream) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const frame = (delta, finish_reason = null) => ({
      ...common,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta, finish_reason }],
    });
    for (const chunk of [
      frame({ role: "assistant" }),
      frame(
        callTool
          ? { tool_calls: [{ index: 0, ...toolCall }] }
          : { content: final },
      ),
      frame({}, callTool ? "tool_calls" : "stop"),
    ])
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.end("data: [DONE]\n\n");
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ...common,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: callTool
              ? { role: "assistant", content: null, tool_calls: [toolCall] }
              : { role: "assistant", content: final },
            finish_reason: callTool ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }),
    );
  }
});

async function sshTunnel(backendPort) {
  const sshPort = await freePort(),
    tunnelPort = await freePort();
  const hostKey = path.join(trial, "ssh-host"),
    clientKey = path.join(trial, "ssh-client"),
    authorized = path.join(trial, "authorized_keys");
  for (const file of [hostKey, clientKey])
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", file]);
  fs.copyFileSync(`${clientKey}.pub`, authorized);
  const user = os.userInfo().username;
  const config = path.join(trial, "sshd_config");
  fs.writeFileSync(
    config,
    [
      `Port ${sshPort}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${hostKey}`,
      `PidFile ${path.join(trial, "sshd.pid")}`,
      `AuthorizedKeysFile ${authorized}`,
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "UsePAM no",
      "StrictModes no",
      `AllowUsers ${user}`,
      "PermitUserEnvironment no",
      "PermitUserRC no",
      "AllowTcpForwarding local",
      `PermitOpen 127.0.0.1:${backendPort}`,
      "LogLevel ERROR",
    ].join("\n") + "\n",
  );
  child("/usr/sbin/sshd", ["-D", "-e", "-f", config]);
  await until(() => reachable(sshPort), "disposable sshd startup");
  child("ssh", [
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    `UserKnownHostsFile=${path.join(trial, "known_hosts")}`,
    "-i",
    clientKey,
    "-p",
    String(sshPort),
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `127.0.0.1:${tunnelPort}:127.0.0.1:${backendPort}`,
    `${user}@127.0.0.1`,
  ]);
  await until(() => reachable(tunnelPort), "OpenSSH forwarding startup");
  return tunnelPort;
}

// @lat: [[compatibility-validation#Actual Agent chat loop]]
async function runMode(mode, upstreamPort, token) {
  const events = [],
    answers = [];
  let client;
  const beforeRequests = providerRequests.length;
  const relay = await createLoopbackWebSocketRelay(
    `ws://127.0.0.1:${upstreamPort}/api/ws?token=${token}`,
    { collectSensitiveRequest: async () => null },
  );
  client = new DashboardGatewayClient({
    requestTimeoutMs: 60000,
    onEvent: (event) => {
      events.push(event);
      if (event.type !== "clarify.request") return;
      const values = Object.fromEntries(
        event.payload.questions.map((question, index) => [
          question.qid,
          index === 0 ? "Local" : "Dubai",
        ]),
      );
      void client
        .request("clarify.respond", {
          request_id: event.payload.request_id,
          answer: JSON.stringify({ answers: values }),
        })
        .then((result) => answers.push(result))
        .catch((error) => answers.push({ error: String(error) }));
    },
  });
  clients.push(client);
  await client.connect(relay);
  const session = await client.request("session.create", {
    title: `Actual Agent ${mode}`,
  });
  assert.equal(session.info.desktop_contract, 8);
  client.activateServerRequests(session.session_id);
  const submitted = await client.request("prompt.submit", {
    session_id: session.session_id,
    text: "Exercise the clarification tool, then report the fixture result.",
  });
  const completed = await until(
    () => events.find((event) => event.type === "message.complete"),
    `${mode} Agent completion`,
    90000,
  );
  assert.equal(completed.payload.status, "complete");
  assert.equal(completed.payload.text, "COMPAT_ACTUAL_AGENT_OK");
  assert.equal(
    events.filter((event) => event.type === "clarify.request").length,
    1,
  );
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0], { status: "ok" });
  assert.equal(completed.payload.persisted_turn?.complete, true);
  assert.equal(completed.payload.persisted_turn?.row_ids?.length, 4);
  assert.ok(
    providerRequests
      .slice(beforeRequests)
      .some((request) => request.toolResults.length),
  );
  report.checks.push({
    mode,
    contract: session.info.desktop_contract,
    submitted,
    completion: completed.payload.text,
    clarify: "two real tool answers returned to scripted provider",
    persistedRows: completed.payload.persisted_turn.row_ids.length,
  });
  await client.request("session.close", { session_id: session.session_id });
  client.close();
}

try {
  await new Promise((resolve, reject) =>
    provider.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const providerPort = provider.address().port;
  fs.writeFileSync(
    path.join(home, "config.yaml"),
    JSON.stringify(
      {
        model: {
          default: "compat-local-model",
          provider: "custom:fixture",
          context_length: 128000,
        },
        providers: {
          fixture: {
            name: "fixture",
            base_url: `http://127.0.0.1:${providerPort}/v1`,
            api_key: "local-fixture-not-a-credential",
            api_mode: "chat_completions",
          },
        },
        platform_toolsets: { cli: ["clarify"] },
        security: { allow_lazy_installs: false },
        nous: { guest: false },
        compression: { enabled: false },
        terminal: { backend: "local", cwd: home },
        agent: { max_turns: 5 },
      },
      null,
      2,
    ),
  );
  const token = randomBytes(24).toString("hex");
  const port = await freePort();
  const code = `import sys\nsys.path.insert(0, ${JSON.stringify(agentRepo)})\nfrom hermes_cli import web_server\nweb_server.start_server(host='127.0.0.1', port=${port}, open_browser=False, headless=True, isolated=True)\n`;
  // No _schedule_agent_build patch: session.create constructs the real AIAgent.
  const backend = child(python, ["-u", "-c", code], {
    HERMES_DASHBOARD_SESSION_TOKEN: token,
    HERMES_SERVE_HEADLESS: "1",
    HERMES_DESKTOP: "1",
    HERMES_IGNORE_RULES: "1",
    HERMES_TUI_TOOLSETS: "clarify",
  });
  await until(() => {
    if (backend.fixtureError) throw backend.fixtureError;
    if (backend.exitCode !== null)
      throw new Error(`Agent exited ${backend.exitCode}; see ${trial}`);
    return reachable(port);
  }, "Agent backend startup");
  await runMode("Local", port, token);
  await runMode("Remote token", port, token);
  if (args.ssh)
    await runMode("SSH loopback tunnel", await sshTunnel(port), token);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  report.logs = trial;
} finally {
  for (const client of clients) client.close();
  for (const process of [...children].reverse()) process.kill("SIGTERM");
  const stop = Date.now() + 3000;
  while (
    children.some(
      (process) => process.exitCode === null && process.signalCode === null,
    ) &&
    Date.now() < stop
  )
    await delay(50);
  for (const process of children)
    if (process.exitCode === null && process.signalCode === null)
      process.kill("SIGKILL");
  await new Promise((resolve) => provider.close(resolve));
  // Failed runs retain diagnostic logs, never live credentials or private SSH keys.
  for (const name of ["ssh-host", "ssh-client", "authorized_keys"])
    fs.rmSync(path.join(trial, name), { force: true });
}
report.providerRequests = providerRequests;
const output = path.resolve(
  typeof args.output === "string"
    ? args.output
    : path.join(root, ".sandbox/agent-chat/result.json"),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
if (report.passed) fs.rmSync(trial, { recursive: true, force: true });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
