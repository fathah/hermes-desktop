import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BrowserWindow } from "electron";

const mockReadDesktopConfig = vi.fn(() => ({}));
const mockReadEnv = vi.fn(() => ({}));
const mockListInstalledSkills = vi.fn(() => []);
const mockGetActiveProfileNameSync = vi.fn(() => "test-profile");
const mockProfileHome = vi.fn(() => "/tmp/hermes-test-profile");
const mockSend = vi.fn();
const filesInMemory = new Map<string, string>();

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  readEnv: () => mockReadEnv(),
  getConnectionConfig: () => ({ mode: "local" }),
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

vi.mock("../src/main/security/network-policy", () => ({
  gatewayFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
  publicFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock("../src/main/skills", () => ({
  listInstalledSkills: () => mockListInstalledSkills(),
}));

vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => mockGetActiveProfileNameSync(),
  profileHome: (p: string) => mockProfileHome(p),
  profilePaths: () => ({}),
  safeWriteFile: (p: string, content: string) => {
    filesInMemory.set(p, content);
  },
}));

// Mock filesystem read/write
vi.mock("fs", () => {
  const fns = {
    existsSync: (p: string) => {
      if (filesInMemory.has(p)) return true;
      for (const k of filesInMemory.keys()) {
        if (k.startsWith(p)) return true;
      }
      return false;
    },
    readFileSync: (p: string) => filesInMemory.get(p) || "",
    writeFileSync: (p: string, content: string) => {
      filesInMemory.set(p, content);
    },
    mkdirSync: () => {},
    readdirSync: (dir: string) => {
      const results: string[] = [];
      for (const k of filesInMemory.keys()) {
        if (k.startsWith(dir)) {
          const parts = k.slice(dir.length).replace(/^\/+/, "").split("/");
          if (parts[0] && !results.includes(parts[0])) {
            results.push(parts[0]);
          }
        }
      }
      return results;
    },
    statSync: () => ({
      mtimeMs: 1000,
    }),
  };
  return { ...fns, default: fns };
});

import {
  triggerSelfHealing,
  setMainWindowGetter,
  getRecentPatches,
} from "../src/main/self-healing";

