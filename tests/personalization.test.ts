import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  HOOK_EVENT,
  resolveInsideDir,
  configHasHook,
  upsertHookInConfig,
  removeHookFromConfig,
  buildAllowlistEntry,
  upsertAllowlist,
  allowlistHasEntry,
} from "../src/main/personalization-core";

const SCRIPT = "/Users/x/.hermes/agent-hooks/inject-daily-context.sh";

describe("config hook upsert/remove (real YAML, nested list-of-maps)", () => {
  it("adds the hook to an empty `hooks: {}` block and round-trips removal", () => {
    const before = "hooks: {}\nhooks_auto_accept: false\nother: keep-me\n";
    expect(configHasHook(before, SCRIPT)).toBe(false);

    const enabled = upsertHookInConfig(before, SCRIPT, 10);
    expect(configHasHook(enabled, SCRIPT)).toBe(true);
    // Unrelated keys are preserved.
    const parsed = parse(enabled);
    expect(parsed.hooks_auto_accept).toBe(false);
    expect(parsed.other).toBe("keep-me");
    expect(parsed.hooks[HOOK_EVENT][0].command).toBe(SCRIPT);
    expect(parsed.hooks[HOOK_EVENT][0].timeout).toBe(10);

    const disabled = removeHookFromConfig(enabled, SCRIPT);
    expect(configHasHook(disabled, SCRIPT)).toBe(false);
    expect(parse(disabled).hooks_auto_accept).toBe(false);
  });

  it("creates the hooks block when absent", () => {
    const out = upsertHookInConfig("foo: bar\n", SCRIPT);
    expect(configHasHook(out, SCRIPT)).toBe(true);
    expect(parse(out).foo).toBe("bar");
  });

  it("is idempotent (no duplicate entries)", () => {
    const once = upsertHookInConfig("hooks: {}\n", SCRIPT);
    const twice = upsertHookInConfig(once, SCRIPT);
    expect(parse(twice).hooks[HOOK_EVENT]).toHaveLength(1);
  });

  it("preserves a co-existing hook of a different command on remove", () => {
    const other = "/Users/x/.hermes/agent-hooks/other.sh";
    let cfg = upsertHookInConfig("hooks: {}\n", other);
    cfg = upsertHookInConfig(cfg, SCRIPT);
    const removed = removeHookFromConfig(cfg, SCRIPT);
    expect(configHasHook(removed, SCRIPT)).toBe(false);
    expect(configHasHook(removed, other)).toBe(true);
  });

  it("remove on a config without our hook is a no-op", () => {
    const cfg = "hooks: {}\n";
    expect(() => removeHookFromConfig(cfg, SCRIPT)).not.toThrow();
    expect(configHasHook(removeHookFromConfig(cfg, SCRIPT), SCRIPT)).toBe(
      false,
    );
  });
});

describe("resolveInsideDir path guard (focus.md write confinement)", () => {
  const dir = "/Users/x/.hermes/agent-hooks";
  it("accepts a flat filename inside the dir", () => {
    expect(resolveInsideDir(dir, "focus.md")).toBe(`${dir}/focus.md`);
  });
  it("rejects traversal", () => {
    expect(resolveInsideDir(dir, "../escape")).toBeNull();
    expect(resolveInsideDir(dir, "../../etc/passwd")).toBeNull();
  });
  it("rejects nested sub-paths and absolute paths", () => {
    expect(resolveInsideDir(dir, "sub/focus.md")).toBeNull();
    expect(resolveInsideDir(dir, "/etc/passwd")).toBeNull();
  });
});

describe("allowlist entry shape + dedupe", () => {
  it("builds the exact shape shell_hooks.py reads", () => {
    const entry = buildAllowlistEntry(
      SCRIPT,
      "2026-06-06T00:00:00Z",
      "2026-06-06T00:00:00Z",
    );
    expect(entry).toEqual({
      event: HOOK_EVENT,
      command: SCRIPT,
      approved_at: "2026-06-06T00:00:00Z",
      script_mtime_at_approval: "2026-06-06T00:00:00Z",
    });
  });

  it("upserts and dedupes by (event, command)", () => {
    const e1 = buildAllowlistEntry(SCRIPT, "t1", null);
    const e2 = buildAllowlistEntry(SCRIPT, "t2", null);
    let file = upsertAllowlist(null, e1);
    file = upsertAllowlist(file, e2);
    expect(file.approvals).toHaveLength(1);
    expect(file.approvals[0].approved_at).toBe("t2");
    expect(allowlistHasEntry(file, HOOK_EVENT, SCRIPT)).toBe(true);
    expect(allowlistHasEntry(file, HOOK_EVENT, "/nope")).toBe(false);
  });
});
