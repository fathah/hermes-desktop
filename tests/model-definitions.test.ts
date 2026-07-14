import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Shared model definitions: per-model-id metadata (context window, display name,
 * capabilities) defined once and merged onto every provider attachment of that
 * model id. Covers the read-time merge, the definitions CRUD, and the one-time
 * migration that hoists legacy per-row `contextLength` into a definition.
 */

let testHome: string;

async function loadModels(): Promise<typeof import("../src/main/models")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/models");
}

function writeModelsFile(rows: unknown[]): void {
  writeFileSync(join(testHome, "models.json"), JSON.stringify(rows, null, 2));
}

function readDefsFile(): Record<string, { contextLength?: number; name?: string }> {
  const p = join(testHome, "model-definitions.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : {};
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "hermes-model-defs-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testHome, { recursive: true, force: true });
});

describe("model definitions store", () => {
  it("setModelDefinition upserts and getModelDefinition reads it back", async () => {
    const { setModelDefinition, getModelDefinition } = await loadModels();
    const def = setModelDefinition("gpt-4o", { contextLength: 128000, name: "GPT-4o" });
    expect(def.contextLength).toBe(128000);
    expect(def.name).toBe("GPT-4o");
    expect(getModelDefinition("gpt-4o")?.contextLength).toBe(128000);
    // Upsert merges: a later patch keeps prior fields it doesn't set.
    setModelDefinition("gpt-4o", { name: "GPT-4o (renamed)" });
    const after = getModelDefinition("gpt-4o")!;
    expect(after.contextLength).toBe(128000);
    expect(after.name).toBe("GPT-4o (renamed)");
  });

  it("a null/0 contextLength clears the override", async () => {
    const { setModelDefinition, getModelDefinition } = await loadModels();
    setModelDefinition("m", { contextLength: 8000 });
    setModelDefinition("m", { contextLength: null });
    expect(getModelDefinition("m")?.contextLength).toBeUndefined();
  });

  it("readModels merges the definition's contextLength onto every attachment of the model id", async () => {
    const { setModelDefinition, readModels } = await loadModels();
    // Same model id attached to two providers.
    writeModelsFile([
      { id: "a", name: "GPT-4o", provider: "openai", model: "gpt-4o", baseUrl: "", createdAt: 1 },
      { id: "b", name: "GPT-4o", provider: "custom", model: "gpt-4o", baseUrl: "https://x/v1", createdAt: 2 },
    ]);
    setModelDefinition("gpt-4o", { contextLength: 128000 });
    const rows = readModels();
    expect(rows.every((r) => r.contextLength === 128000)).toBe(true);
  });

  it("readModels never overwrites a row's own name (keeps runtime env-key derivation stable)", async () => {
    const { setModelDefinition, readModels } = await loadModels();
    writeModelsFile([
      { id: "a", name: "My Custom Label", provider: "custom", model: "x", baseUrl: "https://x/v1", createdAt: 1 },
      { id: "b", name: "", provider: "custom", model: "x", baseUrl: "https://y/v1", createdAt: 2 },
    ]);
    setModelDefinition("x", { name: "Definition Name" });
    const rows = readModels();
    // Row with a name keeps it; empty-name row falls back to the definition name.
    expect(rows.find((r) => r.id === "a")?.name).toBe("My Custom Label");
    expect(rows.find((r) => r.id === "b")?.name).toBe("Definition Name");
  });

  it("addModel routes contextLength into the definition, not onto the row", async () => {
    const { addModel } = await loadModels();
    addModel("Qwen Max", "qwen", "qwen-max", "", 65536);
    const raw = JSON.parse(readFileSync(join(testHome, "models.json"), "utf-8"));
    // The persisted row must not carry contextLength (it lives in the definition).
    expect("contextLength" in raw[0]).toBe(false);
    expect(readDefsFile()["qwen-max"].contextLength).toBe(65536);
  });
});

describe("ensureModelDefinitionsMigrated", () => {
  it("hoists legacy per-row contextLength into definitions and strips the rows", async () => {
    const { ensureModelDefinitionsMigrated } = await loadModels();
    writeModelsFile([
      { id: "a", name: "Qwen", provider: "qwen", model: "qwen-max", baseUrl: "", contextLength: 32768, createdAt: 1 },
      { id: "b", name: "GPT", provider: "openai", model: "gpt-4o", baseUrl: "", createdAt: 2 },
    ]);
    ensureModelDefinitionsMigrated();
    const raw = JSON.parse(readFileSync(join(testHome, "models.json"), "utf-8"));
    expect(raw.every((r: Record<string, unknown>) => !("contextLength" in r))).toBe(true);
    expect(readDefsFile()["qwen-max"].contextLength).toBe(32768);
    // A row that never had an override gets no definition.
    expect(readDefsFile()["gpt-4o"]).toBeUndefined();
  });

  it("keeps the larger context window when two attachments of a model id disagree", async () => {
    const { ensureModelDefinitionsMigrated } = await loadModels();
    writeModelsFile([
      { id: "a", name: "X", provider: "openai", model: "x", baseUrl: "", contextLength: 8000, createdAt: 1 },
      { id: "b", name: "X", provider: "custom", model: "x", baseUrl: "https://x/v1", contextLength: 64000, createdAt: 2 },
    ]);
    ensureModelDefinitionsMigrated();
    expect(readDefsFile()["x"].contextLength).toBe(64000);
  });

  it("is idempotent — a second run hoists nothing", async () => {
    const { ensureModelDefinitionsMigrated } = await loadModels();
    writeModelsFile([
      { id: "a", name: "Qwen", provider: "qwen", model: "qwen-max", baseUrl: "", contextLength: 32768, createdAt: 1 },
    ]);
    ensureModelDefinitionsMigrated();
    const firstDefs = JSON.stringify(readDefsFile());
    const firstRows = readFileSync(join(testHome, "models.json"), "utf-8");
    ensureModelDefinitionsMigrated();
    expect(JSON.stringify(readDefsFile())).toBe(firstDefs);
    expect(readFileSync(join(testHome, "models.json"), "utf-8")).toBe(firstRows);
  });
});
