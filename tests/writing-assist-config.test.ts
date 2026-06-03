import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadWritingAssistModule(): Promise<
  typeof import("../src/main/writing-assist-config")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/writing-assist-config");
}

describe("writing assist config", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-writing-assist-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("returns defaults when no desktop config exists", async () => {
    const { getWritingAssistSettings } = await loadWritingAssistModule();
    expect(getWritingAssistSettings()).toMatchObject({
      enabled: true,
      spellcheck: { mode: "native", language: "auto" },
      autocomplete: {
        mode: "off",
        modelRef: "",
        debounceMs: 250,
        minChars: 3,
      },
      translation: {
        mode: "on_demand",
        modelRef: "",
        sourceLanguage: "auto",
        targetLanguage: "",
        preserveTone: true,
      },
    });
  });

  it("normalizes partial or invalid persisted data", async () => {
    const { writeFileSync } = await import("fs");
    const { getWritingAssistSettings } = await loadWritingAssistModule();
    writeFileSync(
      join(testHome, "desktop.json"),
      JSON.stringify({
        writingAssist: {
          enabled: "yes",
          spellcheck: { mode: "bogus" },
          autocomplete: { mode: "llm", debounceMs: 5, minChars: 999 },
          translation: { mode: "pre_send", preserveTone: "nope" },
        },
      }),
      "utf-8",
    );

    expect(getWritingAssistSettings()).toMatchObject({
      enabled: true,
      spellcheck: { mode: "native", language: "auto" },
      autocomplete: {
        mode: "llm",
        debounceMs: 50,
        minChars: 20,
      },
      translation: {
        mode: "pre_send",
        preserveTone: true,
      },
    });
  });

  it("persists settings without clobbering unrelated desktop config", async () => {
    const { writeFileSync, readFileSync } = await import("fs");
    const { setWritingAssistSettings, getWritingAssistSettings } =
      await loadWritingAssistModule();

    writeFileSync(
      join(testHome, "desktop.json"),
      JSON.stringify({
        connectionMode: "remote",
        remoteUrl: "https://hermes.example",
      }),
      "utf-8",
    );

    const saved = setWritingAssistSettings({
      enabled: false,
      spellcheck: { mode: "off", language: "de-DE" },
      autocomplete: {
        mode: "llm",
        modelRef: "model-123",
        debounceMs: 400,
        minChars: 5,
      },
      translation: {
        mode: "on_demand",
        modelRef: "model-456",
        sourceLanguage: "auto",
        targetLanguage: "English",
        preserveTone: false,
      },
    });

    expect(saved).toEqual(getWritingAssistSettings());
    const raw = JSON.parse(readFileSync(join(testHome, "desktop.json"), "utf-8"));
    expect(raw.connectionMode).toBe("remote");
    expect(raw.remoteUrl).toBe("https://hermes.example");
    expect(raw.writingAssist).toMatchObject({
      enabled: false,
      spellcheck: { mode: "off", language: "de-DE" },
      autocomplete: { modelRef: "model-123" },
      translation: { modelRef: "model-456", targetLanguage: "English" },
    });
  });
});
