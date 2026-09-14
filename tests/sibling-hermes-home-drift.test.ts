import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * SIBLING_HERMES_HOME_DRIFT — config drift detection between the
 * Windows-side ~/.hermes/ and any WSL distro's ~/.hermes/.
 *
 * Test strategy: mock `wsl-detection.findSiblingHermesHomes` to
 * return synthetic distros pointing at temp dirs. The check then
 * reads those temp dirs the same way it'd read real \\wsl$\... paths
 * in production, so we exercise the actual diff + auto-fix logic
 * without needing a real WSL distro.
 */

const RUN_ROOT = join(
  tmpdir(),
  `hermes-sibling-drift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);
const WIN_HOME = join(RUN_ROOT, "windows");
const WSL_HOME = join(RUN_ROOT, "wsl-ubuntu-home");

function writeWindowsEnv(content: string): void {
  writeFileSync(join(WIN_HOME, ".env"), content);
}
function writeWindowsConfig(content: string): void {
  writeFileSync(join(WIN_HOME, "config.yaml"), content);
}
function writeWslEnv(content: string): void {
  writeFileSync(join(WSL_HOME, ".env"), content);
}
function writeWslConfig(content: string): void {
  writeFileSync(join(WSL_HOME, "config.yaml"), content);
}

async function freshHealth(): Promise<
  typeof import("../src/main/config-health")
> {
  vi.resetModules();
  vi.doMock("../src/main/wsl-detection", () => ({
    findSiblingHermesHomes: () => [
      { distro: "Ubuntu", user: "tester", hermesHome: WSL_HOME },
    ],
  }));
  process.env.HERMES_HOME = WIN_HOME;
  return await import("../src/main/config-health");
}

beforeEach(() => {
  mkdirSync(WIN_HOME, { recursive: true });
  mkdirSync(WSL_HOME, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  vi.doUnmock("../src/main/wsl-detection");
  rmSync(RUN_ROOT, { recursive: true, force: true });
});

describe("checkSiblingHermesHomeDrift", () => {
  it("emits no issues when both sides have matching configs", async () => {
    writeWindowsEnv("OPENROUTER_API_KEY=sk-or-same\n");
    writeWslEnv("OPENROUTER_API_KEY=sk-or-same\n");
    writeWindowsConfig("model:\n  provider: openrouter\n  default: gpt-4\n");
    writeWslConfig("model:\n  provider: openrouter\n  default: gpt-4\n");

    const { checkSiblingHermesHomeDrift } = await freshHealth();
    const issues = checkSiblingHermesHomeDrift();
    expect(
      issues.filter((i) => i.code === "SIBLING_HERMES_HOME_DRIFT"),
    ).toEqual([]);
  });

  it("flags WSL-only env key as a warning + autoFixable (#384 shape)", async () => {
    // The #384 case: user configured Unsloth on WSL, CLI works there.
    // Windows side .env doesn't have CUSTOM_API_KEY → desktop chat fails.
    writeWindowsEnv("");
    writeWslEnv("CUSTOM_API_KEY=sk-unsloth-test-1234567890\n");
    writeWindowsConfig(
      "model:\n  provider: custom\n  base_url: https://api.unsloth.ai/v1\n",
    );
    writeWslConfig(
      "model:\n  provider: custom\n  base_url: https://api.unsloth.ai/v1\n",
    );

    const { checkSiblingHermesHomeDrift } = await freshHealth();
    const issues = checkSiblingHermesHomeDrift();
    const driftIssue = issues.find(
      (i) =>
        i.code === "SIBLING_HERMES_HOME_DRIFT" &&
        i.context?.field === "CUSTOM_API_KEY",
    );
    expect(driftIssue).toBeDefined();
    expect(driftIssue?.severity).toBe("warning");
    expect(driftIssue?.autoFixable).toBe(true);
    expect(driftIssue?.context?.direction).toBe("wsl-to-windows");
    expect(driftIssue?.context?.distro).toBe("Ubuntu");
    // Detail should mask the secret (no full key in the message)
    expect(driftIssue?.detail).not.toContain("sk-unsloth-test-1234567890");
  });

  it("flags WSL-only model.api_key (config.yaml) as a warning + autoFixable", async () => {
    writeWindowsConfig(
      "model:\n  provider: custom\n  base_url: https://x.test/v1\n",
    );
    writeWslConfig(
      "model:\n  provider: custom\n  base_url: https://x.test/v1\n  api_key: sk-yaml-only-on-wsl\n",
    );

    const { checkSiblingHermesHomeDrift } = await freshHealth();
    const issues = checkSiblingHermesHomeDrift();
    const driftIssue = issues.find(
      (i) =>
        i.code === "SIBLING_HERMES_HOME_DRIFT" &&
        i.context?.field === "model.api_key",
    );
    expect(driftIssue).toBeDefined();
    expect(driftIssue?.autoFixable).toBe(true);
    expect(driftIssue?.severity).toBe("warning");
  });

  it("flags Windows-only value as info (not autoFixable)", async () => {
    writeWindowsEnv("DEEPSEEK_API_KEY=sk-on-windows\n");
    writeWslEnv("");

    const { checkSiblingHermesHomeDrift } = await freshHealth();
    const issues = checkSiblingHermesHomeDrift();
    const driftIssue = issues.find(
      (i) =>
        i.code === "SIBLING_HERMES_HOME_DRIFT" &&
        i.context?.field === "DEEPSEEK_API_KEY",
    );
    expect(driftIssue).toBeDefined();
    expect(driftIssue?.severity).toBe("info");
    expect(driftIssue?.autoFixable).toBe(false);
    expect(driftIssue?.context?.direction).toBe("windows-to-wsl");
  });

  it("flags two different non-empty values as info (ambiguous, not autoFixable)", async () => {
    writeWindowsEnv("OPENAI_API_KEY=sk-windows-side\n");
    writeWslEnv("OPENAI_API_KEY=sk-different-on-wsl\n");

    const { checkSiblingHermesHomeDrift } = await freshHealth();
    const issues = checkSiblingHermesHomeDrift();
    const driftIssue = issues.find(
      (i) =>
        i.code === "SIBLING_HERMES_HOME_DRIFT" &&
        i.context?.field === "OPENAI_API_KEY",
    );
    expect(driftIssue).toBeDefined();
    expect(driftIssue?.severity).toBe("info");
    expect(driftIssue?.autoFixable).toBe(false);
    expect(driftIssue?.context?.direction).toBe("ambiguous");
    // Both values masked
    expect(driftIssue?.detail).not.toContain("sk-windows-side");
    expect(driftIssue?.detail).not.toContain("sk-different-on-wsl");
  });

  it("emits nothing when no WSL distros are detected", async () => {
    vi.resetModules();
    vi.doMock("../src/main/wsl-detection", () => ({
      findSiblingHermesHomes: () => [],
    }));
    process.env.HERMES_HOME = WIN_HOME;
    writeWindowsEnv("OPENAI_API_KEY=sk-test\n");
    const { checkSiblingHermesHomeDrift } =
      await import("../src/main/config-health");
    expect(checkSiblingHermesHomeDrift()).toEqual([]);
  });
});

describe("fixSiblingHermesHomeDrift", () => {
  it("copies the WSL env value into the Windows-side .env", async () => {
    writeWindowsEnv("");
    writeWslEnv("CUSTOM_API_KEY=sk-copy-this-one\n");

    const { fixSiblingHermesHomeDrift } = await freshHealth();
    const result = fixSiblingHermesHomeDrift(undefined, {
      field: "CUSTOM_API_KEY",
      wslHome: WSL_HOME,
      direction: "wsl-to-windows",
      distro: "Ubuntu",
      user: "tester",
    });

    expect(result.ok).toBe(true);
    const winEnv = readFileSync(join(WIN_HOME, ".env"), "utf-8");
    expect(winEnv).toMatch(/^CUSTOM_API_KEY=sk-copy-this-one/m);
    // WSL side untouched
    const wslEnv = readFileSync(join(WSL_HOME, ".env"), "utf-8");
    expect(wslEnv).toMatch(/^CUSTOM_API_KEY=sk-copy-this-one/m);
  });

  it("copies the WSL config.yaml field into the Windows-side config.yaml", async () => {
    writeWindowsConfig(
      "model:\n  provider: custom\n  base_url: https://x.test/v1\n",
    );
    writeWslConfig(
      "model:\n  provider: custom\n  base_url: https://x.test/v1\n  api_key: sk-yaml-value\n",
    );

    const { fixSiblingHermesHomeDrift } = await freshHealth();
    const result = fixSiblingHermesHomeDrift(undefined, {
      field: "model.api_key",
      wslHome: WSL_HOME,
      direction: "wsl-to-windows",
      distro: "Ubuntu",
      user: "tester",
    });

    expect(result.ok).toBe(true);
    const winYaml = readFileSync(join(WIN_HOME, "config.yaml"), "utf-8");
    // upsertBlockChild writes the value double-quoted
    expect(winYaml).toMatch(/api_key:\s*"sk-yaml-value"/);
  });

  it("refuses to auto-fix the windows-to-wsl direction (we don't write to WSL silently)", async () => {
    writeWindowsEnv("OPENAI_API_KEY=sk-on-windows\n");
    writeWslEnv("");
    const { fixSiblingHermesHomeDrift } = await freshHealth();
    const result = fixSiblingHermesHomeDrift(undefined, {
      field: "OPENAI_API_KEY",
      wslHome: WSL_HOME,
      direction: "windows-to-wsl",
      distro: "Ubuntu",
      user: "tester",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/wsl/i);
  });

  it("writes an audit-log entry with the secret masked", async () => {
    writeWindowsEnv("");
    writeWslEnv("OPENROUTER_API_KEY=sk-or-full-secret-12345\n");
    const { fixSiblingHermesHomeDrift } = await freshHealth();
    fixSiblingHermesHomeDrift(undefined, {
      field: "OPENROUTER_API_KEY",
      wslHome: WSL_HOME,
      direction: "wsl-to-windows",
      distro: "Ubuntu",
      user: "tester",
    });
    const logPath = join(WIN_HOME, "logs", "config-fixes.log");
    expect(existsSync(logPath)).toBe(true);
    const lastLine = readFileSync(logPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .pop()!;
    const entry = JSON.parse(lastLine);
    expect(entry.issueCode).toBe("SIBLING_HERMES_HOME_DRIFT");
    expect(entry.action).toBe("autofix");
    // Secret masked — first 4 + last 4 only
    expect(entry.valueMasked).toBe("sk-o…2345");
    expect(lastLine).not.toContain("sk-or-full-secret-12345");
  });
});
