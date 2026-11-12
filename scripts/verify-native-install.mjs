#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executable JavaScript acceptance harness. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  watchStartupDiagnostics,
  snapshotStartupDiagnostics,
  assertStartupDiagnostics,
} from "./acceptance-diagnostics.mjs";
import {
  validateStapledApplication,
  waitForWelcomeReady,
} from "./native-acceptance-helpers.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    assert.ok(argument.startsWith("--"), "Use --name=value arguments");
    const split = argument.indexOf("=");
    return split < 0
      ? [argument.slice(2), true]
      : [argument.slice(2, split), argument.slice(split + 1)];
  }),
);
if (args.help) {
  process.stdout.write(
    "Usage: verify-native-install.mjs --installer-path=<DMG|setup.exe|deb|AppImage> --install-dir=<RUNNER_TEMP-owned-root> --expected-version=<version> --output=<report.json> [--expected-arch=x64|arm64] [--install-only] [--expected-team-id=<MacTeam>]\nRequires a disposable GitHub-hosted runner. Never installs Agent or invokes a model.\n",
  );
  process.exit(0);
}

// @lat: [[native-release-acceptance#Disposable native installation]]
assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Native installation is restricted to disposable GitHub Actions runners",
);
assert.equal(process.env.CI, "true", "CI must be true");
assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is required");
const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP);
function ownedPath(value, label) {
  assert.equal(typeof value, "string", `${label} is required`);
  assert.ok(path.isAbsolute(value), `${label} must be absolute`);
  let existing = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    assert.notEqual(parent, existing, `${label} has no existing ancestor`);
    existing = parent;
  }
  const resolved = path.join(fs.realpathSync(existing), ...suffix);
  const relative = path.relative(runnerTemp, resolved);
  assert.ok(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
    `${label} must remain inside RUNNER_TEMP`,
  );
  return resolved;
}
const installer = ownedPath(args["installer-path"], "installer-path");
const ownedRoot = ownedPath(args["install-dir"], "install-dir");
const output = ownedPath(args.output, "output");
assert.ok(fs.statSync(installer).isFile(), "Installer must be a regular file");
const expectedVersion = args["expected-version"];
assert.match(
  expectedVersion || "",
  /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/,
  "Expected version must be explicit",
);
const expectedArch = args["expected-arch"] || os.arch();
assert.ok(
  ["x64", "arm64"].includes(expectedArch),
  "Expected native architecture must be x64 or arm64",
);
assert.equal(
  os.arch(),
  expectedArch,
  "The runner must execute the target architecture natively",
);
const markerPath = path.join(ownedRoot, ".desktop-native-install-fixture.json");
if (fs.existsSync(ownedRoot) && fs.readdirSync(ownedRoot).length) {
  assert.ok(
    fs.existsSync(markerPath),
    "Refusing a populated installation root without an ownership marker",
  );
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  assert.equal(marker.purpose, "hermes-desktop-native-install");
  assert.equal(marker.ownedRoot, ownedRoot);
}
fs.mkdirSync(ownedRoot, { recursive: true });
fs.writeFileSync(
  markerPath,
  JSON.stringify({ purpose: "hermes-desktop-native-install", ownedRoot }),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
const home = path.join(ownedRoot, "fixture-home");
const userData = path.join(ownedRoot, "fixture-user-data");
for (const folder of [home, userData])
  fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(
  path.join(userData, "update-preferences.json"),
  JSON.stringify({ autoUpgrade: false }),
);
const appEnv = {};
for (const key of [
  "PATH",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
]) {
  if (process.env[key]) appEnv[key] = process.env[key];
}
Object.assign(appEnv, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData/Roaming"),
  LOCALAPPDATA: path.join(home, "AppData/Local"),
  TEMP: path.join(home, "temp"),
  TMP: path.join(home, "temp"),
  LANG: "en_US.UTF-8",
  HERMES_HOME: path.join(home, ".hermes"),
  HERMES_DESKTOP_USER_DATA_DIR: userData,
  HERMES_API_URL: "http://127.0.0.1:9",
  HERMES_API_KEY: "native-acceptance-fixture",
  ELECTRON_ENABLE_LOGGING: "1",
  ...(process.platform === "linux" ? { APPIMAGE_EXTRACT_AND_RUN: "1" } : {}),
});
for (const key of ["APPDATA", "LOCALAPPDATA", "TEMP", "HERMES_HOME"])
  fs.mkdirSync(appEnv[key], { recursive: true });

