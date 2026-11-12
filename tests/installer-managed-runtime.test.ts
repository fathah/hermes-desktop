// @vitest-environment node
import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  python: "",
  updatedPython: "",
  invalidAfterUpdate: false,
  invalid: false,
  reads: [] as Array<{ command: string; args: string[]; home: string }>,
}));

vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  execFileSync: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) => {
    state.reads.push({ command, args, home: options.env.HERMES_HOME! });
    return state.invalid
      ? "invalid runtime JSON"
      : JSON.stringify([state.python, "-I", "-c", "import hermes_bootstrap"]);
  },
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    queueMicrotask(() => {
      state.python = state.updatedPython;
      state.invalid = state.invalidAfterUpdate;
      child.emit("close", 0);
    });
    return child;
  },
}));
vi.mock("electron", () => ({ app: { getPath: () => "", setPath: vi.fn() } }));

let home: string;
function fixtureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
}

beforeEach(() => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), "hermes-managed-update-"));
  vi.stubEnv("HERMES_HOME", home);
  const repo = join(home, "hermes-agent");
  fixtureFile(
    join(
      repo,
      ".hermes",
      "bin",
      process.platform === "win32" ? "hermes.exe" : "hermes",
    ),
  );
  fixtureFile(join(repo, "hermes_cli", "main.py"));
  fixtureFile(join(repo, "hermes_bootstrap.py"));
  state.python = join(home, "tools", "python-before");
  state.updatedPython = join(home, "tools", "python-after");
  fixtureFile(state.python);
  fixtureFile(state.updatedPython);
  state.invalid = false;
  state.invalidAfterUpdate = false;
  state.reads = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
});

// @lat: [[installer-runtime#Test specifications#Runtime refresh after installation change]]
it.each([false, true])(
  "refreshes runtime ownership after a successful update, rejecting an invalid result (%s)",
  async (invalidAfterUpdate) => {
    const installer = await import("../src/main/installer");
    const before = installer.HERMES_PYTHON;
    state.invalidAfterUpdate = invalidAfterUpdate;
    const progress = vi.fn();
    if (invalidAfterUpdate) {
      await expect(installer.runHermesUpdate(progress)).rejects.toThrow(
        "managed Hermes runtime could not be resolved",
      );
      expect(
        progress.mock.calls.some(([event]) =>
          event.log.includes("Update command finished"),
        ),
      ).toBe(false);
    } else {
      await installer.runHermesUpdate(progress);
      expect(installer.HERMES_PYTHON).toBe(state.updatedPython);
      expect(installer.HERMES_PYTHON).not.toBe(before);
      expect(installer.hermesCliArgs(["-p", "named", "doctor"])).toEqual([
        "-I",
        "-c",
        "import hermes_bootstrap",
        "-p",
        "named",
        "doctor",
      ]);
      expect(installer.validateHermesHome(home)).toBe(true);
    }
    expect(state.reads.length).toBeGreaterThanOrEqual(2);
    for (const read of state.reads) {
      expect(read.home).toBe(home);
      expect(read.args).toEqual([
        "--print-runtime-command",
        "--module",
        "hermes_cli.main",
      ]);
      expect(read.command).toContain(join(".hermes", "bin"));
    }
  },
);
