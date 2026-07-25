// @vitest-environment node
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({ hermesHome: "" }));

vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return mockState.hermesHome;
  },
}));

describe("agent-config providers (config.yaml bridge)", () => {
  beforeEach(() => {
    mockState.hermesHome = mkdtempSync(join(tmpdir(), "hermes-agent-cfg-"));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(mockState.hermesHome, { recursive: true, force: true });
  });

  async function mod(): Promise<typeof import("./agent-config-providers")> {
    return import("./agent-config-providers");
  }

  function configPath(): string {
    return join(mockState.hermesHome, "config.yaml");
  }

  function writeConfig(content: string): void {
    writeFileSync(configPath(), content);
  }

  function readConfig(): string {
    return readFileSync(configPath(), "utf-8");
  }

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Parses the agent's providers dict]]
  it("parses providers: entries with base_url aliases and key_env", async () => {
    writeConfig(
      [
        "model:",
        '  provider: "custom"',
        "providers:",
        "  faab-ai:",
        '    name: "Faab AI"',
        '    base_url: "https://faab.ai/v1"',
        '    key_env: "FAAB_KEY"',
        "  terse:",
        '    api: "https://terse.example/v1"',
        "gateway:",
        "  port: 9910",
        "",
      ].join("\n"),
    );
    const m = await mod();
    expect(m.listAgentUserProviders("default")).toEqual([
      {
        slug: "faab-ai",
        name: "Faab AI",
        baseUrl: "https://faab.ai/v1",
        keyEnv: "FAAB_KEY",
      },
      {
        slug: "terse",
        name: "terse",
        baseUrl: "https://terse.example/v1",
        keyEnv: "",
      },
    ]);
  });

  it("returns empty for a missing file or absent block", async () => {
    const m = await mod();
    expect(m.listAgentUserProviders("default")).toEqual([]);
    writeConfig("model:\n  provider: nous\n");
    expect(m.listAgentUserProviders("default")).toEqual([]);
  });

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Desktop saves mirror into config.yaml]]
  it("appends a providers: block to an existing config", async () => {
    writeConfig("model:\n  provider: nous\n");
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
      keyEnv: "CUSTOM_PROVIDER_FAAB_AI_KEY",
    });
    expect(readConfig()).toBe(
      [
        "model:",
        "  provider: nous",
        "providers:",
        "  faab-ai:",
        '    name: "Faab AI"',
        '    base_url: "https://faab.ai/v1"',
        '    key_env: "CUSTOM_PROVIDER_FAAB_AI_KEY"',
        "",
      ].join("\n"),
    );
    expect(m.listAgentUserProviders("default")).toEqual([
      {
        slug: "faab-ai",
        name: "Faab AI",
        baseUrl: "https://faab.ai/v1",
        keyEnv: "CUSTOM_PROVIDER_FAAB_AI_KEY",
      },
    ]);
  });

  // The agent's config scaffold writes `providers: {}` (inline empty dict).
  // The upsert must rewrite that line into block form — this exact miss made
  // the Hermes One mirror a silent no-op on real configs (appending would
  // have produced a duplicate `providers:` key instead).
  it("rewrites an inline empty providers dict into block form", async () => {
    writeConfig(
      [
        "model:",
        "  provider: nous",
        "providers: {}",
        "fallback_providers: []",
        "",
      ].join("\n"),
    );
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Hermes One",
      slug: "hermesone",
      baseUrl: "https://inference.hermesone.org/v1",
      keyEnv: "HERMESONE_API_KEY",
    });
    const content = readConfig();
    // Exactly one providers key, now in block form, siblings untouched.
    expect(content.match(/^providers[^\S\r\n]*:/gm)).toHaveLength(1);
    expect(content).toContain("fallback_providers: []");
    expect(m.listAgentUserProviders("default")).toEqual([
      {
        slug: "hermesone",
        name: "Hermes One",
        baseUrl: "https://inference.hermesone.org/v1",
        keyEnv: "HERMESONE_API_KEY",
      },
    ]);
  });

  it("never appends a duplicate key over an unparseable flow dict", async () => {
    const before = [
      'providers: { keep: { base_url: "https://keep.example/v1" } }',
      "",
    ].join("\n");
    writeConfig(before);
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Hermes One",
      baseUrl: "https://inference.hermesone.org/v1",
      keyEnv: "HERMESONE_API_KEY",
    });
    expect(readConfig()).toBe(before);
  });

  it("creates config.yaml when missing", async () => {
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
      keyEnv: "CUSTOM_PROVIDER_FAAB_AI_KEY",
    });
    expect(existsSync(configPath())).toBe(true);
    expect(m.listAgentUserProviders("default")).toHaveLength(1);
  });

  it("updates an existing entry in place, preserving extra fields", async () => {
    writeConfig(
      [
        "providers:",
        "  faab-ai:",
        '    name: "Faab AI"',
        '    base_url: "https://old.faab.ai/v1"',
        '    transport: "anthropic_messages"',
        '    key_env: "CUSTOM_PROVIDER_FAAB_AI_KEY"',
        "gateway:",
        "  port: 9910",
        "",
      ].join("\n"),
    );
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Faab AI",
      baseUrl: "https://new.faab.ai/v1",
      keyEnv: "CUSTOM_PROVIDER_FAAB_AI_KEY",
    });
    const content = readConfig();
    expect(content).toContain('base_url: "https://new.faab.ai/v1"');
    // A terminal user's extra field survives the desktop update.
    expect(content).toContain('transport: "anthropic_messages"');
    expect(content).toContain("gateway:");
    expect(m.listAgentUserProviders("default")).toHaveLength(1);
  });

  it("matches an existing terminal entry by key_env even when slugs differ", async () => {
    writeConfig(
      [
        "providers:",
        "  myfaab:",
        '    name: "Faab"',
        '    base_url: "https://faab.ai/v1"',
        '    key_env: "SHARED_KEY"',
        "",
      ].join("\n"),
    );
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v2",
      keyEnv: "SHARED_KEY",
    });
    const list = m.listAgentUserProviders("default");
    // Updated in place under the original slug — no duplicate entry.
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      slug: "myfaab",
      name: "Faab AI",
      baseUrl: "https://faab.ai/v2",
    });
  });

  it("escapes quotes and backslashes in provider values (valid YAML)", async () => {
    // Review regression: unescaped user input inside double-quoted YAML could
    // produce an unparseable config.yaml. The writer escapes, the reader
    // unescapes — the name round-trips exactly.
    const name = 'My "Fast" \\ Provider';
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name,
      baseUrl: "https://fast.example/v1",
      keyEnv: "FAST_KEY",
    });
    expect(readConfig()).toContain('name: "My \\"Fast\\" \\\\ Provider"');
    const list = m.listAgentUserProviders("default");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe(name);
    // Idempotency survives the escaping: re-upserting is still a no-op.
    const before = readConfig();
    m.upsertAgentUserProvider("default", {
      name,
      baseUrl: "https://fast.example/v1",
      keyEnv: "FAST_KEY",
    });
    expect(readConfig()).toBe(before);
  });

  it("is a no-op re-upserting identical values (no file rewrite)", async () => {
    const m = await mod();
    m.upsertAgentUserProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
      keyEnv: "K",
    });
    const before = readConfig();
    m.upsertAgentUserProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
      keyEnv: "K",
    });
    expect(readConfig()).toBe(before);
  });

  it("removes an entry and leaves siblings intact", async () => {
    writeConfig(
      [
        "providers:",
        "  faab-ai:",
        '    name: "Faab AI"',
        '    base_url: "https://faab.ai/v1"',
        "  other:",
        '    base_url: "https://other.example/v1"',
        "gateway:",
        "  port: 9910",
        "",
      ].join("\n"),
    );
    const m = await mod();
    m.removeAgentUserProvider("default", { name: "Faab AI" });
    const content = readConfig();
    expect(content).not.toContain("faab-ai");
    expect(content).toContain("other:");
    expect(content).toContain("gateway:");
    expect(m.listAgentUserProviders("default")).toHaveLength(1);
  });

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Legacy custom_providers removal]]
  it("removes a legacy custom_providers list item by name", async () => {
    writeConfig(
      [
        "custom_providers:",
        '  - name: "Keep Me"',
        '    base_url: "https://keep.example/v1"',
        '    model: "keep-1"',
        '  - name: "Drop Me"',
        '    base_url: "https://drop.example/v1"',
        '    model: "drop-1"',
        "gateway:",
        "  port: 9910",
        "",
      ].join("\n"),
    );
    const m = await mod();
    m.removeAgentCustomProviderEntry("default", "Drop Me");
    const content = readConfig();
    expect(content).toContain("Keep Me");
    expect(content).not.toContain("Drop Me");
    expect(content).not.toContain("drop.example");
    expect(content).toContain("gateway:");
  });

  it("slugifies display names the way the agent expects", async () => {
    const m = await mod();
    expect(m.slugifyProviderName("Faab AI")).toBe("faab-ai");
    expect(m.slugifyProviderName("  My_Provider 2!  ")).toBe("my-provider-2");
  });
});
