import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * Config-health audit — runs checks against a real on-disk profile and
 * surfaces inconsistencies. Tests exercise each check + its auto-fix.
 */

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-config-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshHealth(
  home: string,
): Promise<typeof import("../src/main/config-health")> {
  vi.resetModules();
  vi.doMock("../src/main/wsl-detection", () => ({
    findSiblingHermesHomes: () => [],
  }));
  process.env.HERMES_HOME = home;
  return await import("../src/main/config-health");
}

function writeConfig(content: string): void {
  writeFileSync(join(TEST_DIR, "config.yaml"), content);
}

function writeEnv(content: string): void {
  writeFileSync(join(TEST_DIR, ".env"), content);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("runConfigHealthCheck", () => {
  it("returns an empty report for a clean configuration", async () => {
    writeConfig(
      [
        "model:",
        "  provider: auto",
        "  default: ''",
        "",
        "api_server:",
        "  token: ''",
        "",
      ].join("\n"),
    );
    writeEnv("API_SERVER_KEY=sk-clean-test\n");
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    expect(report.issues).toEqual([]);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });

  it("flags API_SERVER_KEY_NON_CANONICAL when key lives in api_server.token only", async () => {
    writeConfig(["api_server:", "  token: sk-nested-only", ""].join("\n"));
    // No .env file
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    const issue = report.issues.find(
      (i) => i.code === "API_SERVER_KEY_NON_CANONICAL",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(issue?.autoFixable).toBe(true);
  });

  it("flags API_SERVER_KEY_MULTIPLE_VALUES when env and config disagree", async () => {
    writeConfig(["api_server:", "  token: sk-yaml-value", ""].join("\n"));
    writeEnv("API_SERVER_KEY=sk-different-env-value\n");
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    const issue = report.issues.find(
      (i) => i.code === "API_SERVER_KEY_MULTIPLE_VALUES",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    // Ambiguous — user has to resolve
    expect(issue?.autoFixable).toBe(false);
  });

  it("flags MODEL_KEY_MISSING when active model's key isn't in .env", async () => {
    writeConfig(
      [
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    writeEnv("SOME_OTHER_KEY=irrelevant\n");
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    const issue = report.issues.find((i) => i.code === "MODEL_KEY_MISSING");
    expect(issue).toBeDefined();
    expect(issue?.context?.expectedKey).toBe("OPENROUTER_API_KEY");
  });

  // Issue #367 — Nous Portal accepts both NOUS_API_KEY and an auth.json
  // OAuth/credential-pool entry. Audit should flag only when BOTH are
  // empty (the actual misconfiguration), and should clear once either
  // is set.

  it("flags MODEL_KEY_MISSING for nous when neither NOUS_API_KEY nor auth.json is set (#367)", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    const issue = report.issues.find((i) => i.code === "MODEL_KEY_MISSING");
    expect(issue).toBeDefined();
    expect(issue?.context?.expectedKey).toBe("NOUS_API_KEY");
    expect(issue?.context?.provider).toBe("nous");
  });

  it("does NOT flag MODEL_KEY_MISSING for nous when auth.json has OAuth credentials", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify(
        {
          version: 1,
          providers: {
            nous: {
              access_token: "oauth-token",
              auth_type: "oauth_device_code",
            },
          },
        },
        null,
        2,
      ),
    );
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    expect(
      report.issues.find((i) => i.code === "MODEL_KEY_MISSING"),
    ).toBeUndefined();
  });

  it("does NOT flag MODEL_KEY_MISSING for localhost models", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://localhost:11434/v1",
        "",
      ].join("\n"),
    );
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    expect(
      report.issues.find((i) => i.code === "MODEL_KEY_MISSING"),
    ).toBeUndefined();
  });

  it("does NOT flag MODEL_KEY_MISSING for private LAN model URLs", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://192.168.1.50:1234/v1",
        "",
      ].join("\n"),
    );
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    expect(
      report.issues.find((i) => i.code === "MODEL_KEY_MISSING"),
    ).toBeUndefined();
  });

  it("flags UI_RUNTIME_ENVKEY_MISMATCH when wrong key has a value", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: gpt-4",
        "  base_url: https://api.openai.com/v1",
        "",
      ].join("\n"),
    );
    // Saved under wrong name: ANTHROPIC_API_KEY has value, OPENAI_API_KEY empty
    writeEnv("ANTHROPIC_API_KEY=sk-misfiled-value\n");
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    const issue = report.issues.find(
      (i) => i.code === "UI_RUNTIME_ENVKEY_MISMATCH",
    );
    expect(issue).toBeDefined();
    expect(issue?.autoFixable).toBe(true);
    expect(issue?.context?.from).toBe("ANTHROPIC_API_KEY");
    expect(issue?.context?.to).toBe("OPENAI_API_KEY");
  });

  it("flags NON_ASCII_CREDENTIAL for smart-quote contamination", async () => {
    writeConfig("model:\n  provider: auto\n  default: ''\n");
    // smart quote (curly) sneaked into the value
    writeEnv("OPENROUTER_API_KEY=sk-or-test“trailing\n");
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    const issue = report.issues.find((i) => i.code === "NON_ASCII_CREDENTIAL");
    expect(issue).toBeDefined();
    expect(issue?.autoFixable).toBe(true);
  });

  it("returns a report even when one check throws (broken check doesn't break audit)", async () => {
    writeConfig("model:\n  provider: auto\n");
    const { runConfigHealthCheck } = await freshHealth(TEST_DIR);
    const report = runConfigHealthCheck();
    expect(report).toBeDefined();
    expect(Array.isArray(report.issues)).toBe(true);
  });
});

