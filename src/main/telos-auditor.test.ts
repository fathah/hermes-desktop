// telos-auditor.test.ts — unit tests for Telos Auditor and Piping Console.
import { vi } from "vitest";

// Mock main process dependencies first to avoid ESM caching issues
vi.mock("./note-index", () => {
  return {
    getSpsNoteIndex: () => Promise.resolve({
      query: () => [
        { path: "note1.md", title: "Note 1" },
        { path: "note2.md", title: "Note 2" },
      ],
    }),
  };
});

vi.mock("./sps-storage", () => {
  return {
    resolveSpsVaultDir: () => "/fake/vault",
  };
});

vi.mock("./hermes", () => {
  return {
    getApiUrl: () => "http://localhost:8000",
    getRemoteAuthHeader: () => ({ Authorization: "Bearer test-key" }),
  };
});

// Mock fs module using plain functions for base behavior
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mockFs = {
    ...actual,
    existsSync: (_path: string) => true,
    readFileSync: (_path: string) => "mock content",
  };
  return {
    ...mockFs,
    default: mockFs,
  };
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTelosAudit, runPipingPattern } from "./telos-auditor";
import fs from "fs";

const originalFetch = globalThis.fetch;

describe("Telos Alignment Auditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "### Mocked Audit Report" } }]
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns error when TELOS.md does not exist", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (p.toString().endsWith("TELOS.md")) return false;
      return true;
    });

    const res = await runTelosAudit("default");
    expect(res.success).toBe(false);
    expect(res.error).toContain("No TELOS.md found");
  });

  it("queries index, reads files, calls gateway and returns report when TELOS.md exists", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (p.toString().endsWith("TELOS.md")) {
        return "# My Mission\nTo build helpful systems.";
      }
      return "Finished coding feature 1.";
    });

    const res = await runTelosAudit("default");
    expect(res.success).toBe(true);
    expect(res.title).toContain("Telos Audit -");
    expect(res.markdown).toBe("### Mocked Audit Report");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("handles gateway fetch error and returns success: false", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const res = await runTelosAudit("default");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Gateway error 500");
  });
});

describe("Piping Console Patterns", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Piped Output" } }]
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls completions API with correct prompt for 'wisdom'", async () => {
    const res = await runPipingPattern("Hello world", "wisdom", "default");
    expect(res.success).toBe(true);
    expect(res.result).toBe("Piped Output");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, fetchOpts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchOpts.body);
    expect(body.messages[1].content).toContain("Extract the most important wisdom");
  });

  it("calls completions API with correct prompt for 'voice_briefing'", async () => {
    const res = await runPipingPattern("Daily Focus: coding", "voice_briefing", "default");
    expect(res.success).toBe(true);
    expect(res.result).toBe("Piped Output");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, fetchOpts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchOpts.body);
    expect(body.messages[1].content).toContain("Write a spoken briefing summarizing my day");
  });

  it("returns error for unknown pattern", async () => {
    const res = await runPipingPattern("Hello world", "unknown-pattern", "default");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Unknown pattern");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
