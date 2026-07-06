import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { load } from "js-yaml";
import { join } from "path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const DIR = join(tmpdir(), `yaml-validity-${Date.now()}`);
async function load_(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return import("../src/main/config");
}
beforeEach(() => mkdirSync(DIR, { recursive: true }));
afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(DIR, { recursive: true, force: true });
});

function parsed(): Record<string, unknown> {
  return load(readFileSync(join(DIR, "config.yaml"), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("context_length writes stay valid YAML", () => {
  it("fresh set / re-set / clear", async () => {
    const { setModelConfig } = await load_(DIR);
    setModelConfig("qwen", "qwen-max", "", undefined, 65536);
    expect((parsed().model as Record<string, unknown>).context_length).toBe(
      65536,
    );
    setModelConfig("qwen", "qwen-max", "", undefined, 65536);
    expect((parsed().model as Record<string, unknown>).context_length).toBe(
      65536,
    );
    setModelConfig("qwen", "qwen-max", "", undefined, null);
    expect(
      "context_length" in (parsed().model as Record<string, unknown>),
    ).toBe(false);
  });

  it("rich config with comments + sibling blocks", async () => {
    writeFileSync(
      join(DIR, "config.yaml"),
      [
        "model:",
        '  provider: "qwen"',
        '  default: "qwen-max"   # active',
        '  base_url: "https://x"',
        "agent:",
        "  streaming: true",
        "",
      ].join("\n"),
    );
    const { setModelConfig } = await load_(DIR);
    setModelConfig("qwen", "qwen-max", "https://x", undefined, 32768);
    let doc = parsed();
    expect((doc.model as Record<string, unknown>).context_length).toBe(32768);
    expect((doc.agent as Record<string, unknown>).streaming).toBe(true);
    setModelConfig("qwen", "qwen-max", "https://x", undefined, null);
    doc = parsed();
    expect("context_length" in (doc.model as Record<string, unknown>)).toBe(
      false,
    );
    expect((doc.model as Record<string, unknown>).base_url).toBe("https://x");
  });
});
