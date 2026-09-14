import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Per-model context-window override round-trips through models.json:
 * `addModel`/`updateModel` persist a positive `contextLength`, and clearing it
 * (null / 0 / undefined-but-present) deletes the key so auto-detection resumes.
 */

let testHome: string;

async function loadModels(): Promise<typeof import("../src/main/models")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/models");
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "hermes-models-ctx-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testHome, { recursive: true, force: true });
});

describe("models.json — contextLength override", () => {
  it("addModel persists a positive contextLength", async () => {
    const { addModel, listModels } = await loadModels();
    const added = addModel("Qwen Max", "qwen", "qwen-max", "", 65536);
    expect(added.contextLength).toBe(65536);
    expect(listModels().find((m) => m.id === added.id)?.contextLength).toBe(
      65536,
    );
  });

  it("addModel omits contextLength when not given or non-positive", async () => {
    const { addModel } = await loadModels();
    expect(addModel("A", "qwen", "a", "").contextLength).toBeUndefined();
    expect(addModel("B", "qwen", "b", "", 0).contextLength).toBeUndefined();
  });

  it("updateModel sets the override and clears it on null", async () => {
    const { addModel, updateModel, readModels } = await loadModels();
    const m = addModel("Qwen", "qwen", "qwen-max", "");

    expect(updateModel(m.id, { contextLength: 32768 })).toBe(true);
    expect(readModels().find((x) => x.id === m.id)?.contextLength).toBe(32768);

    // Clearing removes the key entirely rather than storing 0/null.
    expect(updateModel(m.id, { contextLength: null })).toBe(true);
    const cleared = readModels().find((x) => x.id === m.id)!;
    expect("contextLength" in cleared).toBe(false);
  });

  it("updateModel leaves contextLength untouched when the field is absent", async () => {
    const { addModel, updateModel, readModels } = await loadModels();
    const m = addModel("Qwen", "qwen", "qwen-max", "", 65536);
    // A name-only edit must not disturb the stored override.
    expect(updateModel(m.id, { name: "Renamed" })).toBe(true);
    const after = readModels().find((x) => x.id === m.id)!;
    expect(after.name).toBe("Renamed");
    expect(after.contextLength).toBe(65536);
  });
});
