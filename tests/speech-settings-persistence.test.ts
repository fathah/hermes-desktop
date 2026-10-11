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
import { load, loadAll } from "js-yaml";
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

const commentedScalarCases = ["provider", "model", "region"].flatMap((leaf) =>
  [
    { kind: "empty", scalar: "" },
    { kind: "null", scalar: leaf === "region" ? "~" : "null" },
  ].flatMap(({ kind, scalar }) =>
    ["\n", "\r\n"].map((newline) => ({
      name: `${kind} ${leaf} with ${newline === "\n" ? "LF" : "CRLF"}`,
      leaf,
      scalar,
      newline,
    })),
  ),
);
// @lat: [[speech-playback-tests#Commented empty speech scalar preservation]]
it.each(commentedScalarCases)(
  "saves and reopens valid speech YAML with $name",
  async ({ leaf, scalar, newline }) => {
    const initial = {
      provider: "openai",
      model: "speech-2.8-hd",
      region: "cn",
      [leaf]: scalar,
    };
    const yaml = [
      "# keep prefix",
      "--- # keep start",
      "tts: # keep speech",
      `  provider: ${initial.provider} # keep provider`,
      "  minimax: # keep minimax",
      `    model: ${initial.model} # keep model`,
      `    region: ${initial.region} # keep region`,
      "    voice_id: narrator # keep voice",
      "... # keep end",
      "# keep trailer",
      "",
    ].join(newline);
    expect(() => load(yaml)).not.toThrow();
    const path = join(home, "profiles", "work", "config.yaml");
    writeFileSync(path, yaml);
    const { speech, target } = await runtime();
    expect(
      speech.setSpeechConfig("model", "speech-2.6-turbo", "work", target),
    ).toBe(true);
    expect(speech.setSpeechConfig("region", "cn", "work", target)).toBe(true);
    expect(speech.getSpeechConfig("work", target)).toEqual({
      model: "speech-2.6-turbo",
      region: "cn",
    });
    expect(speech.setSpeechConfig("region", "", "work", target)).toBe(true);
    const serialized = readFileSync(path, "utf8");
    const parsed = load(serialized) as {
      tts: {
        provider: string;
        minimax: { model: string; region: string; voice_id: string };
      };
    };
    expect(parsed.tts).toEqual({
      provider: "minimax",
      minimax: { model: "speech-2.6-turbo", region: "", voice_id: "narrator" },
    });
    expect(serialized).toMatch(
      /provider:[^\r\n]*"minimax"[ \t]+# keep provider/,
    );
    expect(serialized).toMatch(
      /model:[^\r\n]*"speech-2.6-turbo"[ \t]+# keep model/,
    );
    expect(serialized).toMatch(/region:[^\r\n]*""[ \t]+# keep region/);
    expect(serialized).toContain(`voice_id: narrator # keep voice${newline}`);
    expect(serialized).toContain(`minimax: # keep minimax${newline}`);
    expect(
      serialized.startsWith(
        `# keep prefix${newline}--- # keep start${newline}`,
      ),
    ).toBe(true);
    expect(
      serialized.endsWith(`... # keep end${newline}# keep trailer${newline}`),
    ).toBe(true);
    if (newline === "\r\n") expect(serialized).not.toMatch(/(?<!\r)\n/);
    vi.resetModules();
    const reopened = await runtime();
    expect(reopened.speech.getSpeechConfig("work", reopened.target)).toEqual({
      model: "speech-2.6-turbo",
      region: "",
    });
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toBe(
      "model:\n  default: untouched\n",
    );
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

const documentCases = [
  {
    name: "plain closing marker",
    yaml: "model:\n  default: work-model\n...\n",
    trailer: "...\n",
  },
  {
    name: "commented closing marker",
    yaml: "# keep comment\nmodel:\n  default: work-model\n... # end\n# keep trailer\n",
    trailer: "... # end\n# keep trailer\n",
  },
  {
    name: "closing marker without newline",
    yaml: "model:\n  default: work-model\n...",
    trailer: "...",
  },
  {
    name: "CRLF closing marker and trailer",
    yaml: "model:\r\n  default: work-model\r\n... \t# end\r\n# keep trailer\r\n",
    trailer: "... \t# end\r\n# keep trailer\r\n",
  },
  {
    name: "explicit start and end",
    yaml: "---\nmodel:\n  default: work-model\n...\n",
    trailer: "...\n",
  },
  {
    name: "commented leading start",
    yaml: "# keep prefix\n--- # start\nmodel:\n  default: work-model\n...\n",
    trailer: "...\n",
  },
  { name: "empty marker-only start", yaml: "---", trailer: "" },
  {
    name: "commented marker-only start",
    yaml: "--- # keep start",
    trailer: "",
  },
  { name: "empty marker-only end", yaml: "...", trailer: "..." },
  {
    name: "empty explicit CRLF document",
    yaml: "---\r\n...\r\n",
    trailer: "...\r\n",
  },
  { name: "empty unmarked document", yaml: "", trailer: "" },
  {
    name: "mapping without final newline",
    yaml: "model:\n  default: work-model",
    trailer: "",
  },
  {
    name: "existing speech before end",
    yaml: "---\ntts:\n  provider: openai\n  minimax:\n    model: speech-2.8-hd # keep model note\n    voice_id: narrator\n... # end",
    trailer: "... # end",
  },
  {
    name: "empty nested speech before end",
    yaml: "tts:\n  minimax:\n...\n",
    trailer: "...\n",
  },
  {
    name: "indented literal markers",
    yaml: "prompt: |\n  ...\n  ---\nmodel:\n  default: work-model\n...\n",
    trailer: "...\n",
  },
];
// @lat: [[speech-playback-tests#Single-document marker preservation]]
it.each(documentCases)(
  "saves real speech YAML within $name",
  async ({ yaml, trailer }) => {
    expect(() => load(yaml)).not.toThrow();
    const original = load(yaml) as
      | { prompt?: string; model?: unknown }
      | undefined;
    const path = join(home, "profiles", "work", "config.yaml");
    writeFileSync(path, yaml);
    const { speech, target } = await runtime();
    expect(
      speech.setSpeechConfig("model", "speech-2.6-turbo", "work", target),
    ).toBe(true);
    expect(speech.setSpeechConfig("region", "cn", "work", target)).toBe(true);
    const serialized = readFileSync(path, "utf8");
    const parsed = load(serialized) as {
      tts: {
        provider: string;
        minimax: { model: string; region: string; voice_id?: string };
      };
      prompt?: string;
      model?: unknown;
    };
    expect(parsed.tts).toMatchObject({
      provider: "minimax",
      minimax: { model: "speech-2.6-turbo", region: "cn" },
    });
    if (original?.model) expect(parsed.model).toEqual(original.model);
    if (original?.prompt) expect(parsed.prompt).toBe(original.prompt);
    if (yaml.includes("voice_id"))
      expect(parsed.tts.minimax.voice_id).toBe("narrator");
    if (trailer) expect(serialized.endsWith(trailer)).toBe(true);
    if (yaml.includes("# keep prefix"))
      expect(serialized.startsWith("# keep prefix\n--- # start\n")).toBe(true);
    if (yaml.includes("# keep model note"))
      expect(serialized).toContain("# keep model note");
    if (yaml.includes("\r\n"))
      expect(serialized.replaceAll("\r\n", "")).not.toContain("\n");
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toBe(
      "model:\n  default: untouched\n",
    );
    vi.resetModules();
    const reopened = await runtime();
    expect(reopened.speech.getSpeechConfig("work", reopened.target)).toEqual({
      model: "speech-2.6-turbo",
      region: "cn",
    });
  },
);

// @lat: [[speech-playback-tests#Multiple-document speech write refusal]]
it.each([
  "model:\n  default: first\n---\ntts:\n  provider: openai\n",
  "---\ntts:\n  minimax:\n    model: speech-2.8-hd\n...\n---\nmodel:\n  default: second\n",
  "tts:\n  provider: openai\n...\nmodel:\n  default: second\n",
  "---\n...\n---\n...\n",
])(
  "refuses real multi-document speech writes without altering %s",
  async (yaml) => {
    expect(loadAll(yaml)).toHaveLength(2);
    const path = join(home, "profiles", "work", "config.yaml");
    writeFileSync(path, yaml);
    const { speech, target } = await runtime();
    expect(() =>
      speech.setSpeechConfig("model", "speech-2.6-turbo", "work", target),
    ).toThrow(/YAML|document|mapping/);
    expect(readFileSync(path, "utf8")).toBe(yaml);
  },
);

// @lat: [[speech-playback-tests#Unsupported document header refusal]]
it.each([
  "%YAML 1.2\n---\nmodel:\n  default: work-model\n...\n",
  "--- {tts: {provider: openai}}\n",
])(
  "refuses unsupported valid YAML headers without changing %s",
  async (yaml) => {
    expect(() => load(yaml)).not.toThrow();
    const path = join(home, "profiles", "work", "config.yaml");
    writeFileSync(path, yaml);
    const { speech, target } = await runtime();
    expect(() =>
      speech.setSpeechConfig("model", "speech-2.6-turbo", "work", target),
    ).toThrow(/YAML|document|mapping/);
    expect(readFileSync(path, "utf8")).toBe(yaml);
  },
);
