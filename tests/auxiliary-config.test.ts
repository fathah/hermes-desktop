import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Tests for auxiliary config nested YAML writer and get/set/reset functions.

const TEST_DIR = join(tmpdir(), `hermes-test-aux-config-${Date.now()}`);

async function importAuxConfigWithHome(
  home: string,
): Promise<typeof import("../src/main/auxiliary-config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/auxiliary-config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getAuxiliaryConfig", () => {
  it("returns defaults when config.yaml doesn't exist", async () => {
    const { getAuxiliaryConfig, AUX_TASK_SLOTS } =
      await importAuxConfigWithHome(TEST_DIR);
    const config = getAuxiliaryConfig();

    expect(config).toHaveLength(AUX_TASK_SLOTS.length);
    expect(config[0]).toEqual({
      task: "vision",
      provider: "auto",
      model: "",
      baseUrl: "",
    });
  });

  it("reads existing auxiliary config from config.yaml", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "auxiliary:",
        "  vision:",
        "    provider: openai",
        "    model: gpt-4o-mini",
        "    base_url: https://api.openai.com/v1",
        "  compression:",
        "    provider: anthropic",
        "    model: claude-haiku",
        "",
      ].join("\n"),
    );

    const { getAuxiliaryConfig } = await importAuxConfigWithHome(TEST_DIR);
    const config = getAuxiliaryConfig();

    const vision = config.find((c) => c.task === "vision");
    expect(vision).toEqual({
      task: "vision",
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    const compression = config.find((c) => c.task === "compression");
    expect(compression).toEqual({
      task: "compression",
      provider: "anthropic",
      model: "claude-haiku",
      baseUrl: "",
    });

    const webExtract = config.find((c) => c.task === "web_extract");
    expect(webExtract).toEqual({
      task: "web_extract",
      provider: "auto",
      model: "",
      baseUrl: "",
    });
  });

  it("handles missing fields gracefully", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "auxiliary:",
        "  vision:",
        "    provider: custom",
        "    # model and base_url missing",
        "",
      ].join("\n"),
    );

    const { getAuxiliaryConfig } = await importAuxConfigWithHome(TEST_DIR);
    const config = getAuxiliaryConfig();

    const vision = config.find((c) => c.task === "vision");
    expect(vision).toEqual({
      task: "vision",
      provider: "custom",
      model: "",
      baseUrl: "",
    });
  });
});

describe("setAuxiliaryField", () => {
  it("creates auxiliary block when missing", async () => {
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const result = setAuxiliaryField("", "vision", "provider", "openai");

    expect(result).toContain("auxiliary:");
    expect(result).toContain("  vision:");
    expect(result).toContain('    provider: "openai"');
  });

  it("creates task sub-block when missing", async () => {
    const content = [
      "auxiliary:",
      "  compression:",
      "    provider: auto",
      "",
    ].join("\n");
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const result = setAuxiliaryField(
      content,
      "vision",
      "provider",
      "anthropic",
    );

    expect(result).toContain("auxiliary:");
    expect(result).toContain("  vision:");
    expect(result).toContain('    provider: "anthropic"');
    // Existing task should remain intact
    expect(result).toContain("  compression:");
  });

  it("updates existing field within task", async () => {
    const content = [
      "auxiliary:",
      "  vision:",
      '    provider: "openai"',
      '    model: "gpt-4o"',
      "",
    ].join("\n");
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const result = setAuxiliaryField(
      content,
      "vision",
      "provider",
      "anthropic",
    );

    expect(result).toContain('    provider: "anthropic"');
    expect(result).toContain('    model: "gpt-4o"');
  });

  it("inserts new field within existing task", async () => {
    const content = [
      "auxiliary:",
      "  vision:",
      '    provider: "openai"',
      "",
    ].join("\n");
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const result = setAuxiliaryField(content, "vision", "model", "gpt-4o-mini");

    expect(result).toContain('    provider: "openai"');
    expect(result).toContain('    model: "gpt-4o-mini"');
  });

  it("preserves other top-level blocks", async () => {
    const content = [
      "model:",
      '  default: "gpt-4o"',
      "auxiliary:",
      "  vision:",
      '    provider: "openai"',
      "personalities:",
      "  default: helpful",
      "",
    ].join("\n");
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const result = setAuxiliaryField(content, "vision", "model", "gpt-4o-mini");

    expect(result).toContain('  default: "gpt-4o"');
    expect(result).toContain("  default: helpful");
    expect(result).toContain('    model: "gpt-4o-mini"');
  });

  it("preserves comments and extra fields in task", async () => {
    const content = [
      "auxiliary:",
      "  vision:",
      "    # Vision model for image analysis",
      '    provider: "openai"',
      "    timeout: 30",
      "",
    ].join("\n");
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const result = setAuxiliaryField(content, "vision", "model", "gpt-4o-mini");

    expect(result).toContain("# Vision model for image analysis");
    expect(result).toContain("    timeout: 30");
    expect(result).toContain('    model: "gpt-4o-mini"');
  });
});

