import { describe, expect, it } from "vitest";
import { buildUnixInstallCommand } from "../src/main/installer";
import { buildScreencaptureArgs } from "../src/main/screencapture";

describe("command builders", () => {
  it("builds screencapture argv without shell interpolation", () => {
    const tempPath = `/tmp/hermes-capture-"; touch /tmp/pwned; ".png`;

    expect(buildScreencaptureArgs(tempPath)).toEqual(["-i", tempPath]);
  });

  it("shell-quotes installer script and shell-profile paths", () => {
    const command = buildUnixInstallCommand({
      shellProfile: "/Users/amar/odd profile's/.zshrc",
      scriptPath: "/Applications/Hermes O'Clock/resources/install.sh",
    });

    expect(command).toBe(
      `source '/Users/amar/odd profile'"'"'s/.zshrc' 2>/dev/null; bash '/Applications/Hermes O'"'"'Clock/resources/install.sh' --skip-setup`,
    );
    expect(command).not.toContain('source "');
  });
});
