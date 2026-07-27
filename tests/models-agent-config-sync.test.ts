import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Terminal ↔ desktop model-library sync: `custom_providers:` entries in
 * config.yaml must merge into models.json on every renderer-facing read,
 * not only when the library is first seeded. Previously a provider added
 * via the hermes CLI after first run never appeared in the desktop.
 */

let testHome: string;

async function freshModels(): Promise<typeof import("../src/main/models")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/models");
}

function writeCustomProviders(): void {
  writeFileSync(
    join(testHome, "config.yaml"),
    [
      "custom_providers:",
      '  - name: "Faab AI"',
      '    base_url: "https://faab.ai/v1"',
      '    model: "faab-large"',
      '    api_key: "sk-faab"',
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "hermes-models-sync-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testHome, { recursive: true, force: true });
});

// @lat: [[provider-setup#Provider setup#Agent config sync for named providers#Model library merges custom_providers on every read]]
describe("agent-config model sync", () => {
  it("merges custom_providers entries added after first seed", async () => {
    const models = await freshModels();
    // First read seeds the defaults with no custom providers configured.
    expect(models.listModels().some((m) => m.model === "faab-large")).toBe(
      false,
    );

    // The user then adds a provider from the terminal.
    writeCustomProviders();
    const merged = models.listModels();
    const row = merged.find((m) => m.model === "faab-large");
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      provider: "custom",
      baseUrl: "https://faab.ai/v1",
      providerLabel: "Faab AI",
    });
    // Its key is persisted under the desktop's derived env var.
    const env = readFileSync(join(testHome, ".env"), "utf-8");
    expect(env).toContain("CUSTOM_PROVIDER_FAAB_AI_KEY=sk-faab");
  });

  it("is idempotent — repeated reads don't duplicate rows", async () => {
    writeCustomProviders();
    const models = await freshModels();
    models.listModels();
    models.listModels();
    const rows = models.listModels().filter((m) => m.model === "faab-large");
    expect(rows).toHaveLength(1);
  });
});
