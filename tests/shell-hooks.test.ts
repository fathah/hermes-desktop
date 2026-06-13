import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-shell-hooks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/security/shell-hooks")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/security/shell-hooks");
}

describe("ShellHookManager", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_ACCEPT_HOOKS;
    vi.resetModules();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("gating blocks un-allowlisted hooks", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      `
hooks:
  - event: pre_llm_call
    command: node some-script.js
`,
    );

    const { ShellHookManager } = await freshConfig(TEST_DIR);

    const res = await ShellHookManager.runHook("pre_llm_call", {}, "default");
    expect(res.action).toBe("block");
    expect(res.message).toContain("not in the allowlist");
  });

  it("gating allows allowlisted hooks and runs them", async () => {
    const hookScriptPath = join(TEST_DIR, "hook.js");
    writeFileSync(
      hookScriptPath,
      `
      console.log(JSON.stringify({ action: "block", reason: "Blocked via hook output" }));
      `,
    );

    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      `
hooks:
  - event: pre_llm_call
    command: node ${hookScriptPath}
`,
    );

    const { ShellHookManager } = await freshConfig(TEST_DIR);

    // Auto-accept enabled
    process.env.HERMES_ACCEPT_HOOKS = "true";

    const res = await ShellHookManager.runHook("pre_llm_call", {}, "default");
    expect(res.action).toBe("block");
    expect(res.message).toBe("Blocked via hook output");
  });

  it("gates tool matcher if defined", async () => {
    const hookScriptPath = join(TEST_DIR, "hook.js");
    writeFileSync(
      hookScriptPath,
      `
      console.log(JSON.stringify({ context: "matched context" }));
      `,
    );

    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      `
hooks:
  - event: pre_tool_call
    matcher: terminal
    command: node ${hookScriptPath}
`,
    );

    const { ShellHookManager } = await freshConfig(TEST_DIR);
    process.env.HERMES_ACCEPT_HOOKS = "true";

    // Matching tool: terminal
    const res1 = await ShellHookManager.runHook(
      "pre_tool_call",
      { tool_name: "terminal" },
      "default",
    );
    expect(res1.action).toBe("allow");
    expect(res1.context).toBe("matched context");

    // Non-matching tool: file
    const res2 = await ShellHookManager.runHook(
      "pre_tool_call",
      { tool_name: "file" },
      "default",
    );
    expect(res2.action).toBe("allow");
    expect(res2.context).toBeUndefined();
  });
});
