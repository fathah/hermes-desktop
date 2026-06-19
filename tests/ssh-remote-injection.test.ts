import { execFileSync } from "child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import {
  buildRemoteHermesCmd,
  sshSetConfigValue,
} from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

/**
 * INJECTION / INERTNESS suite (Greptile family 6: data-not-code).
 *
 * The existing ssh-remote.test.ts proves command STRUCTURE (quoting shape) and
 * NUL-arg round-trip. This suite proves SAFETY: a hostile arg that crosses into
 * the `sh -c` string built by buildRemoteHermesCmd is treated as INERT DATA —
 * it never executes. We do that the only honest way: actually RUN the generated
 * command through a real shell with a fake `hermes` shim, then assert
 *   (1) the canary side-effect the injection WOULD cause did NOT happen, and
 *   (2) the hostile string arrived at the shim verbatim as a single argument.
 *
 * If shellQuote were ever weakened, (1) would fail (the canary file appears) —
 * a far stronger signal than a structural string assertion.
 */

const sshConfig: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

let workdir: string;
let canaryPath: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "hermes-ssh-inj-"));
  canaryPath = join(workdir, "CANARY_SHOULD_NOT_EXIST");
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/**
 * Run a buildRemoteHermesCmd-generated command through a real shell, with a
 * fake `hermes` installed at $HOME/.local/bin/hermes — a path the command
 * probes BY ABSOLUTE PATH (so the shim is hit deterministically regardless of
 * login-shell PATH behavior; see the PR-6 CLI-resolution fix). The shim prints
 * each received arg NUL-delimited so we can verify the hostile string arrived
 * verbatim as ONE argument.
 */
function runWithShim(command: string): { argv: string[]; stdout: string } {
  const home = mkdtempSync(join(tmpdir(), "hermes-ssh-inj-home-"));
  const localBin = join(home, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const hermes = join(localBin, "hermes");
  writeFileSync(
    hermes,
    ["#!/usr/bin/env bash", 'printf "%s\\0" "$@"', ""].join("\n"),
  );
  chmodSync(hermes, 0o755);
  const out = execFileSync("bash", ["-lc", command], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${localBin}:${process.env.PATH || ""}`,
    },
  });
  const parts = out.toString("utf8").split("\0");
  if (parts.at(-1) === "") parts.pop();
  return { argv: parts, stdout: out.toString("utf8") };
}

describe("buildRemoteHermesCmd — injection canaries are inert data, not code", () => {
  // Each entry: a hostile arg whose payload, if NOT properly quoted, would
  // create the canary file. We embed the actual canary path in the payload.
  const hostileArgs = (canary: string): Array<[string, string]> => [
    ["command substitution $(...)", `x$(touch ${canary})`],
    ["backtick substitution", `x\`touch ${canary}\``],
    ["semicolon command chain", `x; touch ${canary}`],
    ["AND command chain", `x && touch ${canary}`],
    ["pipe to shell", `x | touch ${canary}`],
    ["newline-injected command", `x\ntouch ${canary}`],
    ["redirect overwrite", `x > ${canary}`],
    ["single-quote breakout then cmd", `x'; touch ${canary}; echo '`],
    ["IFS / variable expansion", `x\${IFS}touch\${IFS}${canary}`],
    ["subshell", `x(touch ${canary})`],
  ];

  it.each(hostileArgs("__CANARY__"))(
    "neutralizes %s (no side-effect, arg arrives verbatim)",
    (_name, template) => {
      const hostile = template.replace(/__CANARY__/g, canaryPath);
      const command = buildRemoteHermesCmd(["kanban", "create", hostile]);
      const { argv } = runWithShim(command);

      // (1) The injection MUST NOT have executed.
      expect(existsSync(canaryPath)).toBe(false);
      // (2) The hostile string arrived as a single inert argument, verbatim.
      expect(argv).toEqual(["kanban", "create", hostile]);
    },
  );

  it("treats a hostile value passed via the extraShell redirect path safely", () => {
    // doctor path uses extraShell " 2>&1"; the ARGS still must be inert.
    const hostile = `x; touch ${canaryPath}`;
    const command = buildRemoteHermesCmd([hostile], " 2>&1");
    runWithShim(command);
    expect(existsSync(canaryPath)).toBe(false);
  });

  it("a key-name-like hostile arg ($PATH, --flag, ../traversal) stays one arg", () => {
    const args = ["kanban", "create", "$PATH", "--triage", "../../etc/passwd"];
    const command = buildRemoteHermesCmd(args);
    const { argv } = runWithShim(command);
    // $PATH must NOT expand; ../traversal must NOT be resolved — both inert.
    expect(argv).toEqual(args);
  });
});

describe("sshSetConfigValue — YAML-scalar breakout is rejected before any write", () => {
  // The value is interpolated as "${value}" into a YAML file. Anything that
  // could break out of the double-quoted scalar (", \, CR, LF) must be rejected
  // BEFORE a remote write is attempted — proven by the throw, with no SSH call.
  it.each([
    ["double-quote breakout", 'safe"\ninjected: true'],
    ["backslash escape", "safe\\value"],
    ["newline (new YAML key)", "safe\ninjected: pwned"],
    ["carriage return", "safe\rinjected: pwned"],
  ])("rejects %s", async (_name, value) => {
    await expect(
      sshSetConfigValue(sshConfig, "model.base_url", value),
    ).rejects.toThrow("Config value contains illegal characters");
  });

  it("a benign value is NOT rejected by the char guard (no false positive)", async () => {
    // A normal URL has none of ", \, CR, LF — the guard must let it through.
    // With no real SSH host, sshReadFile yields empty and sshSetConfigValue
    // early-returns (resolves) — the point is it does NOT throw the char-guard
    // error on a legitimate value.
    await expect(
      sshSetConfigValue(
        sshConfig,
        "model.base_url",
        "https://api.example.test/v1",
      ),
    ).resolves.toBeUndefined();
  });
});
