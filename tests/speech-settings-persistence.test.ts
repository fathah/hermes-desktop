// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProviderRequestTarget } from "../src/shared/provider-target";
import type { SpeechConfigSetting } from "../src/shared/minimax-speech";
let home = "";
const originalHome = process.env.HERMES_HOME;
beforeEach(() => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), "hermes-speech-settings-"));
  process.env.HERMES_HOME = home;
  mkdirSync(join(home, "profiles", "work"), { recursive: true });
  writeFileSync(join(home, "config.yaml"), "model:\n  default: untouched\n");
});
afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = originalHome;
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
});
async function runtime(): Promise<{
  config: typeof import("../src/main/config");
  speech: typeof import("../src/main/speech");
  target: ProviderRequestTarget;
}> {
  const config = await import("../src/main/config");
  const { providerTargetRevision } =
    await import("../src/main/provider-request-target");
  const speech = await import("../src/main/speech");
  const { connectionId } = config.getActiveConnection();
  const target = {
    connectionId,
    mode: "local" as const,
    revision: providerTargetRevision(config.getConnectionConfig(connectionId)),
  };
  return { config, speech, target };
}
const cases = [
  { name: "no config file", yaml: null },
  {
    name: "no tts block",
    yaml: "# keep comment\nmodel:\n  default: work-model\n",
  },
  {
    name: "tts provider only",
    yaml: "tts:\n  provider: openai\n  openai:\n    voice: alloy\n",
  },
  { name: "empty tts block", yaml: "tts:\n" },
  { name: "empty minimax block", yaml: "tts:\n  minimax:\n" },
  {
    name: "populated speech siblings",
    yaml: "# keep comment\ntts: # speech\n  provider: openai\n  minimax:\n    voice_id: narrator # keep voice\n    model: speech-01-turbo # selected\n  openai:\n    voice: alloy\nagent:\n  max_turns: 20\n",
  },
  {
    name: "four-space mapping indentation",
    yaml: "tts:\n    minimax:\n        voice_id: narrator\n    openai:\n        voice: alloy\n",
  },
  {
    name: "double-quoted speech sibling",
    yaml: 'tts:\n  minimax:\n    model: speech-2.8-hd\n    "voice_id": narrator\n',
  },
  {
    name: "single-quoted speech sibling",
    yaml: "tts:\n  minimax:\n    model: speech-2.8-hd\n    'voice_id': narrator\n",
  },
  {
    name: "quoted provider sibling",
    yaml: 'tts:\n  minimax:\n    model: speech-2.8-hd\n  provider: openai\n  "openai":\n    voice: alloy\n',
  },
  {
    name: "escaped double-quoted sibling",
    yaml: 'tts:\n  minimax:\n    model: speech-2.8-hd\n    "voice\\"id": narrator\n',
  },
];
// @lat: [[speech-playback-tests#Serialized settings persistence]]
it.each(cases)(
  "persists real selected-profile model, region and provider with $name",
  async ({ yaml }) => {
    const path = join(home, "profiles", "work", "config.yaml");
    if (yaml !== null) writeFileSync(path, yaml);
    const { config, speech, target } = await runtime();
    expect(
      speech.setSpeechConfig("model", "speech-2.6-turbo", "work", target),
    ).toBe(true);
    expect(speech.setSpeechConfig("region", "cn", "work", target)).toBe(true);
    expect(speech.getSpeechConfig("work", target)).toEqual({
      model: "speech-2.6-turbo",
      region: "cn",
    });
    const serialized = readFileSync(path, "utf8");
    const parsed = load(serialized) as {
      tts: {
        provider: string;
        minimax: { model: string; region: string; voice_id?: string };
        openai?: { voice: string };
      };
    };
    expect(parsed.tts.provider).toBe("minimax");
    expect(parsed.tts.minimax.model).toBe("speech-2.6-turbo");
    expect(parsed.tts.minimax.region).toBe("cn");
    if (yaml?.includes("voice_id"))
      expect(parsed.tts.minimax.voice_id).toBe("narrator");
    if (yaml?.includes("alloy")) expect(parsed.tts.openai?.voice).toBe("alloy");
    if (yaml?.includes('"voice\\"id"'))
      expect(parsed.tts.minimax).toHaveProperty('voice"id', "narrator");
    if (yaml?.includes("# keep comment"))
      expect(serialized).toContain("# keep comment");
    if (yaml?.includes("# keep voice"))
      expect(serialized).toContain("# keep voice");
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toBe(
      "model:\n  default: untouched\n",
    );
    expect(speech.setSpeechConfig("region", "", "work", target)).toBe(true);
    expect(config.getConfigValue("tts.minimax.region", "work")).toBe("");
    // Reopening the real modules reads disk rather than an optimistic UI/mock.
    vi.resetModules();
    const reopened = await runtime();
    expect(reopened.speech.getSpeechConfig("work", reopened.target)).toEqual({
      model: "speech-2.6-turbo",
      region: "",
    });
  },
);
// @lat: [[speech-playback-tests#Unsafe speech mapping refusal]]
it.each([
  "tts: disabled\n",
  "tts:\n  minimax: disabled\n",
  "tts: { provider: openai }\n",
  "tts:\n  minimax: { voice_id: narrator }\n",
  'model:\n  default: work-model\n"tts":\n  provider: minimax\n  minimax:\n    model: speech-2.8-hd\n',
  'tts:\n  provider: minimax\n  "minimax":\n    model: speech-2.8-hd\n',
  'tts:\n  minimax:\n    voice_id: narrator\n    "model": speech-2.8-hd\n  provider: minimax\n',
  "tts:\n  minimax:\n    model: >\n      speech-2.8-hd\n",
  'tts:\n  minimax:\n    model: "speech-\n      2.8-hd"\n',
  "tts:\n  minimax:\n    - model\n",
])(
  "refuses unsupported YAML parents without acknowledging or rewriting %s",
  async (yaml) => {
    const path = join(home, "profiles", "work", "config.yaml");
    writeFileSync(path, yaml);
    const { speech, target } = await runtime();
    expect(() =>
      speech.setSpeechConfig("model", "speech-2.8-hd", "work", target),
    ).toThrow(/YAML|mapping/);
    expect(readFileSync(path, "utf8")).toBe(yaml);
  },
);