describe("autoFixIssue", () => {
  it("migrates non-canonical API_SERVER_KEY into .env", async () => {
    writeConfig(["api_server:", "  token: sk-migrate-me", ""].join("\n"));
    const { autoFixIssue } = await freshHealth(TEST_DIR);
    const result = autoFixIssue("API_SERVER_KEY_NON_CANONICAL");
    expect(result.ok).toBe(true);
    const envFile = join(TEST_DIR, ".env");
    expect(existsSync(envFile)).toBe(true);
    expect(readFileSync(envFile, "utf-8")).toMatch(
      /^API_SERVER_KEY=sk-migrate-me/m,
    );
  });

  it("copies misfiled env key to the expected name", async () => {
    writeEnv("GROQ_API_KEY=sk-meant-for-openrouter\n");
    const { autoFixIssue } = await freshHealth(TEST_DIR);
    const result = autoFixIssue("UI_RUNTIME_ENVKEY_MISMATCH", undefined, {
      from: "GROQ_API_KEY",
      to: "OPENROUTER_API_KEY",
    });
    expect(result.ok).toBe(true);
    const env = readFileSync(join(TEST_DIR, ".env"), "utf-8");
    expect(env).toMatch(/^OPENROUTER_API_KEY=sk-meant-for-openrouter/m);
    // Original untouched
    expect(env).toMatch(/^GROQ_API_KEY=sk-meant-for-openrouter/m);
  });

  it("strips non-ASCII characters from credentials", async () => {
    writeEnv("OPENROUTER_API_KEY=sk-or-test“tail\n");
    const { autoFixIssue } = await freshHealth(TEST_DIR);
    const result = autoFixIssue("NON_ASCII_CREDENTIAL", undefined, {
      keys: "OPENROUTER_API_KEY",
    });
    expect(result.ok).toBe(true);
    const env = readFileSync(join(TEST_DIR, ".env"), "utf-8");
    expect(env).toMatch(/^OPENROUTER_API_KEY=sk-or-testtail/m);
  });

  it("returns ok:false for unknown issue codes", async () => {
    const { autoFixIssue } = await freshHealth(TEST_DIR);
    // @ts-expect-error testing runtime guard
    const result = autoFixIssue("NONEXISTENT_CODE");
    expect(result.ok).toBe(false);
  });

  it("writes an audit entry to config-fixes.log", async () => {
    writeConfig(["api_server:", "  token: sk-audit-me", ""].join("\n"));
    const { autoFixIssue } = await freshHealth(TEST_DIR);
    autoFixIssue("API_SERVER_KEY_NON_CANONICAL");
    const logFile = join(TEST_DIR, "logs", "config-fixes.log");
    expect(existsSync(logFile)).toBe(true);
    const entry = JSON.parse(
      readFileSync(logFile, "utf-8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .pop()!,
    );
    expect(entry.action).toBe("autofix");
    expect(entry.issueCode).toBe("API_SERVER_KEY_NON_CANONICAL");
    // Secret never appears in the log
    expect(entry.valueMasked).not.toBe("sk-audit-me");
  });
});

describe("checkLegacyToolsetName", () => {
  it("flags a top-level toolsets list containing legacy `- hermes`", async () => {
    writeConfig(
      [
        "model:",
        "  provider: auto",
        "  default: ''",
        "toolsets:",
        "- hermes",
        "agent:",
        "  max_turns: 60",
        "",
      ].join("\n"),
    );
    const { checkLegacyToolsetName } = await freshHealth(TEST_DIR);
    const issues = checkLegacyToolsetName();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("LEGACY_TOOLSET_NAME");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].autoFixable).toBe(true);
    expect(issues[0].fixLocation).toBe("config.yaml");
  });

  it("emits no issue when toolsets uses the canonical `hermes-cli` name", async () => {
    writeConfig(
      [
        "model:",
        "  provider: auto",
        "  default: ''",
        "toolsets:",
        "- hermes-cli",
        "",
      ].join("\n"),
    );
    const { checkLegacyToolsetName } = await freshHealth(TEST_DIR);
    expect(checkLegacyToolsetName()).toEqual([]);
  });

  it("emits no issue when only platform-suffixed names are present (`hermes-telegram` etc.)", async () => {
    writeConfig(
      [
        "toolsets:",
        "- hermes-cli",
        "- hermes-telegram",
        "- hermes-discord",
        "",
      ].join("\n"),
    );
    const { checkLegacyToolsetName } = await freshHealth(TEST_DIR);
    expect(checkLegacyToolsetName()).toEqual([]);
  });

  it("tolerates quoted entries and trailing comments", async () => {
    writeConfig(["toolsets:", '  - "hermes"   # legacy alias', ""].join("\n"));
    const { checkLegacyToolsetName } = await freshHealth(TEST_DIR);
    const issues = checkLegacyToolsetName();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("LEGACY_TOOLSET_NAME");
  });

  it("only inspects the top-level toolsets block, not platform_toolsets", async () => {
    // `platform_toolsets.cli` is the desktop's own enable list; the legacy
    // check must not flag a per-platform `hermes` entry under a different
    // parent (that block uses its own validation in tools.ts).
    writeConfig(
      [
        "toolsets:",
        "- hermes-cli",
        "platform_toolsets:",
        "  cli:",
        "  - web",
        "  - hermes", // would be a false positive if the parser leaked
        "",
      ].join("\n"),
    );
    const { checkLegacyToolsetName } = await freshHealth(TEST_DIR);
    expect(checkLegacyToolsetName()).toEqual([]);
  });

  it("emits no issue when config.yaml is missing", async () => {
    const { checkLegacyToolsetName } = await freshHealth(TEST_DIR);
    expect(checkLegacyToolsetName()).toEqual([]);
  });
});