const report = {
  passed: false,
  platform: process.platform,
  architecture: os.arch(),
  expectedVersion,
  installer,
  installerSha256: createHash("sha256")
    .update(fs.readFileSync(installer))
    .digest("hex"),
  ownedRoot,
  fixtureHome: home,
  userData,
  commands: [],
  checks: [],
  limitations: [
    "Runs only on a disposable native CI runner; no user application or account is changed.",
    "No Agent installation, model inference or account sign-in is performed.",
    "This report proves native installation and launch; updater application is a separate runner.",
  ],
};
let application;
let diagnostics;
function run(command, commandArgs, options = {}) {
  report.commands.push({ command, args: commandArgs });
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed: ${result.error || result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}
function desktopExecutable(text) {
  const exec = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("Exec="))
    ?.slice(5)
    .trim();
  assert.ok(exec, "Installed desktop entry lacks Exec");
  const matched = exec.match(/^"((?:\\.|[^"\\])*)"|^(\S+)/);
  assert.ok(matched, "Cannot read desktop executable");
  return (matched[1] || matched[2]).replace(/\\(["\\])/g, "$1");
}

async function bounded(promise, label, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function install() {
  if (process.platform === "darwin") {
    assert.ok(
      installer.endsWith(".dmg"),
      "macOS acceptance requires the real DMG",
    );
    if (expectedArch === "x64") {
      assert.equal(run("uname", ["-m"]), "x86_64");
      const hardware = spawnSync("sysctl", ["-n", "hw.optional.arm64"], {
        encoding: "utf8",
        timeout: 30000,
      });
      if (hardware.status === 0)
        assert.equal(
          hardware.stdout.trim(),
          "0",
          "Intel acceptance must not use Rosetta",
        );
      else
        assert.ok(
          hardware.status === 1 && /unknown (?:oid|key)/i.test(hardware.stderr),
          `Unexpected Intel hardware probe failure: ${hardware.error || hardware.stderr}`,
        );
      report.intelHardwareProbe = {
        status: hardware.status,
        output: hardware.stdout.trim(),
        expectedAbsentKey: hardware.status === 1,
      };
    }
    const mount = path.join(ownedRoot, "mounted-dmg");
    fs.mkdirSync(mount, { recursive: true });
    run("hdiutil", ["verify", installer]);
    run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      installer,
    ]);
    try {
      const apps = fs
        .readdirSync(mount)
        .filter((name) => name.endsWith(".app"));
      assert.deepEqual(
        apps,
        ["Hermes One.app"],
        "DMG must contain the exact shipping application bundle",
      );
      const source = path.join(mount, apps[0]);
      report.signature = run("codesign", [
        "--verify",
        "--deep",
        "--strict",
        "--verbose=2",
        source,
      ]);
      const bundle = path.join(ownedRoot, apps[0]);
      run("ditto", [source, bundle]);
      const identifier = run("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleIdentifier",
        path.join(bundle, "Contents/Info.plist"),
      ]);
      assert.equal(identifier, "com.nousresearch.hermes");
      assert.equal(
        run("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleShortVersionString",
          path.join(bundle, "Contents/Info.plist"),
        ]),
        expectedVersion,
      );
      const signed = spawnSync(
        "codesign",
        ["--display", "--verbose=4", bundle],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.equal(signed.status, 0);
      const team = (signed.stderr + signed.stdout).match(
        /TeamIdentifier=(\S+)/,
      )?.[1];
      assert.ok(
        team && team !== "not set",
        "App must carry a Developer ID team",
      );
      if (args["expected-team-id"])
        assert.equal(team, args["expected-team-id"]);
      report.signingTeam = team;
      report.signatureDisplay = signed.stdout + signed.stderr;
      report.staplerAttempts = [];
      await validateStapledApplication(bundle, {
        onAttempt: (attempt) => {
          report.commands.push({
            command: "xcrun",
            args: ["stapler", "validate", bundle],
          });
          report.staplerAttempts.push(attempt);
        },
      });
      run("spctl", ["--assess", "--type", "execute", "--verbose=4", bundle]);
      report.checks.push(
        "Signed DMG application copied and Gatekeeper assessed",
      );
      return path.join(bundle, "Contents/MacOS/Hermes One");
    } finally {
      run("hdiutil", ["detach", mount]);
    }
  }
  if (process.platform === "win32") {
    assert.ok(
      installer.endsWith("-setup.exe"),
      "Windows acceptance requires NSIS, not portable",
    );
    const destination = path.join(ownedRoot, "application");
    run(installer, ["/S", `/D=${destination}`], {
      env: { ...process.env, ...appEnv },
    });
    report.checks.push("Actual per-user NSIS installation completed");
    return path.join(destination, "hermes-agent.exe");
  }
  assert.equal(process.platform, "linux");
  if (installer.endsWith(".deb")) {
    assert.equal(expectedArch, "x64", "The shipping DEB is x64");
    assert.equal(
      run("dpkg-deb", ["--field", installer, "Package"]),
      "hermes-desktop",
    );
    assert.equal(
      run("dpkg-deb", ["--field", installer, "Version"]),
      expectedVersion,
    );
    run("sudo", ["-n", "apt-get", "install", "-y", installer], {
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });
    const files = run("dpkg-query", ["-L", "hermes-desktop"]).split(/\r?\n/);
    const desktop = files.filter((file) => file.endsWith(".desktop"));
    assert.equal(
      desktop.length,
      1,
      "Installed package must own exactly one desktop entry",
    );
    const executable = desktopExecutable(fs.readFileSync(desktop[0], "utf8"));
    assert.ok(
      executable.startsWith("/opt/HermesOne/"),
      "DEB executable must use its shipping installation path",
    );
    assert.ok(
      files.includes(executable),
      "Desktop entry must name a file owned by the installed package",
    );
    report.installedPackage = {
      name: "hermes-desktop",
      version: run("dpkg-query", ["-W", "-f=${Version}", "hermes-desktop"]),
      desktopEntry: desktop[0],
    };
    assert.equal(report.installedPackage.version, expectedVersion);
    report.checks.push(
      "Actual DEB package installed with its desktop entry and hooks",
    );
    return executable;
  }
  assert.ok(
    installer.endsWith(".AppImage"),
    "Linux acceptance requires a shipping DEB or AppImage",
  );
  const destination = path.join(ownedRoot, "HermesUnderTest.AppImage");
  fs.copyFileSync(installer, destination);
  fs.chmodSync(destination, 0o755);
  report.appImageRuntimeMode = "extract-and-run";
  report.checks.push(
    "Actual AppImage copied to its user-owned executable location",
  );
  return destination;
}

