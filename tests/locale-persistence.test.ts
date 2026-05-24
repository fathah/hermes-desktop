import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadLocaleModule(): Promise<
  typeof import("../src/main/locale")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/locale");
}

describe("app locale persistence", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-locale-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("reloads the saved locale after the main process restarts", async () => {
    const firstRun = await loadLocaleModule();

    expect(firstRun.setAppLocale("es")).toBe("es");

    const secondRun = await loadLocaleModule();

    expect(secondRun.getAppLocale()).toBe("es");
  });
});
