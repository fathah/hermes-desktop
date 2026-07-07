import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveInstallScriptPath,
  validateInstallScriptContent,
} from "../src/main/installer";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/hermes-app",
    getPath: () => "",
    isPackaged: false,
  },
  BrowserWindow: class {},
}));

const TEST_DIR = join(
  tmpdir(),
  `hermes-installer-script-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

function shellInstaller(): string {
  return [
    "#!/bin/bash",
    "# Hermes Agent Installer",
    "set -e",
    'REPO_URL_HTTPS="https://github.com/NousResearch/hermes-agent.git"',
    "#".repeat(180),
    "",
  ].join("\n");
}

function powershellInstaller(): string {
  return [
    "# Hermes Agent Installer for Windows",
    "param(",
    "    [switch]$SkipSetup",
    ")",
    '$ErrorActionPreference = "Stop"',
    "#".repeat(180),
    "",
  ].join("\r\n");
}

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? "OK" : "Failure",
  });
}

function bundledPath(name: string): string {
  const path = join(TEST_DIR, `bundled-${name}`);
  writeFileSync(path, `bundled ${name}`, "utf-8");
  return path;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("live Hermes install script refresh", () => {
  it("stages a fetched Unix installer when sanity checks pass", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(shellInstaller()));

    const result = await resolveInstallScriptPath("install.sh", {
      bundledPath: bundledPath("install.sh"),
      fetchImpl,
      tempDir: TEST_DIR,
    });

    expect(result.source).toBe("live");
    expect(result.path).not.toContain("bundled-install.sh");
    expect(readFileSync(result.path, "utf-8")).toContain(
      "Hermes Agent Installer",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hermes-agent.nousresearch.com/install.sh",
      expect.any(Object),
    );

    result.cleanup?.();
    expect(existsSync(result.path)).toBe(false);
  });

  it("stages a fetched Windows installer when sanity checks pass", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(powershellInstaller()));

    const result = await resolveInstallScriptPath("install.ps1", {
      bundledPath: bundledPath("install.ps1"),
      fetchImpl,
      tempDir: TEST_DIR,
    });

    expect(result.source).toBe("live");
    expect(readFileSync(result.path, "utf-8")).toContain(
      "$ErrorActionPreference",
    );
    result.cleanup?.();
  });

  it("falls back to the bundled Unix installer when the fetched header is wrong", async () => {
    const fallback = bundledPath("install.sh");
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(`echo nope\n${"#".repeat(180)}`));

    const result = await resolveInstallScriptPath("install.sh", {
      bundledPath: fallback,
      fetchImpl,
      tempDir: TEST_DIR,
    });

    expect(result).toMatchObject({
      source: "bundled",
      path: fallback,
      reason: "missing-shell-shebang",
    });
  });

  it("rejects empty fetched scripts before falling back", async () => {
    const fallback = bundledPath("install.sh");
    const fetchImpl = vi.fn().mockResolvedValue(response(""));

    const result = await resolveInstallScriptPath("install.sh", {
      bundledPath: fallback,
      fetchImpl,
      tempDir: TEST_DIR,
    });

    expect(result.source).toBe("bundled");
    expect(result.reason).toBe("empty-response");
  });

  it("rejects oversized fetched scripts before falling back", async () => {
    const fallback = bundledPath("install.ps1");
    const fetchImpl = vi.fn().mockResolvedValue(response("#".repeat(600_000)));

    const result = await resolveInstallScriptPath("install.ps1", {
      bundledPath: fallback,
      fetchImpl,
      tempDir: TEST_DIR,
    });

    expect(result.source).toBe("bundled");
    expect(result.reason).toBe("script-too-large");
  });

  it("falls back to bundled scripts when the live fetch fails", async () => {
    const fallback = bundledPath("install.sh");
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await resolveInstallScriptPath("install.sh", {
      bundledPath: fallback,
      fetchImpl,
      tempDir: TEST_DIR,
    });

    expect(result.source).toBe("bundled");
    expect(result.path).toBe(fallback);
    expect(result.reason).toContain("network down");
  });

  it("validates PowerShell installer structure directly", () => {
    expect(
      validateInstallScriptContent("install.ps1", powershellInstaller()),
    ).toBeNull();
    expect(
      validateInstallScriptContent("install.ps1", "# just a comment"),
    ).toBe("script-too-small");
  });
});
