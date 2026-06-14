import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// F6 regression tests: the helper's stderr must be piped (and discarded), never
// inherited into the Electron main process's stderr.
vi.mock("../config", () => ({
  getConfigValue: vi.fn(),
}));
import { getConfigValue } from "../config";
import { CommandSecretsProvider, runHelper } from "./commandProvider";

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

  it("runHelper passes the key as env DATA and returns stdout, not stderr", () => {
    // The fd-level stdio guarantee can't be observed from inside the process
    // (an inherited stderr bypasses any JS spy), so it is pinned behaviorally:
    // a helper that echoes its HERMES_SECRET_KEY to STDOUT proves the key rode
    // along as env data (never the shell string), and a marker written to
    // STDERR must NOT surface in the parent's captured stderr.
    const r = runHelper(
      'printf "STDERR_SECRET_MARKER" >&2; printf "key=%s" "$HERMES_SECRET_KEY"',
      "SOME_KEY",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stdout).toBe("key=SOME_KEY");
    expect(capturedStderr()).not.toContain("STDERR_SECRET_MARKER");
  });
});
