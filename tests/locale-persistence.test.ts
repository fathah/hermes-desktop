import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AppLocale } from "../src/shared/i18n";

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

  it("normalizes stale saved non-English locale values after restart", async () => {
    const firstRun = await loadLocaleModule();

    expect(firstRun.setAppLocale("es" as unknown as AppLocale)).toBe("en");

    const secondRun = await loadLocaleModule();

    expect(secondRun.getAppLocale()).toBe("en");
  }, 10000);
});
