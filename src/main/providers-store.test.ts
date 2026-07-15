// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "fs";
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
