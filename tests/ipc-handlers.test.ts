import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

/**
 * Extract all IPC channel names registered.
 */
function extractIpcHandleChannels(src: string): string[] {
  const channels: string[] = [];
  const re =
    /(?:ipcMain\.handle|safeHandle|registerDualHandler)\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return [...new Set(channels)];
}

/**
 * Extract all ipcRenderer.invoke channel names from preload.
 */
function extractPreloadInvokeChannels(src: string): string[] {
  const channels: string[] = [];
  const re = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return [...new Set(channels)];
}

function getIpcSources(): string[] {
  const sources: string[] = [];
  sources.push(readFileSync(join(ROOT, "src/main/index.ts"), "utf-8"));

  const ipcDir = join(ROOT, "src/main/ipc");
  function readTsFiles(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        readTsFiles(fullPath);
      } else if (entry.endsWith(".ts")) {
        sources.push(readFileSync(fullPath, "utf-8"));
      }
    }
  }

  try {
    readTsFiles(ipcDir);
  } catch (err) {
    console.warn("Failed to read src/main/ipc directory:", err);
  }
  return sources;
}

const mainChannels = [
  ...new Set(getIpcSources().flatMap((src) => extractIpcHandleChannels(src))),
];

function getPreloadSources(): string[] {
  const sources: string[] = [
    readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8"),
  ];
  // hermesAPI methods (and their ipcRenderer.invoke calls) live in per-domain
  // bridge modules merged by index.ts.
  const bridgesDir = join(ROOT, "src/preload/bridges");
  try {
    for (const file of readdirSync(bridgesDir)) {
      if (file.endsWith(".ts")) {
        sources.push(readFileSync(join(bridgesDir, file), "utf-8"));
      }
    }
  } catch (err) {
    console.warn("Failed to read src/preload/bridges directory:", err);
  }
  return sources;
}

const preloadChannels = [
  ...new Set(
    getPreloadSources().flatMap((src) => extractPreloadInvokeChannels(src)),
  ),
];

describe("IPC Handler ↔ Preload Consistency", () => {
  it("main process registers IPC handlers", () => {
    expect(mainChannels.length).toBeGreaterThan(30);
  });

  it("preload invokes IPC channels", () => {
    expect(preloadChannels.length).toBeGreaterThan(30);
  });

  it("every preload invoke has a matching main handler", () => {
    const missing = preloadChannels.filter((ch) => !mainChannels.includes(ch));
    expect(missing).toEqual([]);
  });

  it("every main handler has a matching preload invoke", () => {
    const missing = mainChannels.filter((ch) => !preloadChannels.includes(ch));
    expect(missing).toEqual([]);
  });
});

// ─── New feature handlers registered ────────────────────

describe("New IPC handlers from v0.8/v0.9 features", () => {
  const newChannels = [
    "run-hermes-backup",
    "run-hermes-import",
    "read-logs",
    "run-hermes-dump",
    "list-mcp-servers",
    "add-mcp-server",
    "remove-mcp-server",
    "set-mcp-server-enabled",
    "test-mcp-server",
    "list-mcp-catalog",
    "install-mcp-catalog-entry",
    "discover-memory-providers",
    "get-obsidian-config",
    "set-obsidian-config",
    "get-obsidian-tree",
    "read-obsidian-file",
    "write-obsidian-file",
    "append-obsidian-file",
    "search-obsidian",
    "open-obsidian-note",
    "call-obsidian-function",
  ];

  for (const ch of newChannels) {
    it(`main has handler: ${ch}`, () => {
      expect(mainChannels).toContain(ch);
    });

    it(`preload invokes: ${ch}`, () => {
      expect(preloadChannels).toContain(ch);
    });
  }
});

// ─── Legacy handlers still present ──────────────────────

describe("Legacy IPC handlers preserved", () => {
  const legacyChannels = [
    "check-install",
    "start-install",
    "get-hermes-version",
    "run-hermes-doctor",
    "run-hermes-update",
    "get-env",
    "set-env",
    "get-config",
    "set-config",
    "get-model-config",
    "set-model-config",
    "send-message",
    "abort-chat",
    "start-gateway",
    "stop-gateway",
    "gateway-status",
    "get-platform-enabled",
    "set-platform-enabled",
    "list-sessions",
    "get-session-messages",
    "list-profiles",
    "create-profile",
    "list-cron-jobs",
    "create-cron-job",
    "open-external",
  ];

  for (const ch of legacyChannels) {
    it(`${ch} handler still registered`, () => {
      expect(mainChannels).toContain(ch);
    });
  }
});
