import { describe, expect, it } from "vitest";
import {
  buildUnixInstallArgs,
  buildWindowsInstallCommand,
} from "../src/main/installer";
import { buildScreencaptureArgs } from "../src/main/screencapture";

describe("command builders", () => {
  it("builds screencapture argv without shell interpolation", () => {
    const tempPath = `/tmp/hermes-capture-"; touch /tmp/pwned; ".png`;

    expect(buildScreencaptureArgs(tempPath)).toEqual(["-i", tempPath]);
  });

  it("builds installer argv without shell interpolation", () => {
    const scriptPath = "/Applications/Hermes O'Clock/resources/install.sh";

    expect(buildUnixInstallArgs(scriptPath)).toEqual([
      scriptPath,
      "--skip-setup",
    ]);
  });

  it("builds rollback installer argv with commit pinning", () => {
    const scriptPath = "/Applications/Hermes O'Clock/resources/install.sh";
    const sha = "2222222222222222222222222222222222222222";

    expect(buildUnixInstallArgs(scriptPath, { commit: sha })).toEqual([
      scriptPath,
      "--skip-setup",
      "--commit",
      sha,
    ]);
  });

  it("builds Windows rollback installer command with commit pinning", () => {
    const sha = "2222222222222222222222222222222222222222";

    expect(
      buildWindowsInstallCommand(
        "$installer",
        "C:\\Users\\A User\\hermes",
        "C:\\Users\\A User\\hermes\\hermes-agent",
        { commit: sha },
      ),
    ).toBe(
      "& $installer -SkipSetup -HermesHome 'C:\\Users\\A User\\hermes' -InstallDir 'C:\\Users\\A User\\hermes\\hermes-agent' -Commit '2222222222222222222222222222222222222222'",
    );
  });
});
