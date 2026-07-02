import { describe, expect, it } from "vitest";
import { buildUnixInstallArgs } from "../src/main/installer";
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
});
