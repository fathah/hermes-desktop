import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// F6 regression tests: the helper's stderr must be piped (and discarded), never
// inherited into the Electron main process's stderr.
vi.mock("../config", () => ({
  getConfigValue: vi.fn(),
}));
import { getConfigValue } from "../config";
import { CommandSecretsProvider, helperExecOptions } from "./commandProvider";

const mockedGetConfigValue = vi.mocked(getConfigValue);

describe("CommandSecretsProvider stdio hygiene (F6)", () => {
  if (process.platform === "win32") {
    it("is POSIX-only and is covered by integration tests on non-Windows hosts", () => {
      expect(process.platform).toBe("win32");
    });
    return;
  }

  const provider = new CommandSecretsProvider();
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedGetConfigValue.mockReset();
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  function capturedStderr(): string {
    return [...stderrSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .flat()
      .map(String)
      .join("\n");
  }

  it("get(): helper stderr is discarded while stdout still resolves", () => {
    mockedGetConfigValue.mockReturnValue(
      "printf 'STDERR_SECRET_MARKER' >&2; printf 'OK'",
    );
    expect(provider.get("K")).toBe("OK");
    expect(capturedStderr()).not.toContain("STDERR_SECRET_MARKER");
  });

  it("list(): helper stderr is discarded while the dotenv map still parses", () => {
    mockedGetConfigValue.mockReturnValue(
      "printf 'STDERR_SECRET_MARKER' >&2; printf 'A=1\\nB=2\\n'",
    );
    expect(provider.list()).toEqual({ A: "1", B: "2" });
    expect(capturedStderr()).not.toContain("STDERR_SECRET_MARKER");
  });

  it("pins stdio to ignore/pipe/pipe in the shared spawn options", () => {
    // The fd-level guarantee can't be observed from inside the process (an
    // inherited stderr bypasses any JS spy), so it is pinned at the options
    // layer: dropping the stdio entry reverts to execFileSync's default,
    // which inherits the parent's stderr.
    const options = helperExecOptions("SOME_KEY");
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    // The key still rides along as data via the env, never the shell string.
    expect((options.env as Record<string, string>).HERMES_SECRET_KEY).toBe(
      "SOME_KEY",
    );
  });
});
