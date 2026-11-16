#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executable acceptance harness. */
/** Exercise the real installed updater against a loopback feed, without publishing a candidate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as asar from "@electron/asar";
import { _electron } from "playwright";
import {
  assertStartupDiagnostics,
  snapshotStartupDiagnostics,
  watchStartupDiagnostics,
} from "./acceptance-diagnostics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const equal = arg.indexOf("=");
    assert.ok(equal > 2, "Use --name=value arguments");
    return [arg.slice(2, equal), arg.slice(equal + 1)];
  }),
);
for (const name of [
  "owned-root",
  "executable-path",
  "candidate-file",
  "output",
])
  assert.ok(args[name], `Missing --${name}`);
const ownedRoot = fs.realpathSync(args["owned-root"]);
const proof = JSON.parse(
  fs.readFileSync(path.join(ownedRoot, ".desktop-update-fixture.json"), "utf8"),
);
assert.equal(proof.purpose, "hermes-desktop-installed-update");
assert.equal(fs.realpathSync(proof.ownedRoot), ownedRoot);
const executable = fs.realpathSync(args["executable-path"]);
assert.ok(
  executable.startsWith(`${ownedRoot}${path.sep}`),
  "Updater may modify only an explicitly owned installation",
);
const candidate = fs.realpathSync(args["candidate-file"]);
const expectedVersion = args["expected-version"] || "0.7.8";
const baselineVersion = args["baseline-version"] || "0.7.7";
const output = path.resolve(args.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
const home = path.join(ownedRoot, "fixture-home");
const userData = path.join(ownedRoot, "fixture-user-data");
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(
  path.join(userData, "update-preferences.json"),
  JSON.stringify({ autoUpgrade: false }),
);
const marker = `preserved-${Date.now()}`;
fs.writeFileSync(path.join(userData, "upgrade-marker.txt"), marker);
const env = Object.fromEntries(
  [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData/Roaming"),
  LOCALAPPDATA: path.join(home, "AppData/Local"),
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  HERMES_HOME: path.join(home, ".hermes"),
  HERMES_DESKTOP_USER_DATA_DIR: userData,
  HERMES_API_URL: "http://127.0.0.1:9",
  HERMES_API_KEY: "local-fixture",
  LANG: "en_US.UTF-8",
  ELECTRON_ENABLE_LOGGING: "1",
});
if (process.platform === "linux") env.APPIMAGE_EXTRACT_AND_RUN = "1";
const sha512 = createHash("sha512")
  .update(fs.readFileSync(candidate))
  .digest("base64");
const filename = path.basename(candidate);
const feed = JSON.stringify({
  version: expectedVersion,
  files: [{ url: filename, sha512, size: fs.statSync(candidate).size }],
  path: filename,
  sha512,
  releaseDate: new Date().toISOString(),
});
let application;
let startupDiagnostics;
let server;
let stage = "baseline launch";
let mainLog = "";
const requests = [];
const report = {
  baselineVersion,
  expectedVersion,
  platform: process.platform,
  arch: process.arch,
  executable,
  candidate,
  candidateSha512: sha512,
  checks: [],
  requests,
};

function checkpoint(value) {
  stage = value;
  fs.writeFileSync(
    output,
    `${JSON.stringify({ ...report, running: true, stage }, null, 2)}\n`,
  );
  process.stdout.write(`${stage}\n`);
}

async function bounded(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function recordProcess(app) {
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on("data", (chunk) => {
      mainLog += chunk.toString();
    });
}

async function launch() {
  const result = await _electron.launch({
    executablePath: executable,
    cwd: home,
    env,
    timeout: 60000,
  });
  recordProcess(result);
  startupDiagnostics = watchStartupDiagnostics(result);
  return result;
}

async function inspectUi(app) {
  const window = await app.firstWindow({ timeout: 60000 });
  await window.locator("#root").waitFor({ state: "visible", timeout: 60000 });
  await window
    .locator("body")
    .filter({ hasText: /Hermes/i })
    .waitFor({ state: "visible", timeout: 60000 });
  assert.match(
    await window.locator("body").innerText(),
    /Hermes/i,
    "The installed UI must render",
  );
  const diagnostics = await bounded(
    snapshotStartupDiagnostics(app, startupDiagnostics),
    10000,
    "startup diagnostic snapshot",
  );
  assertStartupDiagnostics(diagnostics);
  return diagnostics;
}

async function runtime(app) {
  return bounded(
    app.evaluate(({ app }) => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const Database = require("better-sqlite3");
      const db = new Database(":memory:");
      const sqlite = db
        .prepare("SELECT sqlite_version() AS version, 42 AS marker")
        .get();
      db.close();
      return {
        version: app.getVersion(),
        packaged: app.isPackaged,
        arch: process.arch,
        pid: process.pid,
        userData: app.getPath("userData"),
        sqlite,
      };
    }),
    30000,
    "packaged runtime inspection",
  );
}

function archivePath() {
  return process.platform === "darwin"
    ? path.resolve(path.dirname(executable), "../Resources/app.asar")
    : path.join(path.dirname(executable), "resources/app.asar");
}

function processStatus(pid, child) {
  const result = {
    pid,
    exitCode: child?.exitCode ?? null,
    signalCode: child?.signalCode ?? null,
  };
  try {
    process.kill(pid, 0);
    return { ...result, alive: true };
  } catch (error) {
    if (error.code === "ESRCH") return { ...result, alive: false };
    if (error.code === "EPERM") return { ...result, alive: true };
    return { ...result, alive: null, inspectionError: String(error) };
  }
}

// @lat: [[compatibility-validation#Installed updater acceptance]]
try {
  checkpoint("baseline launch");
  application = await launch();
  const before = await runtime(application);
  assert.equal(before.packaged, true);
  assert.equal(before.version, baselineVersion);
  assert.equal(path.resolve(before.userData), userData);
  assert.equal(before.sqlite.marker, 42);
  report.before = before;
  report.baselineProcesses = {
    mainPid: before.pid,
    wrapperPid: application.process().pid,
  };
  report.beforeDiagnostics = await inspectUi(application);
  report.checks.push(
    "Published baseline launches with native SQLite in isolated user data",
  );
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    requests.push({ method: req.method, pathname });
    if (/^\/latest(?:-[a-z0-9-]+)?\.yml$/.test(pathname)) {
      res.writeHead(200, {
        "Content-Type": "application/yaml",
        "Content-Length": Buffer.byteLength(feed),
      });
      res.end(feed);
    } else if (pathname === `/${filename}`) {
      // Full transfers are intentional: differential download is disabled in this tier.
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": fs.statSync(candidate).size,
      });
      fs.createReadStream(candidate).pipe(res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const feedUrl = `http://127.0.0.1:${server.address().port}/`;
  checkpoint("real updater download");
  const downloaded = await bounded(
    application.evaluate(
      async ({ app }, { feedUrl, ownedRoot, expectedVersion }) => {
        const require = process
          .getBuiltinModule("module")
          .createRequire(`${app.getAppPath()}/package.json`);
        const { autoUpdater } = require("electron-updater");
        // This is the same singleton used by production IPC; no shipped configuration is changed.
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.autoRunAppAfterInstall = false;
        autoUpdater.disableDifferentialDownload = true;
        autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
        if (process.platform === "win32")
          autoUpdater.installDirectory = require("node:path").dirname(
            process.execPath,
          );
        const events = [];
        for (const name of [
          "checking-for-update",
          "update-available",
          "download-progress",
          "update-downloaded",
          "error",
        ])
          autoUpdater.on(name, (value) =>
            events.push({
              name,
              version: value?.version,
              message: value?.message,
              downloadedFile: value?.downloadedFile,
            }),
          );
        globalThis.__installedUpdateAcceptance = autoUpdater;
        const update = await autoUpdater.checkForUpdates();
        if (update?.updateInfo?.version !== expectedVersion)
          throw new Error("Candidate was not discovered");
        const files = await autoUpdater.downloadUpdate();
        return { events, files, feedUrl, ownedRoot };
      },
      { feedUrl, ownedRoot, expectedVersion },
    ),
    240000,
    "real updater download",
  );
  assert.ok(
    downloaded.events.some((event) => event.name === "update-available"),
  );
  assert.ok(
    downloaded.events.some((event) => event.name === "update-downloaded"),
  );
  const downloadedFiles = new Set([
    ...downloaded.files,
    ...downloaded.events.map((event) => event.downloadedFile).filter(Boolean),
  ]);
  assert.ok(
    downloadedFiles.size > 0,
    "Real updater produced no downloaded artifact",
  );
  for (const file of downloadedFiles)
    assert.equal(
      createHash("sha512").update(fs.readFileSync(file)).digest("base64"),
      sha512,
    );
  assert.equal(
    downloaded.events.filter((event) => event.name === "error").length,
    0,
  );
  report.download = downloaded;
  report.preInstallDiagnostics = await bounded(
    snapshotStartupDiagnostics(application, startupDiagnostics),
    10000,
    "pre-install diagnostic snapshot",
  );
  assertStartupDiagnostics(report.preInstallDiagnostics);
  report.checks.push(
    "Installed updater discovers and downloads candidate through a loopback generic feed",
  );
  checkpoint("quit and install");
  const installTimeoutMs = process.platform === "win32" ? 300000 : 180000;
  report.installTimeoutMs = installTimeoutMs;
  const quitStartedAt = Date.now();
  const closed = application.waitForEvent("close", {
    timeout: installTimeoutMs,
  });
  const requested = bounded(
    application.evaluate(() => {
      setTimeout(
        () =>
          globalThis.__installedUpdateAcceptance.quitAndInstall(true, false),
        100,
      );
    }),
    10000,
    "quit and install request",
  );
  try {
    await Promise.all([closed, requested]);
  } catch (error) {
    const wrapper = startupDiagnostics.process;
    report.closeFailureDiagnostics = {
      elapsedMs: Date.now() - quitStartedAt,
      wrapper: processStatus(wrapper.pid, wrapper),
      main: processStatus(
        before.pid,
        before.pid === wrapper.pid ? wrapper : undefined,
      ),
    };
    try {
      asar.uncache(archivePath());
      report.closeFailureDiagnostics.installedPackageVersion = JSON.parse(
        asar.extractFile(archivePath(), "package.json").toString(),
      ).version;
    } catch (inspectionError) {
      report.closeFailureDiagnostics.installedPackageReadError =
        String(inspectionError);
    }
    throw error;
  }
  application = null;
  const deadline = Date.now() + installTimeoutMs;
  let installed = false;
  while (Date.now() < deadline) {
    try {
      if (process.platform !== "linux") asar.uncache(archivePath());
      installed =
        process.platform === "linux"
          ? createHash("sha512")
              .update(fs.readFileSync(executable))
              .digest("base64") === sha512
          : JSON.parse(
              asar.extractFile(archivePath(), "package.json").toString(),
            ).version === expectedVersion;
    } catch {
      /* Installer may atomically replace the destination. */
    }
    if (installed) break;
    await delay(1000);
  }
  assert.equal(
    installed,
    true,
    "Updater did not replace the owned installed application before the deadline",
  );
  report.checks.push(
    "quitAndInstall replaces the installed application in place",
  );
  checkpoint("updated application launch");
  application = await launch();
  const after = await runtime(application);
  assert.equal(after.packaged, true);
  assert.equal(after.version, expectedVersion);
  assert.equal(after.arch, before.arch);
  assert.equal(path.resolve(after.userData), userData);
  assert.equal(after.sqlite.marker, 42);
  assert.equal(
    fs.readFileSync(path.join(userData, "upgrade-marker.txt"), "utf8"),
    marker,
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(userData, "update-preferences.json"), "utf8"),
    ),
    { autoUpgrade: false },
  );
  report.afterDiagnostics = await inspectUi(application);
  report.after = after;
  report.checks.push(
    "Updated installed application launches with native SQLite and preserves existing user data and preferences",
  );
  report.success = true;
} catch (error) {
  report.success = false;
  report.stage = stage;
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (application) {
    await bounded(
      application.evaluate(({ app }) => {
        if (globalThis.__installedUpdateAcceptance)
          globalThis.__installedUpdateAcceptance.autoInstallOnAppQuit = false;
        setTimeout(() => app.exit(0), 100);
      }),
      3000,
      "cleanup request",
    ).catch(() => {});
    const proc = application.process();
    await bounded(application.close(), 5000, "application cleanup").catch(
      () => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      },
    );
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(path.dirname(output), "updater-main.log"),
    mainLog,
  );
  process.stdout.write(
    `${JSON.stringify({ success: report.success, stage: report.stage, output, checks: report.checks.length })}\n`,
  );
}
