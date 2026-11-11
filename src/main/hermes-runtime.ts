import { execFileSync } from "child_process";
import { existsSync, statSync } from "fs";
import { isAbsolute, join } from "path";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

export interface HermesRuntime {
  kind: "legacy" | "managed";
  python: string;
  script: string;
  cliPrefix: string[];
  available: boolean;
  error?: string;
}

type LauncherReader = (launcher: string, home: string, repo: string) => string;

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readRuntimeCommand(
  launcher: string,
  home: string,
  repo: string,
): string {
  const env: NodeJS.ProcessEnv = { ...process.env, HERMES_HOME: home };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.VIRTUAL_ENV;
  return execFileSync(
    launcher,
    ["--print-runtime-command", "--module", "hermes_cli.main"],
    {
      cwd: repo,
      env,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      ...HIDDEN_SUBPROCESS_OPTIONS,
    },
  );
}

// @lat: [[installer-runtime#Installation-bound runtime discovery]]
export function resolveHermesRuntime(
  home: string,
  options: { platform?: NodeJS.Platform; readLauncher?: LauncherReader } = {},
): HermesRuntime {
  const windows = (options.platform ?? process.platform) === "win32";
  const repo = join(home, "hermes-agent");
  const launcher = join(
    repo,
    ".hermes",
    "bin",
    windows ? "hermes.exe" : "hermes",
  );
  const commandLauncher = join(repo, ".hermes", "bin", "hermes.cmd");
  const commandFileOnly =
    windows && !regularFile(launcher) && regularFile(commandLauncher);
  if (regularFile(launcher) || commandFileOnly) {
    const unavailable: HermesRuntime = {
      kind: "managed",
      // Never enter a stale pre-PM venv when a managed launcher is broken.
      python: join(repo, ".hermes", "bin", "missing-python"),
      script: commandFileOnly ? commandLauncher : launcher,
      cliPrefix: [],
      available: false,
      error: commandFileOnly
        ? "This managed Hermes installation only has a command-file launcher. Repair Hermes Agent to restore its native hermes.exe launcher."
        : "The managed Hermes runtime could not be resolved. Repair Hermes Agent and retry.",
    };
    if (commandFileOnly) return unavailable;
    try {
      const raw = (options.readLauncher ?? readRuntimeCommand)(
        launcher,
        home,
        repo,
      );
      const command: unknown = JSON.parse(raw.trim());
      if (
        !Array.isArray(command) ||
        command.length < 2 ||
        command.length > 256 ||
        !command.every(
          (part) => typeof part === "string" && !part.includes("\0"),
        ) ||
        !isAbsolute(command[0]) ||
        !regularFile(command[0]) ||
        !regularFile(join(repo, "hermes_cli", "main.py")) ||
        !regularFile(join(repo, "hermes_bootstrap.py"))
      ) {
        return unavailable;
      }
      const pythonw = windows ? join(command[0], "..", "pythonw.exe") : "";
      return {
        kind: "managed",
        python: pythonw && regularFile(pythonw) ? pythonw : command[0],
        script: launcher,
        cliPrefix: command.slice(1),
        available: true,
      };
    } catch {
      return unavailable;
    }
  }

  const bin = join(repo, "venv", windows ? "Scripts" : "bin");
  const pythonw = join(bin, "pythonw.exe");
  const python = windows
    ? regularFile(pythonw) || !regularFile(join(bin, "python.exe"))
      ? pythonw
      : join(bin, "python.exe")
    : join(bin, "python");
  const script = windows ? join(bin, "hermes.exe") : join(repo, "hermes");
  return {
    kind: "legacy",
    python,
    script,
    cliPrefix: windows ? ["-m", "hermes_cli.main"] : [script],
    available: existsSync(python) && existsSync(script),
  };
}

// @lat: [[installer-runtime#Managed Python helpers]]
export function buildHermesPythonArgs(
  runtime: HermesRuntime,
  repo: string,
  args: string[],
): string[] {
  if (runtime.kind !== "managed") return args;
  // Select and lease dependencies through Agent's own bootstrap at child start;
  // never retain a selected dependency generation across PM updates or GC.
  const bootstrap = [
    "import os, sys, runpy",
    "os.environ.pop('PYTHONHOME', None)",
    "os.environ.pop('PYTHONPATH', None)",
    "os.environ.pop('VIRTUAL_ENV', None)",
    `sys.path.insert(0, ${JSON.stringify(repo)})`,
    "import hermes_bootstrap",
    "args = sys.argv[1:]",
    "if args[:1] == ['-c']:",
    "    sys.argv = ['-c', *args[2:]]",
    "    exec(compile(args[1], '<string>', 'exec'), {'__name__': '__main__'})",
    "elif args[:1] == ['-m']:",
    "    sys.argv = [args[1], *args[2:]]",
    "    runpy.run_module(args[1], run_name='__main__', alter_sys=True)",
    "elif args:",
    "    sys.argv = args",
    "    runpy.run_path(args[0], run_name='__main__')",
    "else:",
    "    raise SystemExit('A Python script or module is required')",
  ].join("\n");
  return ["-I", "-c", bootstrap, ...args];
}