try {
  report.executablePath = await install();
  assert.ok(
    fs.statSync(report.executablePath).isFile(),
    "Installer did not produce the exact application executable",
  );
  if (!args["install-only"]) {
    const { _electron } = await import("playwright");
    application = await _electron.launch({
      executablePath: report.executablePath,
      cwd: home,
      env: appEnv,
      timeout: 60000,
    });
    diagnostics = watchStartupDiagnostics(application);
    const page = await application.firstWindow({ timeout: 60000 });
    await page.locator("#root").waitFor({ state: "visible", timeout: 60000 });
    await waitForWelcomeReady(page);
    report.checks.push("Fresh Welcome title and controls finish their reveal");
    report.runtime = await bounded(
      application.evaluate(({ app }) => {
        const createRequire = process.getBuiltinModule("module").createRequire;
        const require = createRequire(`${app.getAppPath()}/package.json`);
        const pkg = require(`${app.getAppPath()}/package.json`);
        const Database = require("better-sqlite3");
        const db = new Database(":memory:");
        const sqlite = db
          .prepare("select sqlite_version() as version, 17 as proof")
          .get();
        db.close();
        return {
          version: app.getVersion(),
          packaged: app.isPackaged,
          packageName: pkg.name,
          architecture: process.arch,
          electron: process.versions.electron,
          executable: app.getPath("exe"),
          appPath: app.getAppPath(),
          sqlite,
        };
      }),
      "Packaged runtime and SQLite probe",
    );
    assert.equal(report.runtime.version, expectedVersion);
    assert.equal(report.runtime.packaged, true);
    assert.equal(report.runtime.packageName, "hermes-desktop");
    assert.equal(report.runtime.architecture, expectedArch);
    assert.equal(report.runtime.sqlite.proof, 17);
    assert.match(report.runtime.sqlite.version, /^\d+\.\d+\.\d+$/);
    report.checks.push(
      "Native packaged UI, version and application identity verified",
      "Packaged native SQLite opened and queried inside Electron",
    );
    const screenshot = path.join(
      path.dirname(output),
      "native-installed-ui.png",
    );
    await page.screenshot({ path: screenshot });
    report.screenshot = screenshot;
    report.diagnostics = await bounded(
      snapshotStartupDiagnostics(application, diagnostics),
      "Startup diagnostic snapshot",
    );
    assertStartupDiagnostics(report.diagnostics);
    report.checks.push(
      "No renderer page/console errors or fatal main-process startup diagnostics",
    );
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  if (diagnostics) {
    try {
      report.diagnostics = await bounded(
        snapshotStartupDiagnostics(application, diagnostics),
        "Failure diagnostic snapshot",
        5000,
      );
    } catch (diagnosticError) {
      report.diagnosticSnapshotError = String(diagnosticError);
      report.diagnostics = {
        pageErrors: diagnostics.pageErrors,
        consoleErrors: diagnostics.consoleErrors,
        mainLog: diagnostics.mainLog,
      };
    }
  }
  process.exitCode = 1;
} finally {
  if (application) {
    let timer;
    try {
      await Promise.race([
        application.close(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("App cleanup timeout")),
            10000,
          );
        }),
      ]);
    } catch (error) {
      (diagnostics?.process || application.process()).kill("SIGKILL");
      report.cleanupError = String(error);
      report.passed = false;
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
    }
  }
  if (diagnostics) {
    const logPath = path.join(path.dirname(output), "native-main.log");
    fs.writeFileSync(logPath, diagnostics.mainLog);
    report.mainLogPath = logPath;
  }
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, executablePath: report.executablePath, report: output })}\n`,
  );
}
