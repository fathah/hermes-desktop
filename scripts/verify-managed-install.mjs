#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executable acceptance harness. */
/** Provision the pinned Agent through Desktop's verified installer on disposable CI. */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire, Module } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const equal = argument.indexOf("=");
    assert.ok(
      argument.startsWith("--") && equal > 2,
      "Use --name=value arguments",
    );
    return [argument.slice(2, equal), argument.slice(equal + 1)];
  }),
);

// @lat: [[native-release-acceptance#Managed Agent provisioning]]
assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Managed installation is restricted to disposable GitHub Actions runners",
);
assert.equal(process.env.CI, "true", "CI must be true");
assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is required");
const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP);

function inside(parent, value) {
  const relative = path.relative(parent, value);
  return (
    relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function ownedPath(value, parent, label) {
  assert.equal(typeof value, "string", `${label} is required`);
  assert.ok(path.isAbsolute(value), `${label} must be absolute`);
  let existing = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const next = path.dirname(existing);
    assert.notEqual(next, existing, `${label} has no existing ancestor`);
    existing = next;
  }
  const resolved = path.join(fs.realpathSync(existing), ...suffix);
  assert.ok(
    inside(parent, resolved),
    `${label} must remain inside its owned root`,
  );
  return resolved;
}

const ownedRoot = ownedPath(args["owned-root"], runnerTemp, "owned-root");
const output = ownedPath(args.output, ownedRoot, "output");
assert.ok(
  !fs.existsSync(ownedRoot) || fs.readdirSync(ownedRoot).length === 0,
  "Fresh managed installation requires an empty owned root",
);
assert.ok(
  ["win32", "linux"].includes(process.platform),
  "This runner targets Windows and Linux only",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.join(ownedRoot, "home");
const hermesHome = path.join(home, ".hermes");
const repo = path.join(hermesHome, "hermes-agent");
for (const folder of [home, path.dirname(output), path.join(ownedRoot, "temp")])
  fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(
  path.join(ownedRoot, ".desktop-managed-install-fixture.json"),
  JSON.stringify({ purpose: "hermes-desktop-managed-install", ownedRoot }),
);

const env = {};
for (const name of [
  "PATH",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "PATHEXT",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
]) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  TEMP: path.join(ownedRoot, "temp"),
  TMP: path.join(ownedRoot, "temp"),
  TMPDIR: path.join(ownedRoot, "temp"),
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  UV_CACHE_DIR: path.join(ownedRoot, "uv-cache"),
  UV_PYTHON_INSTALL_DIR: path.join(ownedRoot, "bootstrap-python"),
  HERMES_HOME: hermesHome,
  HERMES_INSTALL_DIR: repo,
  PYTHONDONTWRITEBYTECODE: "1",
  UV_NO_CONFIG: "1",
  CI: "true",
  GITHUB_ACTIONS: "true",
  RUNNER_TEMP: runnerTemp,
  LANG: "C.UTF-8",
  SHELL: process.platform === "linux" ? "/bin/bash" : "",
});
for (const folder of [
  env.APPDATA,
  env.LOCALAPPDATA,
  env.XDG_CONFIG_HOME,
  env.XDG_CACHE_HOME,
])
  fs.mkdirSync(folder, { recursive: true });
// Production discovery reads process.env; do not let it or the installer inherit CI credentials.
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, env);

function loadTs(relative) {
  const filename = path.join(root, relative);
  const compiled = buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  }).outputFiles[0].text;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = createRequire(filename).resolve.paths("esbuild");
  module._compile(compiled, filename);
  return module.exports;
}

const report = {
  passed: false,
  platform: process.platform,
  architecture: process.arch,
  ownedRoot,
  hermesHome,
  checks: [],
  limitations: [
    "Runs only on a disposable CI runner; Windows installer writes that runner's user PATH registry.",
    "Linux PM may install missing system prerequisites on the disposable runner; shell rc files and caches use the owned home.",
    "Browser and computer-use tools are explicitly skipped; no provider credentials, models or gateway services are configured.",
    "This tier verifies Agent provisioning and Desktop runtime integration, not external OAuth or an external host.",
  ],
};
const logPath = path.join(ownedRoot, "installer.log");
let stage = "verified installer";

function checkpoint(value) {
  stage = value;
  fs.writeFileSync(
    output,
    `${JSON.stringify({ ...report, running: true, stage }, null, 2)}\n`,
  );
  process.stdout.write(`${stage}\n`);
}

function installerGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function stopInstaller(proc) {
  if (!proc.pid) return { stopped: true };
  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill",
      ["/PID", String(proc.pid), "/T", "/F"],
      {
        env,
        timeout: 10000,
        windowsHide: true,
      },
    );
    assert.ok(
      result.status === 0 || proc.exitCode !== null || proc.signalCode !== null,
      `Installer tree cleanup failed: ${result.error || result.stderr || result.status}`,
    );
    return { stopped: true, forced: true };
  }
  const signal = (value) => {
    try {
      process.kill(-proc.pid, value);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const grace = Date.now() + 2000;
  while (installerGroupAlive(proc.pid) && Date.now() < grace) await delay(50);
  const forced = installerGroupAlive(proc.pid);
  if (forced) signal("SIGKILL");
  const deadline = Date.now() + 5000;
  while (installerGroupAlive(proc.pid) && Date.now() < deadline)
    await delay(50);
  assert.equal(
    installerGroupAlive(proc.pid),
    false,
    "Installer process group survived cleanup",
  );
  return { processGroup: proc.pid, stopped: true, forced };
}

async function install(command, argv, timeoutMs = 25 * 60 * 1000) {
  const log = fs.openSync(logPath, "w");
  const proc = spawn(command, argv, {
    cwd: home,
    env,
    stdio: ["ignore", log, log],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  fs.closeSync(log);
  let timedOut = false;
  let cleanup = Promise.resolve();
  let finishTimeout;
  const timeoutReached = new Promise((resolve) => {
    finishTimeout = resolve;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    cleanup = stopInstaller(proc)
      .then(
        (result) => {
          report.installerCleanup = result;
        },
        (error) => {
          report.installerCleanupError = error.stack || String(error);
        },
      )
      .finally(() => finishTimeout({ code: null, signal: "timeout" }));
  }, timeoutMs);
  try {
    const status = await Promise.race([
      new Promise((resolve, reject) => {
        proc.once("error", reject);
        proc.once("close", (code, signal) => resolve({ code, signal }));
      }),
      timeoutReached,
    ]);
    report.installer = { ...status, timedOut, logPath };
    assert.equal(timedOut, false, "Installer exceeded its 25 minute deadline");
    assert.equal(status.code, 0, `Verified installer failed; see ${logPath}`);
  } finally {
    clearTimeout(timer);
    // A shell's close event does not imply that its descendants have exited.
    // Preserve the original timeout error while awaiting bounded group cleanup.
    await cleanup;
  }
}

function execute(command, argv) {
  return execFileSync(command, argv, {
    cwd: repo,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
}

try {
  const {
    PINNED_INSTALL_COMMIT,
    PINNED_INSTALL_SHA256,
    verifiedInstallerCommand,
  } = loadTs("src/main/installer-download.ts");
  const { PINNED_WINDOWS_INSTALL_SHA256, verifiedWindowsInstallerScript } =
    loadTs("src/main/installer-windows-download.ts");
  const { resolveHermesRuntime, buildHermesPythonArgs } = loadTs(
    "src/main/hermes-runtime.ts",
  );
  report.agentCommit = PINNED_INSTALL_COMMIT;
  report.installerSha256 =
    process.platform === "win32"
      ? PINNED_WINDOWS_INSTALL_SHA256
      : PINNED_INSTALL_SHA256;
  checkpoint("verified installer");
  if (process.platform === "win32") {
    const verified = verifiedWindowsInstallerScript(hermesHome, repo);
    const invocation = `-Commit '${PINNED_INSTALL_COMMIT}'`;
    assert.equal(
      verified.split(invocation).length,
      2,
      "Expected one production installer invocation",
    );
    const command =
      verified.replace(
        invocation,
        `${invocation} -SkipBrowser -SkipComputerUse`,
      ) + "\r\nexit $exit\r\n";
    const wrapper = path.join(ownedRoot, "verified-installer.ps1");
    fs.writeFileSync(wrapper, `\uFEFF${command}`);
    report.installerCommand = command;
    await install("pwsh", [
      "-ExecutionPolicy",
      "Bypass",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      wrapper,
    ]);
  } else {
    const command =
      verifiedInstallerCommand() + " --skip-browser --skip-computer-use";
    report.installerCommand = command;
    await install("/bin/bash", ["-c", command]);
  }
  checkpoint("published managed launcher");
  assert.equal(
    execute("git", ["-C", repo, "rev-parse", "HEAD"]),
    PINNED_INSTALL_COMMIT,
  );
  const stamp = readJson(path.join(repo, "install-stamp.json"));
  const completed = readJson(path.join(repo, ".hermes-bootstrap-complete"));
  assert.equal(stamp.commit, PINNED_INSTALL_COMMIT);
  assert.equal(stamp.baseVersion, "0.23.1");
  assert.equal(completed.pinnedCommit, PINNED_INSTALL_COMMIT);
  const launcher = path.join(
    repo,
    ".hermes",
    "bin",
    process.platform === "win32" ? "hermes.exe" : "hermes",
  );
  assert.equal(fs.statSync(launcher).isFile(), true);
  if (process.platform === "win32") {
    const descriptor = fs.openSync(launcher, "r");
    const header = Buffer.alloc(2);
    try {
      fs.readSync(descriptor, header, 0, 2, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    assert.equal(
      header.toString(),
      "MZ",
      "Windows must publish the native executable launcher",
    );
  }
  report.launcherCommand = JSON.parse(
    execute(launcher, [
      "--print-runtime-command",
      "--module",
      "hermes_cli.main",
    ]),
  );
  const runtime = resolveHermesRuntime(hermesHome);
  assert.equal(runtime.kind, "managed");
  assert.equal(runtime.available, true, runtime.error);
  assert.equal(runtime.script, launcher);
  ownedPath(runtime.python, ownedRoot, "managed Python");
  report.runtime = runtime;
  report.installStamp = stamp;
  report.checks.push(
    "Verified pinned installer genuinely provisions PM state and the native canonical launcher",
  );
  report.version = execute(runtime.python, [...runtime.cliPrefix, "--version"]);
  assert.match(report.version, /Hermes Agent v0\.23\.1\b/);
  report.checks.push(
    "Desktop discovers the managed runtime and executes Agent v0.23.1 through its exact CLI prefix",
  );
  checkpoint("managed raw Python bootstrap");
  const quoted = "quoted ' argument with spaces";
  const raw = execute(
    runtime.python,
    buildHermesPythonArgs(runtime, repo, [
      "-c",
      [
        "import json, os, platform, sys",
        "from pathlib import Path",
        "import fastapi, openai",
        "from hermes_cli import web_server",
        "from pm.environments import committed_venv, runtime_facts_path",
        "from pm.paths import repo_root, store_root",
        "print(json.dumps({'pythonVersion': platform.python_version(), 'machine': platform.machine(), 'argv': sys.argv[1:], 'home': os.environ['HERMES_HOME'], 'fastapi': fastapi.__version__, 'fastapiModule': fastapi.__file__, 'openai': openai.__version__, 'openaiModule': openai.__file__, 'webServer': web_server.__file__, 'factsPath': str(runtime_facts_path(repo_root())), 'environment': str(committed_venv(repo_root())), 'store': str(store_root())}))",
      ].join("\n"),
      quoted,
    ]),
  );
  report.raw = JSON.parse(raw);
  assert.deepEqual(report.raw.argv, [quoted]);
  assert.equal(report.raw.home, hermesHome);
  assert.ok(
    (process.arch === "x64"
      ? ["amd64", "x86_64"]
      : ["arm64", "aarch64"]
    ).includes(report.raw.machine.toLowerCase()),
    "PM Python must execute the runner's native architecture",
  );
  const factsPath = ownedPath(report.raw.factsPath, hermesHome, "PM facts");
  const selected = ownedPath(
    report.raw.environment,
    path.dirname(factsPath),
    "PM generation",
  );
  ownedPath(report.raw.store, ownedRoot, "PM store");
  ownedPath(report.raw.fastapiModule, selected, "FastAPI dependency");
  ownedPath(report.raw.openaiModule, selected, "OpenAI dependency");
  ownedPath(report.raw.webServer, repo, "Agent web module");
  const facts = readJson(factsPath);
  assert.equal(
    path.resolve(facts.packages.venv.environment),
    path.resolve(selected),
  );
  assert.equal(fs.statSync(path.join(selected, "pyvenv.cfg")).isFile(), true);
  const resolvedLock = ownedPath(
    facts.packages.venv.resolved_lock,
    path.dirname(factsPath),
    "PM resolved lock",
  );
  assert.equal(fs.statSync(resolvedLock).isFile(), true);
  assert.match(facts.packages.venv.stamp, /^[a-f0-9]{64}$/);
  const lock = JSON.parse(
    fs.readFileSync(path.join(repo, "pm", "lock.json"), "utf8"),
  );
  assert.equal(
    report.raw.pythonVersion,
    lock.packages.python.version.split("+")[0],
  );
  report.pmFacts = facts;
  report.checks.push(
    "PM committed generation supplies core/web imports and preserves raw helper arguments and selected home",
  );
  report.passed = true;
} catch (error) {
  report.stage = stage;
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, output, checks: report.checks.length })}\n`,
  );
}
