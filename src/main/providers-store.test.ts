// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({ hermesHome: "" }));

vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return mockState.hermesHome;
  },
}));

describe("providers store", () => {
  beforeEach(() => {
    mockState.hermesHome = mkdtempSync(join(tmpdir(), "hermes-providers-"));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(mockState.hermesHome, { recursive: true, force: true });
  });

  async function store(): Promise<typeof import("./providers-store")> {
    return import("./providers-store");
  }

  it("returns an empty list when no file exists", async () => {
    const s = await store();
    expect(s.listCustomProviders("default")).toEqual([]);
    expect(existsSync(join(mockState.hermesHome, "providers.json"))).toBe(
      false,
    );
  });

  it("upserts a custom provider and lists it", async () => {
    const s = await store();
    const record = s.upsertCustomProvider("default", {
      name: "faab.ai",
      baseUrl: "https://api.faab.ai/v1",
    });

    expect(record).toMatchObject({
      name: "faab.ai",
      baseUrl: "https://api.faab.ai/v1",
    });
    expect(record?.id).toBeTruthy();
    expect(record?.createdAt).toBeGreaterThan(0);
    expect(s.listCustomProviders("default")).toEqual([record]);
  });

  it("updates in place on re-save, preserving id/createdAt", async () => {
    const s = await store();
    const first = s.upsertCustomProvider("default", {
      name: "faab.ai",
      baseUrl: "https://old.example.com/v1",
    });
    const second = s.upsertCustomProvider("default", {
      name: "faab.ai",
      baseUrl: "https://api.faab.ai/v1",
    });

    const list = s.listCustomProviders("default");
    expect(list).toHaveLength(1);
    expect(second?.id).toBe(first?.id);
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(list[0].baseUrl).toBe("https://api.faab.ai/v1");
  });

  it("dedups by the derived env-key anchor, not the raw name", async () => {
    // "faab.ai" and "FAAB_AI" both sanitize to CUSTOM_PROVIDER_FAAB_AI_KEY, so
    // the second save must update the first record rather than duplicate it.
    const s = await store();
    s.upsertCustomProvider("default", {
      name: "faab.ai",
      baseUrl: "https://a.example.com/v1",
    });
    s.upsertCustomProvider("default", {
      name: "FAAB_AI",
      baseUrl: "https://b.example.com/v1",
    });
    expect(s.listCustomProviders("default")).toHaveLength(1);
  });

  it("ignores upserts missing a name or base URL", async () => {
    const s = await store();
    expect(s.upsertCustomProvider("default", { name: "", baseUrl: "x" })).toBe(
      null,
    );
    expect(
      s.upsertCustomProvider("default", { name: "x", baseUrl: "  " }),
    ).toBe(null);
    expect(s.listCustomProviders("default")).toEqual([]);
  });

  it("removes a provider by name via its env-key anchor", async () => {
    const s = await store();
    s.upsertCustomProvider("default", {
      name: "faab.ai",
      baseUrl: "https://api.faab.ai/v1",
    });
    s.removeCustomProvider("default", "FAAB.AI"); // different casing, same anchor
    expect(s.listCustomProviders("default")).toEqual([]);
  });

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Terminal-added providers import on read]]
  it("imports terminal-added providers: entries from config.yaml", async () => {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      join(mockState.hermesHome, "config.yaml"),
      [
        "providers:",
        "  faab-ai:",
        '    name: "Faab AI"',
        '    base_url: "https://faab.ai/v1"',
        '    key_env: "MY_FAAB_KEY"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(mockState.hermesHome, ".env"), "MY_FAAB_KEY=sk-123\n");

    const s = await store();
    const list = s.listCustomProviders("default");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
    });
    // The terminal entry's key is aliased to the desktop's derived env var so
    // the key field and the chat runtime's label-derived lookup both resolve.
    const env = readFileSync(join(mockState.hermesHome, ".env"), "utf-8");
    expect(env).toContain("CUSTOM_PROVIDER_FAAB_AI_KEY=sk-123");
    // Original stays — aliasing is additive.
    expect(env).toContain("MY_FAAB_KEY=sk-123");
  });

  it("skips config.yaml entries whose host has a dedicated brand card", async () => {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      join(mockState.hermesHome, "config.yaml"),
      [
        "providers:",
        "  my-groq:",
        '    base_url: "https://api.groq.com/openai/v1"',
        "",
      ].join("\n"),
    );
    const s = await store();
    expect(s.listCustomProviders("default")).toEqual([]);
  });

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Store upserts propagate to the agent config]]
  it("mirrors desktop upserts into config.yaml's providers: dict", async () => {
    const s = await store();
    s.upsertCustomProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
    });
    const config = readFileSync(
      join(mockState.hermesHome, "config.yaml"),
      "utf-8",
    );
    expect(config).toContain("faab-ai:");
    expect(config).toContain('base_url: "https://faab.ai/v1"');
    expect(config).toContain('key_env: "CUSTOM_PROVIDER_FAAB_AI_KEY"');
  });

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Desktop deletion cleans the agent config]]
  it("removes the config.yaml entry on delete so it can't re-import", async () => {
    const s = await store();
    s.upsertCustomProvider("default", {
      name: "Faab AI",
      baseUrl: "https://faab.ai/v1",
    });
    s.removeCustomProvider("default", "Faab AI");
    expect(s.listCustomProviders("default")).toEqual([]);
    const config = readFileSync(
      join(mockState.hermesHome, "config.yaml"),
      "utf-8",
    );
    expect(config).not.toContain("faab-ai");
  });

  // @lat: [[provider-setup#Provider setup#Agent config sync for named providers#First-party brands mirror as user providers]]
  it("mirrors a keyed Hermes One into config.yaml providers: without a custom card", async () => {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      join(mockState.hermesHome, ".env"),
      "HERMESONE_API_KEY=hs-live-abc\n",
    );
    const s = await store();
    // No custom-provider card — Hermes One owns a dedicated brand card.
    expect(s.listCustomProviders("default")).toEqual([]);
    const config = readFileSync(
      join(mockState.hermesHome, "config.yaml"),
      "utf-8",
    );
    expect(config).toContain("hermesone:");
    expect(config).toContain('base_url: "https://inference.hermesone.org/v1"');
    expect(config).toContain('key_env: "HERMESONE_API_KEY"');
  });

  it("does not create a providers: entry without a Hermes One key", async () => {
    const s = await store();
    s.listCustomProviders("default");
    expect(existsSync(join(mockState.hermesHome, "config.yaml"))).toBe(false);
  });

  it("isolates providers per profile", async () => {
    const s = await store();
    s.upsertCustomProvider("default", {
      name: "faab.ai",
      baseUrl: "https://api.faab.ai/v1",
    });
    s.upsertCustomProvider("coder", {
      name: "other.ai",
      baseUrl: "https://api.other.ai/v1",
    });

    expect(s.listCustomProviders("default")).toHaveLength(1);
    expect(s.listCustomProviders("coder")).toHaveLength(1);
    expect(s.listCustomProviders("default")[0].name).toBe("faab.ai");
    expect(s.listCustomProviders("coder")[0].name).toBe("other.ai");
  });
});
