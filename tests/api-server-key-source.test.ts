import { describe, expect, it } from "vitest";
import {
  CANONICAL_API_KEY_SOURCES,
  appendConfigFixLog,
  maskKey,
  resolveApiServerKeyWithSource,
} from "../src/main/config";

/**
 * Source-aware variant of the precedence resolver. The plain
 * `resolveApiServerKey` test in api-server-key-resolution.test.ts pins
 * the precedence policy; this one pins the source tag, which the
 * migration-on-read and config-health-audit features both depend on.
 */

describe("resolveApiServerKeyWithSource", () => {
  const empty = {
    configTopLevelProfile: null,
    configTopLevelDefault: null,
    envProfile: null,
    envDefault: null,
    apiServerTokenProfile: null,
    apiServerTokenDefault: null,
  };

  it("returns null source when every candidate is empty", () => {
    expect(resolveApiServerKeyWithSource(empty)).toEqual({
      value: "",
      source: null,
    });
  });

  it("tags configTopLevelProfile when only that is set", () => {
    expect(
      resolveApiServerKeyWithSource({
        ...empty,
        configTopLevelProfile: "  sk-cfg-profile  ",
      }),
    ).toEqual({ value: "sk-cfg-profile", source: "configTopLevelProfile" });
  });

  it("tags envProfile when both env profile and api_server.token are set (env wins)", () => {
    expect(
      resolveApiServerKeyWithSource({
        ...empty,
        envProfile: "sk-env-profile",
        apiServerTokenProfile: "sk-token-profile",
      }),
    ).toEqual({ value: "sk-env-profile", source: "envProfile" });
  });

  it("tags apiServerTokenProfile when only that is set", () => {
    expect(
      resolveApiServerKeyWithSource({
        ...empty,
        apiServerTokenProfile: "sk-token-profile",
      }),
    ).toEqual({
      value: "sk-token-profile",
      source: "apiServerTokenProfile",
    });
  });

  it("falls through to apiServerTokenDefault when everything earlier is empty", () => {
    expect(
      resolveApiServerKeyWithSource({
        ...empty,
        apiServerTokenDefault: "sk-token-default",
      }),
    ).toEqual({
      value: "sk-token-default",
      source: "apiServerTokenDefault",
    });
  });

  it("preserves the precedence order from resolveApiServerKey", () => {
    // All six set — should pick configTopLevelProfile (first in order)
    expect(
      resolveApiServerKeyWithSource({
        configTopLevelProfile: "a",
        configTopLevelDefault: "b",
        envProfile: "c",
        envDefault: "d",
        apiServerTokenProfile: "e",
        apiServerTokenDefault: "f",
      }),
    ).toEqual({ value: "a", source: "configTopLevelProfile" });
  });

  it("treats whitespace-only candidates as empty", () => {
    expect(
      resolveApiServerKeyWithSource({
        ...empty,
        configTopLevelProfile: "   ",
        envProfile: "sk-real",
      }),
    ).toEqual({ value: "sk-real", source: "envProfile" });
  });
});

describe("CANONICAL_API_KEY_SOURCES", () => {
  it("contains only the .env-backed sources", () => {
    expect(CANONICAL_API_KEY_SOURCES.has("envProfile")).toBe(true);
    expect(CANONICAL_API_KEY_SOURCES.has("envDefault")).toBe(true);
    expect(CANONICAL_API_KEY_SOURCES.has("configTopLevelProfile")).toBe(false);
    expect(CANONICAL_API_KEY_SOURCES.has("configTopLevelDefault")).toBe(false);
    expect(CANONICAL_API_KEY_SOURCES.has("apiServerTokenProfile")).toBe(false);
    expect(CANONICAL_API_KEY_SOURCES.has("apiServerTokenDefault")).toBe(false);
  });
});

describe("maskKey", () => {
  it("returns empty string for empty input", () => {
    expect(maskKey("")).toBe("");
  });

  it("returns generic mask for very short values", () => {
    expect(maskKey("short")).toBe("***");
    expect(maskKey("sk-12345")).toBe("***");
  });

  it("keeps first 4 + last 4 for longer values", () => {
    expect(maskKey("sk-test-arc-codex-AAAA-BBBB-CCCC")).toBe("sk-t…CCCC");
    expect(maskKey("OPENROUTER123456789")).toBe("OPEN…6789");
  });

  it("does not leak the middle even for medium-length keys", () => {
    const masked = maskKey("sk-1234567890");
    expect(masked).not.toContain("567");
    expect(masked.startsWith("sk-1")).toBe(true);
    expect(masked.endsWith("7890")).toBe(true);
  });
});

describe("appendConfigFixLog", () => {
  it("never throws on bad input (writes are best-effort)", () => {
    expect(() =>
      appendConfigFixLog({
        ts: Date.now(),
        issueCode: "TEST_NOOP",
        action: "migrate",
        from: "configTopLevelProfile",
        to: ".env",
        valueMasked: "sk-t…CCCC",
      }),
    ).not.toThrow();
  });
});