// @lat: [[speech-playback-tests#Unsafe multiline speech leaf refusal]]
it.each([
  { setting: "model", yaml: "tts:\n  minimax:\n    model:\n      name: foo\n" },
  {
    setting: "model",
    yaml: "tts:\n  minimax:\n    model: speech-\n      2.8-hd\n",
  },
  {
    setting: "model",
    yaml: "tts:\n  minimax:\n    model: speech-\n\n      2.8-hd\n",
  },
  {
    setting: "region",
    yaml: "tts:\n  minimax:\n    region:\n      name: cn\n",
  },
  { setting: "region", yaml: "tts:\n  minimax:\n    region: c\n      n\n" },
  { setting: "model", yaml: "tts:\n  provider:\n    name: openai\n" },
  { setting: "model", yaml: "tts:\n  provider: open\n    ai\n" },
] satisfies { setting: SpeechConfigSetting; yaml: string }[])(
  "preserves valid YAML when the edited $setting or provider has child/continuation lines: $yaml",
  async ({ setting, yaml }) => {
    const path = join(home, "profiles", "work", "config.yaml");
    expect(() => load(yaml)).not.toThrow();
    writeFileSync(path, yaml);
    const { speech, target } = await runtime();
    expect(() =>
      speech.setSpeechConfig(
        setting,
        setting === "region" ? "cn" : "speech-2.8-hd",
        "work",
        target,
      ),
    ).toThrow(/YAML|mapping/);
    expect(readFileSync(path, "utf8")).toBe(yaml);
  },
);
