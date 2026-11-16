#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- This executable Node JavaScript entry point cannot use TypeScript return annotations. */
/**
 * Live transport smoke against an explicit Agent source checkout and Python.
 *
 * Uses the real desktop WebSocket client/relay and real Agent request registry,
 * auth, cancellation and replay. No inference or user installation is involved.
 * Local and token Remote use loopback; --ssh adds disposable OpenSSH forwarding
 * and the production POSIX command wrapper. This is not packaged UI acceptance.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire, Module } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
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
if (!args["agent-repo"] || !args.python) {
  throw new Error(
    "Usage: node scripts/verify-agent-compatibility.mjs --agent-repo=/path/to/Agent --python=/path/to/python [--ssh] [--output=/path/to/report.json]",
  );
}
const agentRepo = path.resolve(args["agent-repo"]);
const python = path.resolve(args.python);
const trial = fs.mkdtempSync(
  path.join(os.tmpdir(), "hermes-agent-compatibility-"),
);
const home = path.join(trial, "home");
fs.mkdirSync(home);
fs.writeFileSync(
  path.join(home, ".desktop-compatibility-fixture"),
  "disposable\n",
);
fs.writeFileSync(
  path.join(home, "config.yaml"),
  "security:\n  allow_lazy_installs: false\n",
);
const tokenFile = path.join(trial, "session-token");
const token = randomBytes(24).toString("hex");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const env = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  HOME: home,
  HERMES_HOME: home,
  PYTHONDONTWRITEBYTECODE: "1",
};
const children = [];
const report = {
  agentRef: args["agent-ref"] || "explicit source checkout",
  agentRepo,
  checks: [],
  limitations: [
    "No model inference: eager model construction is disabled and controlled compat.* RPCs trigger real Agent server requests.",
    "Loopback Remote uses the actual Agent token gate; OAuth account sign-in and external deployments are covered separately.",
    "SSH uses a disposable localhost OpenSSH daemon and tunnel, not a provisioned external host.",
    "This is a source transport smoke test, not packaged Electron or Windows installer acceptance.",
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
  const mod = new Module(filename, undefined);
  mod.filename = filename;
  mod.paths = createRequire(filename).resolve.paths("ws");
  mod._compile(compiled, filename);
  return mod.exports;
}
const { DashboardGatewayClient } = loadTs(
  "src/renderer/src/screens/Chat/dashboardGatewayClient.ts",
);
const { createLoopbackWebSocketRelay } = loadTs(
  "src/main/dashboard-websocket-relay.ts",
);
const { buildSshRemoteCommand } = loadTs("src/main/ssh-command.ts");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
// @lat: [[compatibility-validation#Acceptance failure handling]]
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const startupError = children.find(
      (proc) => proc.fixtureError,
    )?.fixtureError;
    if (startupError) throw startupError;
    const value = await check();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out: ${label}`);
}
function child(command, argv, options = {}) {
  const logPath = path.join(trial, `process-${children.length}.log`);
  const log = fs.openSync(logPath, "w");
  const proc = spawn(command, argv, {
    env,
    stdio: ["ignore", log, log],
    ...options,
  });
  fs.closeSync(log);
  proc.once("error", (error) => {
    proc.fixtureError = error;
  });
  children.push(proc);
  return proc;
}
async function reachable(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function runMode(mode, upstreamPort) {
  const received = [];
  const prompts = [];
  let pendingSensitive;
  let replaySensitive;
  let replaySensitivePrompts = 0;
  const relayOptions = {
    collectSensitiveRequest: async (request, signal) => {
      prompts.push(request.method);
      if (request.params.env_var === "COMPAT_CANCEL_SECRET") {
        pendingSensitive = { signal };
        return new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve(null), { once: true }),
        );
      }
      if (
        request.params.env_var === "COMPAT_REPLAY_SECRET" &&
        replaySensitivePrompts++ === 0
      ) {
        replaySensitive = { signal };
        return new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve(null), { once: true }),
        );
      }
      return { value: "fixture-secret-value" };
    },
  };
  const endpoint = `ws://127.0.0.1:${upstreamPort}/api/ws?token=${token}`;
  if (mode === "Remote token") {
    const invalidRelay = await createLoopbackWebSocketRelay(
      `ws://127.0.0.1:${upstreamPort}/api/ws?token=invalid-fixture-token`,
      relayOptions,
    );
    const invalidClient = new DashboardGatewayClient();
    try {
      await assert.rejects(invalidClient.connect(invalidRelay));
    } finally {
      invalidClient.close();
    }
  }
  let client;
  const connect = async () => {
    const relayUrl = await createLoopbackWebSocketRelay(endpoint, relayOptions);
    client = new DashboardGatewayClient({
      onEvent: (event) => received.push(event),
      requestTimeoutMs: 15000,
    });
    await client.connect(relayUrl);
  };
  const rpc = (method, params) => client.request(method, params);
  const event = (type, start) =>
    until(
      () => received.slice(start).find((item) => item.type === type),
      `${mode} ${type}`,
    );
  const result = (key) =>
    until(async () => {
      const found = await rpc("compat.result", { key });
      return found.present ? found : null;
    }, `${mode} request result`);
  const ask = (key, method, params, sid) =>
    rpc("compat.ask", { key, method, params, session_id: sid });
  await connect();
  try {
    const session = await rpc("session.create", {
      title: `Compatibility ${mode}`,
    });
    const sid = session.session_id;
    assert.equal(session.info.desktop_contract, 8);
    client.activateServerRequests(sid);

    let start = received.length;
    await ask(
      "approval",
      "approval",
      {
        request_id: "fixture-approval",
        command: "printf fixture",
        description: "Controlled fixture approval",
        choices: ["once", "deny"],
      },
      sid,
    );
    const approval = await event("approval.request", start);
    assert.match(approval.payload.request_id, /^srq-/);
    await rpc("approval.respond", {
      session_id: sid,
      request_id: approval.payload.request_id,
      choice: "deny",
    });
    assert.equal((await result("approval")).value.choice, "deny");
    assert.equal(
      client.respondServerRequest(approval.payload.request_id, {
        choice: "once",
      }),
      false,
    );

    start = received.length;
    await ask(
      "clarify",
      "clarify",
      {
        questions: [
          {
            qid: "scope",
            question: "Which scope?",
            choices: ["Local", "Remote"],
          },
          { qid: "notes", question: "Any notes?", multi_select: false },
        ],
      },
      sid,
    );
    const clarify = await event("clarify.request", start);
    assert.equal(clarify.payload.questions.length, 2);
    const answers = { scope: "Local", notes: "Fixture answer" };
    await rpc("clarify.respond", {
      session_id: sid,
      request_id: clarify.payload.request_id,
      answer: JSON.stringify({ answers }),
    });
    assert.deepEqual((await result("clarify")).value.answers, answers);

    await ask("unsupported", "window.read", {}, sid);
    const declined = (await result("unsupported")).value;
    assert.equal(JSON.parse(declined.value).success, false);

    start = received.length;
    await ask(
      "cancel",
      "approval",
      {
        request_id: "fixture-cancel",
        command: "printf cancel",
        choices: ["deny"],
      },
      sid,
    );
    const cancelled = await event("approval.request", start);
    await rpc("compat.cancel", { key: "cancel" });
    await event("approval.expire", start);
    assert.equal(
      client.respondServerRequest(cancelled.payload.request_id, {
        choice: "deny",
      }),
      false,
    );

    start = received.length;
    await ask(
      "secret",
      "secret",
      { env_var: "COMPAT_FIXTURE_SECRET", prompt: "Controlled secret prompt" },
      sid,
    );
    assert.deepEqual((await result("secret")).value, {
      value: "fixture-secret-value",
    });
    assert.ok(prompts.includes("secret"));
    assert.equal(
      received
        .slice(start)
        .some(
          (item) =>
            JSON.stringify(item).includes("fixture-secret-value") ||
            item.type === "secret",
        ),
      false,
    );

    await ask(
      "secret-cancel",
      "secret",
      { env_var: "COMPAT_CANCEL_SECRET", prompt: "Cancel this fixture prompt" },
      sid,
    );
    await until(() => pendingSensitive, `${mode} pending native secret`);
    await rpc("compat.cancel", { key: "secret-cancel" });
    await until(
      () => pendingSensitive.signal.aborted,
      `${mode} native prompt cancellation`,
    );

    start = received.length;
    await ask(
      "replay",
      "approval",
      {
        request_id: "fixture-replay",
        command: "printf replay",
        choices: ["deny"],
      },
      sid,
    );
    const first = await event("approval.request", start);
    await ask(
      "secret-replay",
      "secret",
      {
        env_var: "COMPAT_REPLAY_SECRET",
        prompt: "Restore this native fixture prompt",
      },
      sid,
    );
    await until(
      () => replaySensitive,
      `${mode} native prompt before reconnect`,
    );
    client.close();
    await until(
      () => replaySensitive.signal.aborted,
      `${mode} original native prompt retired`,
    );
    await connect();
    // The real Agent exposes unanswered questions with its replay response.
    const replay = await rpc("session.events.since", {
      session_id: sid,
      last_seen: 0,
    });
    assert.ok(
      replay.open_requests.some(
        (request) => request.id === first.payload.request_id,
      ),
    );
    assert.equal(
      replay.open_requests.some((request) => request.method === "secret"),
      false,
    );
    client.activateServerRequests(sid);
    const restored = await event("approval.request", start + 1);
    assert.equal(restored.payload.request_id, first.payload.request_id);
    await rpc("approval.respond", {
      request_id: restored.payload.request_id,
      session_id: sid,
      choice: "deny",
    });
    assert.equal((await result("replay")).value.choice, "deny");
    assert.deepEqual((await result("secret-replay")).value, {
      value: "fixture-secret-value",
    });
    assert.equal(replaySensitivePrompts, 2);
    report.checks.push({
      mode,
      passed: true,
      cases: [
        "contract8",
        "approval response correlation and duplicate rejection",
        "multi-question clarify",
        "unsupported interaction explicitly declined",
        "cancel retires stale controls",
        "native secret stays out of renderer",
        "native prompt cancellation",
        "open_requests reconnect replay",
        "native-only secret reconnect restoration",
        ...(mode === "Remote token" ? ["invalid Remote token refused"] : []),
      ],
    });
  } finally {
    client?.close();
  }
}

async function sshTunnel(backendPort) {
  const sshPort = await freePort();
  const tunnelPort = await freePort();
  const hostKey = path.join(trial, "ssh-host");
  const clientKey = path.join(trial, "ssh-client");
  const authorized = path.join(trial, "authorized_keys");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", hostKey]);
  execFileSync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    clientKey,
  ]);
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
  const options = [
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
  ];
  const literal = "quotes ' \\ $HOME $(false) `false` 中文";
  const output = execFileSync(
    "ssh",
    [
      ...options,
      `${user}@127.0.0.1`,
      buildSshRemoteCommand(`printf '%s' '${literal.replace(/'/g, `'"'"'`)}'`),
    ],
    { encoding: "utf8" },
  );
  assert.equal(output, literal);
  child("ssh", [
    ...options,
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

try {
  const port = await freePort();
  const backend = child(python, [
    path.join(root, "scripts/agent-compatibility-backend.py"),
    "--agent-repo",
    agentRepo,
    "--home",
    home,
    "--port",
    String(port),
    "--token-file",
    tokenFile,
  ]);
  await until(
    async () => {
      if (backend.exitCode !== null)
        throw new Error(
          `Agent backend exited ${backend.exitCode}; see ${trial}`,
        );
      return reachable(port);
    },
    "Agent backend startup",
    45000,
  );
  await runMode("Local", port);
  await runMode("Remote token", port);
  if (args.ssh) await runMode("SSH loopback tunnel", await sshTunnel(port));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  report.logs = trial;
} finally {
  for (const proc of children.reverse()) proc.kill("SIGTERM");
  await delay(150);
  for (const proc of children) if (proc.exitCode === null) proc.kill("SIGKILL");
}
const output = path.resolve(
  args.output || path.join(root, ".sandbox/agent-compatibility/result.json"),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.passed) fs.rmSync(trial, { recursive: true, force: true });
process.exitCode = report.passed ? 0 : 1;
