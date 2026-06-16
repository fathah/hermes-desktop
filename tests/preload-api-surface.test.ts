import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
// The hermesAPI methods live in per-domain bridge modules (src/preload/bridges/*)
// merged by index.ts; scan all of them so parity covers the full surface.
const bridgesDir = join(ROOT, "src/preload/bridges");
const substackRadarBridgeSrc = readFileSync(
  join(bridgesDir, "substack-radar.ts"),
  "utf-8",
);
const bridgeSrc = readdirSync(bridgesDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(join(bridgesDir, f), "utf-8"))
  .join("\n");
const preloadSrc =
  readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8") + "\n" + bridgeSrc;
const preloadTypes = readFileSync(
  join(ROOT, "src/preload/index.d.ts"),
  "utf-8",
);

/**
 * Extract method names from the hermesAPI object in preload/index.ts.
 * Matches lines like `  methodName: (...` or `  methodName: ()`.
 */
function extractPreloadMethods(src: string): string[] {
  const methods: string[] = [];
  const re = /^\s{2}(\w+)\s*:\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    methods.push(m[1]);
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

  it("has global voice trigger API", () => {
    expect(preloadMethods).toContain("onGlobalVoiceTrigger");
    expect(typeMethods).toContain("onGlobalVoiceTrigger");
  });

  it("has obsidian APIs", () => {
    for (const method of [
      "getObsidianConfig",
      "setObsidianConfig",
      "getObsidianTree",
      "readObsidianFile",
      "writeObsidianFile",
      "appendObsidianFile",
      "searchObsidian",
      "openObsidianNote",
      "callObsidianFunction",
      "onObsidianFileChanged",
    ]) {
      expect(preloadMethods).toContain(method);
      expect(typeMethods).toContain(method);
    }
  });

  it("has Substack radar APIs", () => {
    for (const method of [
      "spsSubstackRadarRun",
      "spsSubstackRadarListRuns",
      "spsSubstackRadarSetCandidateStatus",
      "spsSubstackRadarAddApprovedFeeds",
    ]) {
      expect(preloadMethods).toContain(method);
      expect(typeMethods).toContain(method);
    }
  });

  it("types Substack radar APIs with structured results", () => {
    expect(preloadTypes).toContain("SubstackRadarRun");
    expect(preloadTypes).toContain("SubstackRadarRunInput");
    expect(preloadTypes).toContain("SubstackRadarSetCandidateStatusInput");
    expect(preloadTypes).toContain("SubstackRadarAddApprovedFeedsInput");
    expect(preloadTypes).toContain("SubstackRadarAddApprovedFeedsResult");
    expect(substackRadarBridgeSrc).toContain("SubstackRadarRunInput");
    expect(substackRadarBridgeSrc).toContain(
      "SubstackRadarSetCandidateStatusInput",
    );
    expect(substackRadarBridgeSrc).toContain(
      "SubstackRadarAddApprovedFeedsInput",
    );
    expect(substackRadarBridgeSrc).toContain("Promise<SubstackRadarRun>");
    expect(substackRadarBridgeSrc).toContain("Promise<SubstackRadarRun[]>");
    expect(substackRadarBridgeSrc).toContain(
      "Promise<SubstackRadarAddApprovedFeedsResult>",
    );
    expect(preloadTypes).toContain("Promise<SubstackRadarRun>");
    expect(preloadTypes).toContain("Promise<SubstackRadarRun[]>");
    expect(preloadTypes).toContain(
      "Promise<SubstackRadarAddApprovedFeedsResult>",
    );
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
    "getWhatsAppCloudStatus",
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
