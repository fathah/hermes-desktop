import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadConfigModule(): Promise<
  typeof import("../src/main/config")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

describe("deleteEnvValue", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-delete-env-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("removes a matching key and keeps the rest of the file intact", async () => {
    const { readEnv, setEnvValue, deleteEnvValue } = await loadConfigModule();

    setEnvValue("CUSTOM_PROVIDER_OLDNAME_KEY", "sk-old");
    setEnvValue("OPENAI_API_KEY", "sk-openai");

    deleteEnvValue("CUSTOM_PROVIDER_OLDNAME_KEY");

    expect(readEnv()).toEqual({ OPENAI_API_KEY: "sk-openai" });
  });

  it("is a no-op when the key is not present", async () => {
    const { readEnv, setEnvValue, deleteEnvValue } = await loadConfigModule();

    setEnvValue("OPENAI_API_KEY", "sk-openai");
    deleteEnvValue("CUSTOM_PROVIDER_NEVER_SET_KEY");

    expect(readEnv()).toEqual({ OPENAI_API_KEY: "sk-openai" });
  });

  it("is a no-op when the .env file does not exist yet", async () => {
    const { deleteEnvValue } = await loadConfigModule();

    expect(() => deleteEnvValue("CUSTOM_PROVIDER_FOO_KEY")).not.toThrow();
    expect(existsSync(join(testHome, ".env"))).toBe(false);
  });
});
