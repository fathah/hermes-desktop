import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-platform-enabled-${process.pid}-${Date.now()}`,
);

async function importConfigWithHome(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, ".env"), "DISCORD_BOT_TOKEN=test-token\r\n");
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("platform enabled overrides", () => {
  it("ignores nested enabled fields when reading a platform override", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "discord:",
        "  max_attachment_bytes: 33554432",
        "  voice_fx:",
        "    enabled: false",
        "    ambient_enabled: true",
        "",
      ].join("\r\n"),
    );

    const { getPlatformEnabled } = await importConfigWithHome(TEST_DIR);

    expect(getPlatformEnabled().discord).toBe(true);
  });

  it("keeps a CRLF config byte-identical when enabling without a direct override", async () => {
    const before = [
      "discord:",
      "  max_attachment_bytes: 33554432",
      "  voice_fx:",
      "    enabled: false",
      "    ambient_enabled: true",
      "telegram:",
      "  enabled: false",
      "",
    ].join("\r\n");
    const configFile = join(TEST_DIR, "config.yaml");
    writeFileSync(configFile, before);

    const { setPlatformEnabled } = await importConfigWithHome(TEST_DIR);
    setPlatformEnabled("discord", true);

    expect(readFileSync(configFile, "utf-8")).toBe(before);
  });

  it("removes only the direct override and preserves CRLF plus nested settings", async () => {
    const before = [
      "discord:",
      "  enabled: false",
      "  voice_fx:",
      "    enabled: false",
      "    ambient_enabled: true",
      "telegram:",
      "  enabled: false",
      "",
    ].join("\r\n");
    const expected = [
      "discord:",
      "  voice_fx:",
      "    enabled: false",
      "    ambient_enabled: true",
      "telegram:",
      "  enabled: false",
      "",
    ].join("\r\n");
    const configFile = join(TEST_DIR, "config.yaml");
    writeFileSync(configFile, before);

    const { setPlatformEnabled } = await importConfigWithHome(TEST_DIR);
    setPlatformEnabled("discord", true);

    expect(readFileSync(configFile, "utf-8")).toBe(expected);
  });

  it("inserts a direct disable override using the file's CRLF style", async () => {
    const before = ["discord:", "  voice_fx:", "    enabled: false", ""].join(
      "\r\n",
    );
    const expected = [
      "discord:",
      "  enabled: false",
      "  voice_fx:",
      "    enabled: false",
      "",
    ].join("\r\n");
    const configFile = join(TEST_DIR, "config.yaml");
    writeFileSync(configFile, before);

    const { setPlatformEnabled } = await importConfigWithHome(TEST_DIR);
    setPlatformEnabled("discord", false);

    expect(readFileSync(configFile, "utf-8")).toBe(expected);
  });

  it("replaces a direct true override without changing CRLF line endings", async () => {
    const before = [
      "discord:",
      "  enabled: true",
      "  voice_fx:",
      "    enabled: false",
      "",
    ].join("\r\n");
    const expected = [
      "discord:",
      "  enabled: false",
      "  voice_fx:",
      "    enabled: false",
      "",
    ].join("\r\n");
    const configFile = join(TEST_DIR, "config.yaml");
    writeFileSync(configFile, before);

    const { setPlatformEnabled } = await importConfigWithHome(TEST_DIR);
    setPlatformEnabled("discord", false);

    expect(readFileSync(configFile, "utf-8")).toBe(expected);
  });

  it("expands an empty flow block using the file's CRLF style", async () => {
    const before = ["model:", "  default: auto", "discord: {}", ""].join(
      "\r\n",
    );
    const expected = [
      "model:",
      "  default: auto",
      "discord:",
      "  enabled: false",
      "",
    ].join("\r\n");
    const configFile = join(TEST_DIR, "config.yaml");
    writeFileSync(configFile, before);

    const { setPlatformEnabled } = await importConfigWithHome(TEST_DIR);
    setPlatformEnabled("discord", false);

    expect(readFileSync(configFile, "utf-8")).toBe(expected);
  });
});