describe("Self-Healing Loop", () => {
  beforeEach(() => {
    filesInMemory.clear();
    vi.clearAllMocks();

    // Setup dummy profile paths and files
    const profileDir = "/tmp/hermes-test-profile";
    const cronJobsPath = `${profileDir}/cron/jobs.json`;
    filesInMemory.set(
      cronJobsPath,
      JSON.stringify({
        jobs: [
          {
            id: "job-1",
            name: "Test Job",
            prompt: "run test",
            skill: "TestSkill",
            script: "test_script.py",
          },
        ],
      }),
    );

    const skillPath =
      "/tmp/hermes-test-profile/skills/TestCategory/TestSkill/SKILL.md";
    filesInMemory.set(skillPath, "# Test Skill\nSome original content");
    mockListInstalledSkills.mockReturnValue([
      {
        name: "TestSkill",
        path: "/tmp/hermes-test-profile/skills/TestCategory/TestSkill",
      },
    ]);

    const scriptPath = `${profileDir}/scripts/test_script.py`;
    filesInMemory.set(scriptPath, "print('hello')");

    // Setup dummy log file
    const logFilePath = `${profileDir}/logs/routines/routine-job-1.log`;
    filesInMemory.set(logFilePath, "Some failure log output");

    // Mock electron window
    const mockWindow = {
      webContents: {
        send: mockSend,
      },
    } as unknown as BrowserWindow;
    setMainWindowGetter(() => mockWindow);
  });

  it("should parse response from LLM and apply code fix", async () => {
    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "Fixing a bug in script",
                fileToPatch: "test_script.py",
                patchedContent: "print('fixed!')",
              }),
            },
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    const res = await triggerSelfHealing(
      "job-1",
      "Test Job",
      "/tmp/hermes-test-profile/logs/routines/routine-job-1.log",
      "test-profile",
    );

    expect(res.success).toBe(true);
    expect(
      filesInMemory.get("/tmp/hermes-test-profile/scripts/test_script.py"),
    ).toBe("print('fixed!')");
    expect(mockSend).toHaveBeenCalledWith(
      "system-stabilized",
      expect.objectContaining({
        jobId: "job-1",
        filePatched: "test_script.py",
      }),
    );
  });

  it("records self-healing audit history through safe writes", async () => {
    const ledgerFile = "/tmp/hermes-test-profile/logs/config-fixes.log";
    filesInMemory.set(
      ledgerFile,
      `${JSON.stringify({
        issueCode: "SELF_HEALING_REMEDIATION",
        jobId: "job-1",
        patchedContent: "print('old')",
      })}\n`,
    );
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "Fixing a bug in script",
                fileToPatch: "test_script.py",
                patchedContent: "print('new')",
              }),
            },
          },
        ],
      }),
    });

    const res = await triggerSelfHealing(
      "job-1",
      "Test Job",
      "/tmp/hermes-test-profile/logs/routines/routine-job-1.log",
      "test-profile",
    );

    expect(res.success).toBe(true);
    const lines = filesInMemory.get(ledgerFile)?.trim().split("\n") ?? [];
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      patchedContent: "print('old')",
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      issueCode: "SELF_HEALING_REMEDIATION",
      action: "autofix",
      patchedContent: "print('new')",
    });
  });

  it("should reject patch if target file escapes profile directory (traversal guard)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "Attacking system",
                fileToPatch: "../../../etc/passwd",
                patchedContent: "root:x:0:0::/root:/bin/bash",
              }),
            },
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    const res = await triggerSelfHealing(
      "job-1",
      "Test Job",
      "/tmp/hermes-test-profile/logs/routines/routine-job-1.log",
      "test-profile",
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Refused");
  });

  it("should retrieve previous fix attempts and include them in the prompt", async () => {
    const logDir = "/tmp/hermes-test-profile/logs";
    const ledgerFile = `${logDir}/config-fixes.log`;
    filesInMemory.set(
      ledgerFile,
      JSON.stringify({
        issueCode: "SELF_HEALING_REMEDIATION",
        jobId: "job-1",
        patchedContent: "print('previous attempt!')",
        explanation: "buggy try",
      }) + "\n",
    );

    const patches = getRecentPatches("test-profile", "job-1");
    expect(patches).toEqual(["print('previous attempt!')"]);

    // Test that the prompt includes the causal history block
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "Fixing with a new attempt",
                fileToPatch: "test_script.py",
                patchedContent: "print('fixed for real!')",
              }),
            },
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    await triggerSelfHealing(
      "job-1",
      "Test Job",
      "/tmp/hermes-test-profile/logs/routines/routine-job-1.log",
      "test-profile",
    );

    expect(mockFetch).toHaveBeenCalled();
    const fetchArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchArgs[1].body);
    const userPrompt = requestBody.messages[1].content;
    expect(userPrompt).toContain("PREVIOUS FIX ATTEMPTS");
    expect(userPrompt).toContain("print('previous attempt!')");
  });

  it("should attach base64 screenshot to user content when screenshot is present", async () => {
    const screenshotPath =
      "/tmp/hermes-test-profile/logs/routines/routine-job-1-2026-06-08-error.png";
    filesInMemory.set(screenshotPath, "fake-png-bytes");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "Visual check fix",
                fileToPatch: "test_script.py",
                patchedContent: "print('fixed!')",
              }),
            },
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    await triggerSelfHealing(
      "job-1",
      "Test Job",
      "/tmp/hermes-test-profile/logs/routines/routine-job-1.log",
      "test-profile",
    );

    expect(mockFetch).toHaveBeenCalled();
    const fetchArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchArgs[1].body);
    const userContent = requestBody.messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[1].type).toBe("image_url");
    expect(userContent[1].image_url.url).toContain("data:image/png;base64,");
  });

  it("should send Gemini API keys in headers instead of query strings", async () => {
    mockReadEnv.mockReturnValue({ GOOGLE_API_KEY: "gemini-secret-key" });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    explanation: "Fixing through Gemini",
                    fileToPatch: "test_script.py",
                    patchedContent: "print('gemini fixed!')",
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    const res = await triggerSelfHealing(
      "job-1",
      "Test Job",
      "/tmp/hermes-test-profile/logs/routines/routine-job-1.log",
      "test-profile",
    );

    expect(res.success).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).not.toContain("gemini-secret-key");
    expect(String(url)).not.toContain("?key=");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "gemini-secret-key",
    });
  });
});
