import { vi, describe, it, expect, beforeEach } from "vitest";

const mockExecFileSync = vi.fn();
vi.mock("child_process", () => {
  const fns = {
    execFileSync: (file: string, args?: string[], options?: unknown) =>
      mockExecFileSync(file, args, options),
  };
  return { ...fns, default: fns };
});

const mockFiles: Record<string, string> = {};
const mockExistsSync = vi.fn((path: string) => !!mockFiles[path]);
const mockReadFileSync = vi.fn((path: string) => mockFiles[path] || "");
const mockWriteFileSync = vi.fn((path: string, data: string) => {
  mockFiles[path] = data;
});

vi.mock("fs", () => {
  const fns = {
    existsSync: (path: string) => mockExistsSync(path),
    readFileSync: (path: string, _encoding?: string) => mockReadFileSync(path),
    writeFileSync: (path: string, data: string, _encoding?: string) =>
      mockWriteFileSync(path, data),
  };
  return { ...fns, default: fns };
});

vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: string) =>
    `/mock/home/profiles/${profile || "default"}`,
  profilePaths: (profile?: string) => ({
    home: `/mock/home/profiles/${profile || "default"}`,
    envFile: `/mock/home/profiles/${profile || "default"}/.env`,
    configFile: `/mock/home/profiles/${profile || "default"}/config.yaml`,
  }),
  safeWriteFile: (path: string, data: string) => mockWriteFileSync(path, data),
  escapeRegex: (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/mock/home",
  HERMES_PYTHON: "python",
  HERMES_REPO: "/mock/repo",
  hermesCliArgs: (args: string[]) => args,
  getEnhancedPath: () => "",
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../src/main/config/cache", () => ({
  getCached: () => null,
  setCache: () => {},
  invalidateCache: () => {},
}));

import { readEnv, setEnvValue } from "../src/main/config/env-store";

describe("env-store keychain delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockFiles)) {
      delete mockFiles[key];
    }
  });

  it("writes sensitive keys to the keychain and placeholders to the .env file", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("✓"));

    // EMAIL_PASSWORD is a sensitive key
    setEnvValue("EMAIL_PASSWORD", "secret_pass", "default");

    // Verify execFileSync was called with set-secret
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "python",
      ["config", "set-secret", "default", "EMAIL_PASSWORD", "secret_pass"],
      expect.any(Object),
    );

    // Verify the file was written with the placeholder
    const envContent = mockFiles["/mock/home/profiles/default/.env"];
    expect(envContent).toContain("EMAIL_PASSWORD=__keychain__");
  });

  it("reads sensitive keys from the keychain when the placeholder __keychain__ is found", () => {
    mockFiles["/mock/home/profiles/default/.env"] =
      "EMAIL_PASSWORD=__keychain__\n";
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue(Buffer.from("resolved_secret_password\n"));

    const env = readEnv("default");

    // Verify execFileSync was called with get-secret
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "python",
      ["config", "get-secret", "default", "EMAIL_PASSWORD"],
      expect.any(Object),
    );

    expect(env.EMAIL_PASSWORD).toBe("resolved_secret_password");
  });

  it("fails closed instead of writing sensitive plaintext if the keychain call fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("Keychain unavailable");
    });

    expect(() =>
      setEnvValue("EMAIL_PASSWORD", "plain_backup_pass", "default"),
    ).toThrow(/refusing to write plaintext/i);

    const envContent = mockFiles["/mock/home/profiles/default/.env"];
    expect(envContent).toBeUndefined();
  });

  it("stores provider API keys in the keychain, not plaintext .env", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("✓"));

    setEnvValue("OPENAI_API_KEY", "sk-test-secret", "default");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "python",
      ["config", "set-secret", "default", "OPENAI_API_KEY", "sk-test-secret"],
      expect.any(Object),
    );
    expect(mockFiles["/mock/home/profiles/default/.env"]).toContain(
      "OPENAI_API_KEY=__keychain__",
    );
  });
});
