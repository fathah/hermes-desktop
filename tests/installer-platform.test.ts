import { describe, expect, it } from "vitest";
import { delimiter } from "path";
import {
  getEnhancedPath,
  hermesCliArgs,
  HERMES_PYTHON,
  HERMES_SCRIPT,
} from "../src/main/installer";

describe("installer platform wiring", () => {
  it("uses the platform path delimiter in the enhanced PATH", () => {
    const enhancedPath = getEnhancedPath();

    expect(enhancedPath).toContain(process.env.PATH || "");
    expect(enhancedPath.split(delimiter).length).toBeGreaterThan(1);
  });

  it("builds platform-specific Hermes CLI invocation args", () => {
    const args = hermesCliArgs(["--version"]);

    if (process.platform === "win32") {
      expect(args).toEqual(["-m", "hermes_cli.main", "--version"]);
      // Use `pythonw.exe` (Windows-subsystem) instead of `python.exe` so
      // child spawns don't flash a blank console window before
      // `windowsHide`/CREATE_NO_WINDOW takes effect — see issue #342.
      expect(HERMES_PYTHON).toMatch(/venv[\\/]Scripts[\\/]pythonw\.exe$/);
      expect(HERMES_SCRIPT).toMatch(/venv[\\/]Scripts[\\/]hermes\.exe$/);
      return;
    }

    expect(args).toEqual([HERMES_SCRIPT, "--version"]);
    expect(HERMES_PYTHON).toMatch(/venv[\\/]bin[\\/]python$/);
  });
});
