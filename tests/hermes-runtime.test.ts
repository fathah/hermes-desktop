// @vitest-environment node
import { execFileSync, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHermesPythonArgs,
  resolveHermesRuntime,
  type HermesRuntime,
} from "../src/main/hermes-runtime";

function createFile(path: string, content = ""): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o755 });
}

function availablePython(): string | null {
  for (const name of ["python3", "python"]) {
    const result = spawnSync(
      name,
      ["-c", "import sys; print(sys.executable)"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    if (result.status === 0 && result.stdout.trim())
      return result.stdout.trim();
  }
  return null;
}

describe("installation-bound Hermes runtimes", () => {
  let home: string;
  let repo: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-runtime-"));
    repo = join(home, "hermes-agent");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function managed(platform: NodeJS.Platform = "linux"): {
    launcher: string;
    python: string;
    prefix: string[];
    readLauncher: () => string;
  } {
    const launcher = join(
      repo,
      ".hermes",
      "bin",
      platform === "win32" ? "hermes.exe" : "hermes",
    );
    const python = join(
      home,
      "tools",
      "python-current",
      platform === "win32" ? "python.exe" : "bin/python3",
    );
    createFile(launcher);
    createFile(python);
    createFile(join(repo, "hermes_cli", "main.py"));
    createFile(join(repo, "hermes_bootstrap.py"));
    const prefix = [
      "-I",
      "-c",
      "import hermes_bootstrap; import runpy; runpy.run_module('hermes_cli.main', run_name='__main__')",
    ];
    return {
      launcher,
      python,
      prefix,
      readLauncher: vi.fn(() => JSON.stringify([python, ...prefix])),
    };
  }

  // @lat: [[installer-runtime#Test specifications#Managed discovery without a legacy venv]]
  it("uses the canonical managed launcher without a pre-PM venv", () => {
    const fixture = managed();
    const runtime = resolveHermesRuntime(home, {
      platform: "linux",
      readLauncher: fixture.readLauncher,
    });
    expect(runtime).toMatchObject({
      kind: "managed",
      available: true,
      python: fixture.python,
      script: fixture.launcher,
      cliPrefix: fixture.prefix,
    });
    expect(fixture.readLauncher).toHaveBeenCalledWith(
      fixture.launcher,
      home,
      repo,
    );
  });

  // @lat: [[installer-runtime#Test specifications#Broken managed runtime refuses stale fallback]]
  it.each([
    "invalid-json",
    "relative-python",
    "missing-python",
    "failed-launcher",
  ])("refuses %s instead of falling back to stale dependencies", (scenario) => {
    const fixture = managed();
    createFile(join(repo, "venv", "bin", "python"));
    createFile(join(repo, "hermes"));
    const readLauncher = (): string => {
      if (scenario === "failed-launcher") throw new Error("failed");
      if (scenario === "invalid-json") return "not JSON";
      return JSON.stringify([
        scenario === "relative-python" ? "python" : join(home, "missing"),
        ...fixture.prefix,
      ]);
    };
    const runtime = resolveHermesRuntime(home, {
      platform: "linux",
      readLauncher,
    });
    expect(runtime).toMatchObject({ kind: "managed", available: false });
    expect(runtime.python).not.toContain("venv");
  });

  // @lat: [[installer-runtime#Test specifications#Windows interpreter selection]]
  it("uses Windows store Python and only prefers its own existing pythonw", () => {
    const fixture = managed("win32");
    createFile(join(repo, "venv", "Scripts", "pythonw.exe"));
    const resolveRuntime = (): HermesRuntime =>
      resolveHermesRuntime(home, {
        platform: "win32",
        readLauncher: fixture.readLauncher,
      });
    expect(resolveRuntime().python).toBe(fixture.python);
    const pythonw = join(dirname(fixture.python), "pythonw.exe");
    createFile(pythonw);
    expect(resolveRuntime().python).toBe(pythonw);
  });

  // @lat: [[installer-runtime#Test specifications#Command-file-only runtime requires repair]]
  it("refuses a managed Windows command-file fallback without entering a stale venv", () => {
    createFile(join(repo, ".hermes", "bin", "hermes.cmd"));
    createFile(join(repo, "venv", "Scripts", "python.exe"));
    createFile(join(repo, "venv", "Scripts", "hermes.exe"));
    const readLauncher = vi.fn();
    const runtime = resolveHermesRuntime(home, {
      platform: "win32",
      readLauncher,
    });
    expect(runtime).toMatchObject({ kind: "managed", available: false });
    expect(runtime.error).toContain("restore its native hermes.exe launcher");
    expect(readLauncher).not.toHaveBeenCalled();
  });

  // @lat: [[installer-runtime#Test specifications#Legacy runtime remains usable]]
  it.each(["linux", "win32"] as const)(
    "preserves the %s legacy invocation",
    (platform) => {
      const windows = platform === "win32";
      const python = join(
        repo,
        "venv",
        windows ? "Scripts/python.exe" : "bin/python",
      );
      const script = windows
        ? join(repo, "venv", "Scripts", "hermes.exe")
        : join(repo, "hermes");
      createFile(python);
      createFile(script);
      const runtime = resolveHermesRuntime(home, { platform });
      expect(runtime).toMatchObject({
        kind: "legacy",
        available: true,
        python,
        script,
      });
      expect(runtime.cliPrefix).toEqual(
        windows ? ["-m", "hermes_cli.main"] : [script],
      );
      const args = ["-c", "print('legacy')"];
      expect(buildHermesPythonArgs(runtime, repo, args)).toBe(args);
    },
  );

  const python = availablePython();
  // @lat: [[installer-runtime#Test specifications#Raw helper bootstraps dependencies]]
  it.skipIf(!python)(
    "bootstraps real Python helpers and preserves quoted arguments",
    () => {
      const fixture = managed();
      createFile(
        join(repo, "hermes_bootstrap.py"),
        "import os\nos.environ['DESKTOP_TEST_BOOTSTRAPPED'] = 'yes'\n",
      );
      const runtime = resolveHermesRuntime(home, {
        readLauncher: fixture.readLauncher,
      });
      const code =
        "import json, os, sys; print(json.dumps({'bootstrapped': os.environ.get('DESKTOP_TEST_BOOTSTRAPPED'), 'args': sys.argv[1:], 'pythonpath': os.environ.get('PYTHONPATH')}))";
      const arg = "a folder/with 'single' and \"double\" quotes";
      const output = execFileSync(
        python!,
        buildHermesPythonArgs(runtime, repo, ["-c", code, arg]),
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HERMES_HOME: home,
            PYTHONPATH: join(home, "untrusted-imports"),
          },
          timeout: 5000,
        },
      );
      expect(JSON.parse(output)).toEqual({
        bootstrapped: "yes",
        args: [arg],
        pythonpath: null,
      });
    },
  );
});
