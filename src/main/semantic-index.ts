// semantic-index.ts — Electron Main Process Manager for the Python semantic_engine.py helper.
// Spawns the python process, writes JSON commands to stdin, and resolves async promises on stdout line responses.

import { ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";
import { existsSync } from "fs";
import { HERMES_PYTHON, getBundledScriptPath } from "./installer/paths";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

interface RequestPayload {
  cmd: string;
  args?: Record<string, any>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

class SemanticGraphManager {
  private proc: ChildProcess | null = null;
  private reqIdCounter = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private indexDebounceTimer: NodeJS.Timeout | null = null;
  private pendingVaultPath: string | null = null;

  start(): void {
    if (this.proc && !this.proc.killed) return;

    const scriptPath = getBundledScriptPath("semantic_engine.py");
    if (!existsSync(scriptPath)) {
      console.error(`[SemanticIndex] Script missing at: ${scriptPath}`);
      return;
    }

    if (!existsSync(HERMES_PYTHON)) {
      console.error(`[SemanticIndex] Python executable missing at: ${HERMES_PYTHON}`);
      return;
    }

    try {
      this.proc = spawn(HERMES_PYTHON, [scriptPath], {
        stdio: ["pipe", "pipe", "ignore"],
        ...HIDDEN_SUBPROCESS_OPTIONS,
      });

      this.proc.on("error", (err) => {
        console.error("[SemanticIndex] Subprocess failed to start:", err);
      });

      this.proc.on("exit", (code) => {
        console.warn(`[SemanticIndex] Subprocess exited with code: ${code}`);
        this.cleanupPending(new Error(`Subprocess exited with code ${code}`));
        this.proc = null;
      });

      if (this.proc.stdout) {
        const rl = createInterface({ input: this.proc.stdout });
        rl.on("line", (line) => {
          this.handleStdoutLine(line);
        });
      }
    } catch (err) {
      console.error("[SemanticIndex] Failed to spawn python subprocess:", err);
    }
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.cleanupPending(new Error("Semantic engine stopped"));
  }

  private cleanupPending(err: Error): void {
    for (const req of this.pendingRequests.values()) {
      req.reject(err);
    }
    this.pendingRequests.clear();
  }

  private handleStdoutLine(line: string): void {
    try {
      const resp = JSON.parse(line);
      const id = resp.id;
      const req = this.pendingRequests.get(id);
      if (!req) return;

      this.pendingRequests.delete(id);

      if (resp.error) {
        req.reject(new Error(resp.error));
      } else {
        req.resolve(resp.result);
      }
    } catch (e) {
      console.error("[SemanticIndex] Failed to parse output line:", e, line);
    }
  }

  private sendCommand<T = any>(payload: RequestPayload): Promise<T> {
    this.start();
    if (!this.proc || !this.proc.stdin || this.proc.killed) {
      return Promise.reject(new Error("Semantic helper process is not running"));
    }

    return new Promise<T>((resolve, reject) => {
      const id = ++this.reqIdCounter;
      this.pendingRequests.set(id, { resolve, reject });

      const line = JSON.stringify({ id, ...payload }) + "\n";
      this.proc!.stdin!.write(line, "utf-8", (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  async index(vaultPath: string): Promise<any> {
    return this.sendCommand({ cmd: "index", args: { vault_path: vaultPath } });
  }

  triggerIndex(vaultPath: string): void {
    this.pendingVaultPath = vaultPath;
    if (this.indexDebounceTimer) {
      clearTimeout(this.indexDebounceTimer);
    }
    this.indexDebounceTimer = setTimeout(() => {
      if (this.pendingVaultPath) {
        this.index(this.pendingVaultPath).catch((err) => {
          console.error("[SemanticIndex] Debounced indexing failed:", err);
        });
        this.pendingVaultPath = null;
      }
      this.indexDebounceTimer = null;
    }, 1500);
  }

  async search(query: string, limit = 5): Promise<any> {
    return this.sendCommand({ cmd: "search", args: { query, limit } });
  }

  async graph(): Promise<any> {
    return this.sendCommand({ cmd: "graph" });
  }

  async rag(query: string, limit = 3): Promise<any> {
    return this.sendCommand({ cmd: "rag", args: { query, limit } });
  }
}

export const semanticManager = new SemanticGraphManager();
