import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer";
import { stripAnsi } from "./utils";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

export async function getCheckpointsStatus(profile?: string): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return "Hermes is not installed.";
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["checkpoints", "status"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (_error, stdout, stderr) => {
        resolve(stripAnsi(stdout.toString() + stderr.toString()));
      },
    );
  });
}

export async function pruneCheckpoints(
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["checkpoints", "prune"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 30000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error, stdout, stderr) => {
        const output = stdout.toString() + stderr.toString();
        resolve({ success: !error, output: stripAnsi(output) });
      },
    );
  });
}

export async function clearCheckpoints(
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["checkpoints", "clear"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 30000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error, stdout, stderr) => {
        const output = stdout.toString() + stderr.toString();
        resolve({ success: !error, output: stripAnsi(output) });
      },
    );
  });
}

function HERMES_SCRIPT_PATH(): string {
  return join(
    HERMES_HOME,
    "hermes-agent",
    process.platform === "win32" ? "venv/Scripts/hermes.exe" : "hermes",
  );
}