describe("setAuxiliaryTask", () => {
  it("writes all three fields to config.yaml", async () => {
    const { setAuxiliaryTask, getAuxiliaryConfig } =
      await importAuxConfigWithHome(TEST_DIR);

    setAuxiliaryTask("vision", {
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    const config = getAuxiliaryConfig();
    const vision = config.find((c) => c.task === "vision");
    expect(vision).toEqual({
      task: "vision",
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("creates config.yaml when missing", async () => {
    const configFile = join(TEST_DIR, "config.yaml");
    expect(existsSync(configFile)).toBe(false);

    const { setAuxiliaryTask, getAuxiliaryConfig } =
      await importAuxConfigWithHome(TEST_DIR);

    setAuxiliaryTask("compression", {
      provider: "anthropic",
      model: "claude-haiku",
      baseUrl: "",
    });

    expect(existsSync(configFile)).toBe(true);
    const config = getAuxiliaryConfig();
    const compression = config.find((c) => c.task === "compression");
    expect(compression).toEqual({
      task: "compression",
      provider: "anthropic",
      model: "claude-haiku",
      baseUrl: "",
    });
  });

  it("updates existing task config", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "auxiliary:",
        "  vision:",
        '    provider: "openai"',
        '    model: "gpt-4o"',
        "",
      ].join("\n"),
    );

    const { setAuxiliaryTask, getAuxiliaryConfig } =
      await importAuxConfigWithHome(TEST_DIR);

    setAuxiliaryTask("vision", {
      provider: "anthropic",
      model: "claude-sonnet",
      baseUrl: "",
    });

    const config = getAuxiliaryConfig();
    const vision = config.find((c) => c.task === "vision");
    expect(vision).toEqual({
      task: "vision",
      provider: "anthropic",
      model: "claude-sonnet",
      baseUrl: "",
    });
  });

  it("throws for unknown task", async () => {
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);

    expect(() =>
      setAuxiliaryTask("unknown_task", {
        provider: "auto",
        model: "",
        baseUrl: "",
      }),
    ).toThrow("unknown auxiliary task: unknown_task");
  });

  it("handles empty values (sets to auto/empty)", async () => {
    const { setAuxiliaryTask, getAuxiliaryConfig } =
      await importAuxConfigWithHome(TEST_DIR);

    setAuxiliaryTask("vision", {
      provider: "",
      model: "",
      baseUrl: "",
    });

    const config = getAuxiliaryConfig();
    const vision = config.find((c) => c.task === "vision");
    expect(vision).toEqual({
      task: "vision",
      provider: "auto",
      model: "",
      baseUrl: "",
    });
  });
});

describe("resetAuxiliaryToAuto", () => {
  it("resets all tasks to auto", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "auxiliary:",
        "  vision:",
        '    provider: "openai"',
        '    model: "gpt-4o"',
        "  compression:",
        '    provider: "anthropic"',
        '    model: "claude-haiku"',
        "",
      ].join("\n"),
    );

    const { resetAuxiliaryToAuto, getAuxiliaryConfig } =
      await importAuxConfigWithHome(TEST_DIR);

    resetAuxiliaryToAuto();

    const config = getAuxiliaryConfig();
    for (const task of config) {
      expect(task.provider).toBe("auto");
      expect(task.model).toBe("");
    }
  });

  it("does nothing when config.yaml doesn't exist", async () => {
    const configFile = join(TEST_DIR, "config.yaml");
    expect(existsSync(configFile)).toBe(false);

    const { resetAuxiliaryToAuto } = await importAuxConfigWithHome(TEST_DIR);

    expect(() => resetAuxiliaryToAuto()).not.toThrow();
    expect(existsSync(configFile)).toBe(false);
  });

  it("preserves other config blocks", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "gpt-4o"',
        "auxiliary:",
        "  vision:",
        '    provider: "openai"',
        "personalities:",
        "  default: helpful",
        "",
      ].join("\n"),
    );

    const { resetAuxiliaryToAuto } = await importAuxConfigWithHome(TEST_DIR);

    resetAuxiliaryToAuto();

    const content = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(content).toContain('  default: "gpt-4o"');
    expect(content).toContain("  default: helpful");
  });
});

