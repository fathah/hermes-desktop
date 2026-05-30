import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const preloadSrc = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const preloadTypes = readFileSync(
  join(ROOT, "src/preload/index.d.ts"),
  "utf-8",
);

/**
 * Extract method names from the hermesAPI object in preload/index.ts.
 * Matches lines like `  methodName: (...` or `  methodName: ()`.
 *
 * Also recognises namespaced sub-bundles like `  telemetry: {
 *     gatewayStatus: (...`. Both the namespace key and the
 *   "namespace.member" entries are returned, so the symmetry
 *   check against the type declarations passes for either form.
 */
function extractPreloadMethods(src: string): string[] {
  // Narrow to the hermesAPI block so we don't accidentally pick up
  // `electronAPI` properties (e.g. `process: { … }`).
  const hermesMatch = src.match(/const\s+hermesAPI\s*=\s*\{([\s\S]*?)^\};/m);
  const body = hermesMatch ? hermesMatch[1] : src;

  const methods: string[] = [];
  const re = /^\s{2}(\w+)\s*:\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    methods.push(m[1]);
  }
  // Nested namespace bundles: `  ns: { ... }`
  const nsRe = /^\s{2}(\w+)\s*:\s*\{([\s\S]*?)^\s{2}\}/gm;
  while ((m = nsRe.exec(body)) !== null) {
    const ns = m[1];
    const inner = m[2];
    methods.push(ns);
    const memberRe = /^\s{4}(\w+)\s*:\s*\(/gm;
    let mm: RegExpExecArray | null;
    while ((mm = memberRe.exec(inner)) !== null) {
      methods.push(`${ns}.${mm[1]}`);
    }
  }
  return [...new Set(methods)];
}

/**
 * Extract method names from the HermesAPI interface in index.d.ts.
 */
function extractTypeMethods(src: string): string[] {
  const methods: string[] = [];
  // Match lines inside `interface HermesAPI { ... }`
  const interfaceMatch = src.match(/interface\s+HermesAPI\s*\{([\s\S]*?)^\}/m);
  if (!interfaceMatch) return [];
  const body = interfaceMatch[1];
  const re = /^\s{2}(\w+)\s*[:(]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    methods.push(m[1]);
  }
  // Nested namespace bundles in the type declaration:
  //   `  ns: { ... }`. Members are indented 4 spaces.
  const nsRe = /^\s{2}(\w+)\s*:\s*\{([\s\S]*?)^\s{2}\}/gm;
  while ((m = nsRe.exec(body)) !== null) {
    const ns = m[1];
    const innerBody = m[2];
    const memberRe = /^\s{4}(\w+)\s*[:(]/gm;
    let mm: RegExpExecArray | null;
    while ((mm = memberRe.exec(innerBody)) !== null) {
      methods.push(`${ns}.${mm[1]}`);
    }
  }
  return [...new Set(methods)];
}

const preloadMethods = extractPreloadMethods(preloadSrc);
const typeMethods = extractTypeMethods(preloadTypes);

describe("Preload API Surface", () => {
  it("preload exposes methods", () => {
    expect(preloadMethods.length).toBeGreaterThan(30);
  });

  it("type declarations define methods", () => {
    expect(typeMethods.length).toBeGreaterThan(30);
  });

  it("every preload method has a type declaration", () => {
    const missing = preloadMethods.filter((m) => !typeMethods.includes(m));
    expect(missing).toEqual([]);
  });

  it("every type declaration has a preload implementation", () => {
    const missing = typeMethods.filter((m) => !preloadMethods.includes(m));
    expect(missing).toEqual([]);
  });
});

// ─── New APIs exist ─────────────────────────────────────

describe("New APIs from v0.8/v0.9 features", () => {
  it("has backup/import APIs", () => {
    expect(preloadMethods).toContain("runHermesBackup");
    expect(preloadMethods).toContain("runHermesImport");
    expect(typeMethods).toContain("runHermesBackup");
    expect(typeMethods).toContain("runHermesImport");
  });

  it("has log viewer API", () => {
    expect(preloadMethods).toContain("readLogs");
    expect(typeMethods).toContain("readLogs");
  });

  it("has debug dump API", () => {
    expect(preloadMethods).toContain("runHermesDump");
    expect(typeMethods).toContain("runHermesDump");
  });

  it("has MCP server list API", () => {
    expect(preloadMethods).toContain("listMcpServers");
    expect(typeMethods).toContain("listMcpServers");
  });

  it("has memory provider discovery API", () => {
    expect(preloadMethods).toContain("discoverMemoryProviders");
    expect(typeMethods).toContain("discoverMemoryProviders");
  });
});

// ─── Legacy APIs still present ──────────────────────────

describe("Legacy APIs preserved (backward compat)", () => {
  const requiredMethods = [
    // Installation
    "checkInstall",
    "startInstall",
    "onInstallProgress",
    // Hermes engine
    "getHermesVersion",
    "refreshHermesVersion",
    "runHermesDoctor",
    "runHermesUpdate",
    // Config
    "getEnv",
    "setEnv",
    "getConfig",
    "setConfig",
    "getHermesHome",
    "getModelConfig",
    "setModelConfig",
    // Chat
    "sendMessage",
    "abortChat",
    "onChatChunk",
    "onChatReasoningChunk",
    "onChatDone",
    "onChatToolProgress",
    "onChatUsage",
    "onChatError",
    // Gateway
    "startGateway",
    "stopGateway",
    "gatewayStatus",
    "getPlatformEnabled",
    "setPlatformEnabled",
    // Sessions
    "listSessions",
    "getSessionMessages",
    // Profiles
    "listProfiles",
    "createProfile",
    "deleteProfile",
    "setActiveProfile",
    // Memory
    "readMemory",
    "addMemoryEntry",
    "updateMemoryEntry",
    "removeMemoryEntry",
    "writeUserProfile",
    // Soul
    "readSoul",
    "writeSoul",
    "resetSoul",
    // Tools
    "getToolsets",
    "setToolsetEnabled",
    // Skills
    "listInstalledSkills",
    "listBundledSkills",
    "getSkillContent",
    "installSkill",
    "uninstallSkill",
    // Models
    "listModels",
    "addModel",
    "removeModel",
    "updateModel",
    // Credential pool
    "getCredentialPool",
    "setCredentialPool",
    // Claw3D
    "claw3dStatus",
    "claw3dSetup",
    // Cron
    "listCronJobs",
    "createCronJob",
    "removeCronJob",
    "pauseCronJob",
    "resumeCronJob",
    "triggerCronJob",
    // Shell
    "openExternal",
  ];

  for (const method of requiredMethods) {
    it(`preload has ${method}`, () => {
      expect(preloadMethods).toContain(method);
    });

    it(`type declaration has ${method}`, () => {
      expect(typeMethods).toContain(method);
    });
  }
});

// ─── IPC channel consistency ────────────────────────────

describe("IPC channel consistency", () => {
  it("preload invoke calls use quoted string channel names", () => {
    const invokeChannels = [
      ...preloadSrc.matchAll(/ipcRenderer\.invoke\(\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(invokeChannels.length).toBeGreaterThan(30);
    // Every channel should be kebab-case
    for (const ch of invokeChannels) {
      expect(ch).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("preload on/removeListener calls use quoted string channel names", () => {
    const onChannels = [
      ...preloadSrc.matchAll(/ipcRenderer\.on\(\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(onChannels.length).toBeGreaterThan(0);
    for (const ch of onChannels) {
      expect(ch).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
