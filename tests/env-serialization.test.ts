import { describe, expect, it } from "vitest";
import {
  mergeEnv,
  parseEnvFile,
  serializeEnvLine,
  stripManagedKeys,
} from "../src/main/vault/env";

describe("env serialization", () => {
  it("parses and serializes simple key=value pairs", () => {
    const parsed = parseEnvFile("OPENAI_API_KEY=sk-test\nHERMES_INFERENCE_PROVIDER=openai\n");
    expect(parsed.get("OPENAI_API_KEY")).toBe("sk-test");
    expect(parsed.get("HERMES_INFERENCE_PROVIDER")).toBe("openai");
  });

  it("preserves API_SERVER_KEY through merge", () => {
    const existing = "API_SERVER_KEY=server-key\nHERMES_INFERENCE_PROVIDER=openai\n";
    const managed = new Map([["OPENAI_API_KEY", "sk-new"]]);
    const merged = mergeEnv(existing, managed);
    expect(merged).toContain("API_SERVER_KEY=server-key");
    expect(merged).toContain("HERMES_INFERENCE_PROVIDER=openai");
    expect(merged).toContain("OPENAI_API_KEY=sk-new");
  });

  it("escapes values with special characters", () => {
    const line = serializeEnvLine("TOKEN", 'value with "quotes" and #hash');
    expect(line).toBe('TOKEN="value with \\"quotes\\" and #hash"');
    const parsed = parseEnvFile(`${line}\n`);
    expect(parsed.get("TOKEN")).toBe('value with "quotes" and #hash');
  });

  it("handles multiline JSON-encoded values", () => {
    const value = "line1\nline2";
    const line = serializeEnvLine("MULTI", value);
    const parsed = parseEnvFile(`${line}\n`);
    expect(parsed.get("MULTI")).toBe(value);
  });

  it("strips managed keys without touching unrelated entries", () => {
    const existing = "OPENAI_API_KEY=sk-old\nHERMES_INFERENCE_PROVIDER=openai\n";
    const stripped = stripManagedKeys(existing, ["OPENAI_API_KEY"]);
    expect(stripped).not.toContain("OPENAI_API_KEY");
    expect(stripped).toContain("HERMES_INFERENCE_PROVIDER=openai");
  });

  it("updates existing managed keys in place during merge", () => {
    const existing = "OPENAI_API_KEY=sk-old\n";
    const managed = new Map([["OPENAI_API_KEY", "sk-new"]]);
    const merged = mergeEnv(existing, managed);
    expect(merged).toBe("OPENAI_API_KEY=sk-new\n");
  });
});