describe("auxiliary credential ownership", () => {
  const original = [
    "providers:",
    "  agent-plan:",
    "    base_url: https://plan.example/v1",
    "    key_env: HERMES_CUSTOM_AGENT_PLAN_API_KEY",
    "auxiliary: # Keep task settings",
    "  vision:",
    "    provider: agnesai",
    "    model: old-model",
    "    base_url: https://agnes.example/v1",
    "    api_key: old-direct-secret",
    "    key_env: HERMES_CUSTOM_AGNESAI_API_KEY",
    "    api_key_env: LEGACY_AGNES_KEY",
    "    api: https://agnes.example/legacy",
    "    api_mode: chat_completions",
    "    timeout: 42",
    "    extra_body:",
    "      key_env: nested-option",
    "      model: nested-model",
    "  compression:",
    "    provider: openai",
    "    api_key: compression-secret",
    "",
  ].join("\n");
  function seed(): string {
    const path = join(TEST_DIR, "config.yaml");
    writeFileSync(path, original);
    return path;
  }

  // @lat: [[provider-setup#Provider setup#Auxiliary credential ownership#Provider and endpoint changes]]
  it("replaces a stale key pointer with the new named provider declaration", async () => {
    const path = seed();
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "agent-plan",
      model: "new-model",
      baseUrl: "",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).toContain('key_env: "HERMES_CUSTOM_AGENT_PLAN_API_KEY"');
    expect(saved).not.toContain("AGNES");
    expect(saved).not.toContain("old-direct-secret");
    expect(saved).not.toContain("api_mode:");
    expect(saved).not.toContain("legacy");
    expect(saved).toContain("api_key: compression-secret");
    expect(saved).toContain("      key_env: nested-option");
    expect(saved).toContain("      model: nested-model");
    expect(saved).toContain("timeout: 42");
  });

  it("clears credential aliases for a native provider switch", async () => {
    const path = seed();
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "anthropic",
      model: "claude",
      baseUrl: "",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).not.toContain("AGNES");
    expect(saved).not.toContain("old-direct-secret");
    expect(saved).not.toContain("api_mode:");
    expect(saved).toContain('provider: "anthropic"');
  });

  it("does not reuse a named provider key for an explicit different endpoint", async () => {
    const path = seed();
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "agent-plan",
      model: "new-model",
      baseUrl: "https://other.example/v1",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).not.toContain('key_env: "HERMES_CUSTOM_AGENT_PLAN_API_KEY"');
    expect(saved).not.toContain("old-direct-secret");
  });

  it("clears stale keys when changing only the endpoint under the same provider", async () => {
    const path = seed();
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "agnesai",
      model: "new-model",
      baseUrl: "https://other.example/v1",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).not.toContain("AGNES");
    expect(saved).not.toContain("old-direct-secret");
  });

  // @lat: [[provider-setup#Provider setup#Auxiliary credential ownership#Model-only changes]]
  it("preserves credentials and transport for the same normalized provider/endpoint", async () => {
    const path = seed();
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "agnesai",
      model: "new-model",
      baseUrl: "https://AGNES.example/v1/",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).toContain("api_key: old-direct-secret");
    expect(saved).toContain("key_env: HERMES_CUSTOM_AGNESAI_API_KEY");
    expect(saved).toContain("api_mode: chat_completions");
    expect(saved).toContain('model: "new-model"');
  });

  // @lat: [[provider-setup#Provider setup#Auxiliary credential ownership#Reset persistence]]
  it("persists reset without per-task credentials after reloading the module", async () => {
    const path = seed();
    const { resetAuxiliaryToAuto } = await importAuxConfigWithHome(TEST_DIR);
    resetAuxiliaryToAuto();
    const saved = readFileSync(path, "utf8");
    expect(saved).not.toContain("AGNES");
    expect(saved).not.toContain("old-direct-secret");
    expect(saved).not.toContain("compression-secret");
    expect(saved).not.toContain("api_mode:");
    expect(saved).toContain("      key_env: nested-option");
    const { getAuxiliaryConfig } = await importAuxConfigWithHome(TEST_DIR);
    expect(getAuxiliaryConfig().find((slot) => slot.task === "vision")).toEqual(
      { task: "vision", provider: "auto", model: "", baseUrl: "" },
    );
  });

  // @lat: [[provider-setup#Provider setup#Auxiliary credential ownership#YAML field boundaries]]
  it("inserts routing as a direct child instead of into extra_body, preserving CRLF", async () => {
    const content =
      "auxiliary:\r\n  vision: {} # Empty task\r\n  compression:\r\n    extra_body:\r\n      model: nested-model\r\n";
    const { setAuxiliaryField } = await importAuxConfigWithHome(TEST_DIR);
    const first = setAuxiliaryField(content, "vision", "provider", "openai");
    const saved = setAuxiliaryField(first, "compression", "model", "gpt-4o");
    expect(saved).toContain('    model: "gpt-4o"\r\n    extra_body:');
    expect(saved).toContain("      model: nested-model");
    expect(saved).toContain('    provider: "openai"\r\n');
    expect(saved.replace(/\r\n/g, "")).not.toContain("\n");
  });
  it.each([
    "auxiliary: {vision: {provider: old, key_env: OLD_KEY}}\n",
    "auxiliary:\n  vision: {provider: old, key_env: OLD_KEY}\n",
  ])(
    "rejects unsupported flow mappings without leaving stale credentials or duplicate blocks",
    async (content) => {
      const path = join(TEST_DIR, "config.yaml");
      writeFileSync(path, content);
      const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
      expect(() =>
        setAuxiliaryTask("vision", {
          provider: "openai",
          model: "new",
          baseUrl: "",
        }),
      ).toThrow("use a block mapping");
      expect(readFileSync(path, "utf8")).toBe(content);
    },
  );

  it("resolves the named provider pointer from the selected profile only", async () => {
    const directory = join(TEST_DIR, "profiles", "research");
    mkdirSync(directory, { recursive: true });
    const profileFile = join(directory, "config.yaml");
    writeFileSync(
      profileFile,
      original.replaceAll(
        "HERMES_CUSTOM_AGENT_PLAN_API_KEY",
        "RESEARCH_PLAN_KEY",
      ),
    );
    const rootFile = seed();
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask(
      "vision",
      { provider: "agent-plan", model: "new", baseUrl: "" },
      "research",
    );
    expect(readFileSync(profileFile, "utf8")).toContain(
      'key_env: "RESEARCH_PLAN_KEY"',
    );
    expect(readFileSync(rootFile, "utf8")).toBe(original);
  });
  it("removes quoted credential keys and complete multiline values across blank lines", async () => {
    const path = join(TEST_DIR, "config.yaml");
    writeFileSync(
      path,
      "auxiliary:\n  vision:\n    provider: old\n    \"api_key\": |\n      old-secret\n\n      old-secret-tail\n    'key_env': OLD_KEY\n    timeout: 42\n",
    );
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "openai",
      model: "new",
      baseUrl: "",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).not.toContain("old-secret");
    expect(saved).not.toContain("OLD_KEY");
    expect(saved).toContain("timeout: 42");
  });
  it.each([
    ["agent-plan", "", "agent-plan", "https://plan.example/v1"],
    ["agent-plan", "https://plan.example/v1", "agent-plan", ""],
    ["agent-plan", "", "custom:agent-plan", ""],
    ["custom:agent-plan", "https://plan.example/v1", "agent-plan", ""],
  ])(
    "preserves overrides for equivalent named routes %s %s -> %s %s",
    async (beforeProvider, beforeUrl, provider, baseUrl) => {
      const path = join(TEST_DIR, "config.yaml");
      writeFileSync(
        path,
        `providers:\n  agent-plan:\n    base_url: https://plan.example/v1\n    key_env: SHARED_KEY\nauxiliary:\n  vision:\n    provider: ${beforeProvider}\n    base_url: "${beforeUrl}"\n    api_key: task-secret\n    key_env: TASK_OVERRIDE\n    api_mode: codex_responses\n`,
      );
      const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
      setAuxiliaryTask("vision", { provider, model: "new", baseUrl });
      const saved = readFileSync(path, "utf8");
      expect(saved).toContain("api_key: task-secret");
      expect(saved).toContain("key_env: TASK_OVERRIDE");
      expect(saved).toContain("api_mode: codex_responses");
    },
  );

  it("preserves overrides when a native provider default endpoint becomes explicit", async () => {
    const path = join(TEST_DIR, "config.yaml");
    writeFileSync(
      path,
      "auxiliary:\n  vision:\n    provider: openai\n    api_key: task-secret\n    api_mode: codex_responses\n",
    );
    const { setAuxiliaryTask } = await importAuxConfigWithHome(TEST_DIR);
    setAuxiliaryTask("vision", {
      provider: "openai",
      model: "new",
      baseUrl: "https://api.openai.com/v1/",
    });
    const saved = readFileSync(path, "utf8");
    expect(saved).toContain("api_key: task-secret");
    expect(saved).toContain("api_mode: codex_responses");
  });
});
