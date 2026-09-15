// @vitest-environment node
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { buildSshRemoteCommand } from "../src/main/ssh-command";

const posix = process.platform === "win32" ? it.skip : it;
const shells =
  process.env.HERMES_TEST_FISH === "1" ? ["/bin/sh", "fish"] : ["/bin/sh"];
describe.each(shells)("SSH login-shell command boundary via %s", (shell) => {
  // @lat: [[main-process#SSH login shell#Explicit POSIX interpreter]]
  it("selects a POSIX interpreter without consuming stdin", () => {
    expect(buildSshRemoteCommand("cat")).toBe("exec /bin/sh -c 'cat'");
  });
  // @lat: [[main-process#SSH login shell#Command byte preservation]]
  posix.each([
    "plain",
    "a'b",
    'a"b',
    "\\",
    "\\\\",
    "\\'",
    "$HOME $(false) `false`",
    "line one\nline two",
    "中文 / path with spaces",
  ])("preserves literal argument %j across shell layers", (value) => {
    const inner = `printf '%s' '${value.replace(/'/g, "'\\''")}'`;
    const result = spawnSync(shell, ["-c", buildSshRemoteCommand(inner)], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(value);
  });
  // @lat: [[main-process#SSH login shell#Input and failure preservation]]
  posix("keeps stdin, stderr and the command exit status", () => {
    const input = "input ' \\\\ $HOME\n中文\n";
    const result = spawnSync(
      shell,
      ["-c", buildSshRemoteCommand("cat; printf 'failed' >&2; exit 7")],
      { input, encoding: "utf8" },
    );
    expect(result.stdout).toBe(input);
    expect(result.stderr).toBe("failed");
    expect(result.status).toBe(7);
  });
});
