import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { parse } from "yaml";
import { profileHome, safeWriteFile } from "../utils";

export interface ShellHookSpec {
  event: string;
  command: string;
  matcher?: string;
}

export interface AllowlistEntry {
  event: string;
  command: string;
  approved_at: string;
}

export class ShellHookManager {
  /**
   * Reads configured hooks from config.yaml in the active profile home.
   */
  public static getConfiguredHooks(profile?: string): ShellHookSpec[] {
    const configFile = join(profileHome(profile), "config.yaml");
    if (!existsSync(configFile)) return [];

    try {
      const content = readFileSync(configFile, "utf-8");
      const config = parse(content);
      if (config && Array.isArray(config.hooks)) {
        return config.hooks as ShellHookSpec[];
      }
    } catch (err) {
      console.error(`[ShellHookManager] Failed to parse config hooks:`, err);
    }
    return [];
  }

  /**
   * Helper to fetch the auto-accept config setting.
   */
  public static isAutoAcceptEnabled(profile?: string): boolean {
    if (process.env.HERMES_ACCEPT_HOOKS === "true") return true;

    const configFile = join(profileHome(profile), "config.yaml");
    if (!existsSync(configFile)) return false;

    try {
      const content = readFileSync(configFile, "utf-8");
      const config = parse(content);
      return config?.hooks_auto_accept === true;
    } catch {
      return false;
    }
  }

  public static getAllowlistPath(profile?: string): string {
    return join(profileHome(profile), "shell-hooks-allowlist.json");
  }

  public static getAllowlist(profile?: string): Record<string, AllowlistEntry> {
    const path = this.getAllowlistPath(profile);
    if (!existsSync(path)) return {};

    try {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content) as Record<string, AllowlistEntry>;
    } catch {
      return {};
    }
  }

  public static isAllowlisted(event: string, command: string, profile?: string): boolean {
    const key = `${event}::${command}`;
    const allowlist = this.getAllowlist(profile);
    return !!allowlist[key];
  }

  public static addToAllowlist(event: string, command: string, profile?: string): void {
    const key = `${event}::${command}`;
    const allowlist = this.getAllowlist(profile);
    allowlist[key] = {
      event,
      command,
      approved_at: new Date().toISOString(),
    };
    try {
      safeWriteFile(this.getAllowlistPath(profile), JSON.stringify(allowlist, null, 2));
    } catch (err) {
      console.error(`[ShellHookManager] Failed to write allowlist:`, err);
    }
  }

  /**
   * Run a matched hook script, feeding context via stdin JSON and getting actions from stdout.
   */
  public static async runHook(
    event: string,
    payload: any,
    profile?: string,
  ): Promise<{ action: "allow" | "block"; message?: string; context?: string }> {
    const hooks = this.getConfiguredHooks(profile);
    const matchedHooks = hooks.filter((h) => {
      if (h.event !== event) return false;
      if (h.matcher && payload && typeof payload.tool_name === "string") {
        return h.matcher === payload.tool_name;
      }
      return true;
    });

    for (const hook of matchedHooks) {
      const command = hook.command;
      const isAllowed = this.isAllowlisted(event, command, profile) || this.isAutoAcceptEnabled(profile);

      if (!isAllowed) {
        return {
          action: "block",
          message: `Hook execution blocked: '${command}' is not in the allowlist for event '${event}'.`,
        };
      }

      // Auto-record to allowlist if accepted via environment/settings and not already listed
      if (this.isAutoAcceptEnabled(profile) && !this.isAllowlisted(event, command, profile)) {
        this.addToAllowlist(event, command, profile);
      }

      try {
        const result = await this.executeSubprocessHook(command, event, payload);
        if (result.action === "block") {
          return result;
        }
        if (result.context) {
          return result; // return context injection
        }
      } catch (err) {
        console.warn(`[ShellHookManager] Hook execution failed for ${command}:`, err);
        // Fail-open: don't block agent execution if hook script crashes
      }
    }

    return { action: "allow" };
  }

  private static executeSubprocessHook(
    command: string,
    event: string,
    payload: any,
  ): Promise<{ action: "allow" | "block"; message?: string; context?: string }> {
    return new Promise((resolve, reject) => {
      // shlex-like splitting logic or standard exec shell option.
      // We spawn with standard node shell configuration for compatibility
      const proc = spawn(command, [], {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("Hook script execution timed out"));
      }, 10000); // 10s timeout limit

      // Pipe the stdin JSON
      const stdinPayload = JSON.stringify({
        hook_event_name: event,
        ...payload,
      });

      proc.stdin.write(stdinPayload);
      proc.stdin.end();

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Hook script exited with code ${code}. Stderr: ${stderr}`));
          return;
        }

        try {
          const trimmed = stdout.trim();
          if (!trimmed) {
            resolve({ action: "allow" });
            return;
          }

          const response = JSON.parse(trimmed);
          const action = response.action || response.decision || "allow";
          const message = response.message || response.reason || "";
          const context = response.context || "";

          if (action === "block") {
            resolve({ action: "block", message });
          } else {
            resolve({ action: "allow", context });
          }
        } catch {
          // If stdout is not valid JSON, default to allow (fail-open)
          resolve({ action: "allow" });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
