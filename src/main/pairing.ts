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

export async function listPairings(profile?: string): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return "Hermes is not installed.";
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["pairing", "list"]);
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
      }
    );
  });
}

export async function approvePairing(
  code: string,
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!code) return { success: false, output: "Code is required" };
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["pairing", "approve", code]);
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
      (error, stdout, stderr) => {
        const output = stdout.toString() + stderr.toString();
        resolve({ success: !error, output: stripAnsi(output) });
      }
    );
  });
}

export async function revokePairing(
  userId: string,
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!userId) return { success: false, output: "User ID is required" };
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["pairing", "revoke", userId]);
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
      (error, stdout, stderr) => {
        const output = stdout.toString() + stderr.toString();
        resolve({ success: !error, output: stripAnsi(output) });
      }
    );
  });
}

export async function clearPendingPairings(
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["pairing", "clear-pending"]);
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
      (error, stdout, stderr) => {
        const output = stdout.toString() + stderr.toString();
        resolve({ success: !error, output: stripAnsi(output) });
      }
    );
  });
}

function HERMES_SCRIPT_PATH(): string {
  return join(HERMES_HOME, "hermes-agent", process.platform === "win32" ? "venv/Scripts/hermes.exe" : "hermes");
}