describe("fixLegacyToolsetName", () => {
  it("rewrites the legacy entry in place", async () => {
    writeConfig(
      [
        "model:",
        "  provider: auto",
        "toolsets:",
        "- hermes",
        "agent:",
        "  max_turns: 60",
        "",
      ].join("\n"),
    );
    const { fixLegacyToolsetName } = await freshHealth(TEST_DIR);
    const result = fixLegacyToolsetName();
    expect(result.ok).toBe(true);
    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).toMatch(/^- hermes-cli$/m);
    expect(after).not.toMatch(/^- hermes$/m);
    // Other blocks untouched
    expect(after).toMatch(/^agent:$/m);
    expect(after).toMatch(/^model:$/m);
  });

  it("preserves quoting style and trailing comment when rewriting", async () => {
    writeConfig(["toolsets:", '  - "hermes"   # legacy alias', ""].join("\n"));
    const { fixLegacyToolsetName } = await freshHealth(TEST_DIR);
    expect(fixLegacyToolsetName().ok).toBe(true);
    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).toMatch(/^\s+- "hermes-cli"\s+# legacy alias$/m);
  });

  it("returns ok:false when nothing matches", async () => {
    writeConfig(["toolsets:", "- hermes-cli", ""].join("\n"));
    const { fixLegacyToolsetName } = await freshHealth(TEST_DIR);
    const result = fixLegacyToolsetName();
    expect(result.ok).toBe(false);
  });

  it("writes an audit-log entry recording the rewrite", async () => {
    writeConfig(["toolsets:", "- hermes", ""].join("\n"));
    const { fixLegacyToolsetName } = await freshHealth(TEST_DIR);
    fixLegacyToolsetName();
    const logFile = join(TEST_DIR, "logs", "config-fixes.log");
    expect(existsSync(logFile)).toBe(true);
    const entry = JSON.parse(
      readFileSync(logFile, "utf-8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .pop()!,
    );
    expect(entry.issueCode).toBe("LEGACY_TOOLSET_NAME");
    expect(entry.action).toBe("autofix");
    expect(entry.from).toBe("hermes");
    expect(entry.to).toBe("hermes-cli");
  });
});
