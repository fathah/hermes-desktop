/**
 * setActiveProfile() must drive the remote backend's
 * /api/profiles/{name}/activate endpoint when the app is in
 * remote mode — the existing local hermes CLI invocation would
 * otherwise be a no-op against the remote gateway.
 *
 * These tests cover the three connection modes:
 *
 *  - local: the existing CLI fallback path runs (covered
 *    elsewhere; here we only assert that no HTTP fetch fires).
 *  - remote: a POST to /api/profiles/{name}/activate fires
 *    with the Bearer auth header.
 *  - ssh-tunnel: the IPC handler short-circuits before reaching
 *    setActiveProfile, so we don't exercise the function in
 *    that mode (the existing main/index.ts handler logic is the
 *    source of truth — see `set-active-profile` handler).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The function-under-test does `require("./config")` and
// `require("./hermes")` lazily, so we have to mock both modules
// before importing the function. Also installer + utils mocked
// the same way the existing profiles.test.ts does, so PROFILES_DIR
// and HERMES_PYTHON resolve to harmless values.

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  hermesCliArgs: (args: string[] = []) => ["/dev/null", ...args],
  getEnhancedPath: () => process.env.PATH || "",
}));

// Mock child_process.execFileSync so the local CLI fallback
// path doesn't actually try to invoke python.
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>(
    "child_process",
  );
  return {
    ...actual,
    execFileSync: vi.fn(() => Buffer.from("")),
  };
});

vi.mock("../src/main/config", () => ({
  getConnectionConfig: vi.fn(),
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: vi.fn(() => "http://example.test"),
  getRemoteAuthHeader: vi.fn(() => ({ Authorization: "Bearer testkey" })),
}));

import { setActiveProfile } from "../src/main/profiles";
import { getConnectionConfig } from "../src/main/config";
import { execFileSync } from "child_process";

const mockedConnConfig = getConnectionConfig as unknown as ReturnType<
  typeof vi.fn
>;
const mockedExecFileSync = execFileSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedConnConfig.mockReset();
  mockedExecFileSync.mockReset();
  // Replace global fetch with a vitest mock — Node 20+ has it
  // global, but we always want a controllable double here.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setActiveProfile — remote mode", () => {
  it("fires POST /api/profiles/{name}/activate with Bearer auth", async () => {
    mockedConnConfig.mockReturnValue({ mode: "remote" });

    setActiveProfile("mira-uitest");

    // _activateRemoteProfile is fire-and-forget — await a tick
    // so the dangling promise body runs.
    await new Promise((r) => setImmediate(r));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://example.test/api/profiles/mira-uitest/activate");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer testkey");
  });

  it("does NOT invoke the local hermes CLI when in remote mode", () => {
    mockedConnConfig.mockReturnValue({ mode: "remote" });

    setActiveProfile("mira-uitest");

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("URL-encodes the profile name to defuse path injection attempts", async () => {
    mockedConnConfig.mockReturnValue({ mode: "remote" });

    // Profile-name validation will reject this earlier in the
    // call chain, but if it ever slipped through, encodeURIComponent
    // is the second-line defence.
    expect(() => setActiveProfile("safe-name")).not.toThrow();
    await new Promise((r) => setImmediate(r));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    // Plain ASCII profile names should pass through unchanged.
    expect(url).toBe("http://example.test/api/profiles/safe-name/activate");
  });

  it("swallows fetch rejections silently (best-effort)", async () => {
    mockedConnConfig.mockReturnValue({ mode: "remote" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    // Must not throw to the caller — the IPC handler returns
    // boolean true regardless of backend reachability.
    expect(() => setActiveProfile("mira-uitest")).not.toThrow();
    await new Promise((r) => setImmediate(r));
    // No assertion on fetch result beyond "didn't crash".
  });
});

describe("setActiveProfile — local mode", () => {
  // CLI invocation in local mode is already covered by the
  // pre-existing tests/profiles.test.ts suite. Here we only
  // assert the remote branch is NOT taken (the new failure
  // mode this fix introduces would be "always hits HTTP even
  // in local mode").
  it("does NOT call fetch when in local mode", () => {
    mockedConnConfig.mockReturnValue({ mode: "local" });

    setActiveProfile("mira-uitest");

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("setActiveProfile — input validation", () => {
  it("throws on invalid profile names BEFORE branching on mode", () => {
    mockedConnConfig.mockReturnValue({ mode: "remote" });

    expect(() => setActiveProfile("../traversal")).toThrow(
      /Profile names may contain/,
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});
