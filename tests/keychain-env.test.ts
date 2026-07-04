import { vi, describe, it, expect, beforeEach } from "vitest";

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

const mockIsSecretEncryptionAvailable = vi.fn(() => true);
const mockEncryptSecret = vi.fn((value: string) => `encrypted:${value}`);
const mockCanDecryptSecret = vi.fn((payload: string) =>
  payload.startsWith("encrypted:"),
);
const mockDecryptSecret = vi.fn((payload: string) =>
  payload.replace(/^encrypted:/, ""),
);

vi.mock("../src/main/config/secrets", () => ({
  isSecretEncryptionAvailable: () => mockIsSecretEncryptionAvailable(),
  encryptSecret: (value: string) => mockEncryptSecret(value),
  canDecryptSecret: (payload: string) => mockCanDecryptSecret(payload),
  decryptSecret: (payload: string) => mockDecryptSecret(payload),
}));

import { readEnv, setEnvValue } from "../src/main/config/env-store";

describe("env-store keychain delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockImplementation((path: string) => !!mockFiles[path]);
    mockReadFileSync.mockImplementation(
      (path: string) => mockFiles[path] || "",
    );
    mockWriteFileSync.mockImplementation((path: string, data: string) => {
      mockFiles[path] = data;
    });
    mockIsSecretEncryptionAvailable.mockReturnValue(true);
    mockEncryptSecret.mockImplementation(
      (value: string) => `encrypted:${value}`,
    );
    mockCanDecryptSecret.mockImplementation((payload: string) =>
      payload.startsWith("encrypted:"),
    );
    mockDecryptSecret.mockImplementation((payload: string) =>
      payload.replace(/^encrypted:/, ""),
    );
    for (const key of Object.keys(mockFiles)) {
      delete mockFiles[key];
    }
  });

  it("writes sensitive keys to encrypted desktop storage and placeholders to the .env file", () => {
    // EMAIL_PASSWORD is a sensitive key
    setEnvValue("EMAIL_PASSWORD", "secret_pass", "default");

    expect(
      mockFiles["/mock/home/profiles/default/.env.secrets.json"],
    ).toContain('"EMAIL_PASSWORD": "encrypted:secret_pass"');

    // Verify the file was written with the placeholder
    const envContent = mockFiles["/mock/home/profiles/default/.env"];
    expect(envContent).toContain("EMAIL_PASSWORD=__keychain__");
  });

  it("reads sensitive keys from the keychain when the placeholder __keychain__ is found", () => {
    mockFiles["/mock/home/profiles/default/.env"] =
      "EMAIL_PASSWORD=__keychain__\n";
    mockFiles["/mock/home/profiles/default/.env.secrets.json"] = JSON.stringify(
      {
        version: 1,
        secrets: { EMAIL_PASSWORD: "encrypted:resolved_secret_password" },
      },
    );

    const env = readEnv("default");

    expect(env.EMAIL_PASSWORD).toBe("resolved_secret_password");
  });

  it("fails closed instead of writing sensitive plaintext if the keychain call fails", () => {
    mockIsSecretEncryptionAvailable.mockReturnValue(false);

    expect(() =>
      setEnvValue("EMAIL_PASSWORD", "plain_backup_pass", "default"),
    ).toThrow(/refusing to write plaintext/i);

    const envContent = mockFiles["/mock/home/profiles/default/.env"];
    expect(envContent).toBeUndefined();
  });

  it("does not log secret values when the keychain call fails", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockEncryptSecret.mockImplementation(() => {
      throw new Error("encrypt failed for sk-test-log-secret");
    });

    expect(() =>
      setEnvValue("OPENAI_API_KEY", "sk-test-log-secret", "default"),
    ).toThrow(/refusing to write plaintext/i);

    const loggedText = consoleError.mock.calls
      .flatMap((args) =>
        args.map((arg) => (arg instanceof Error ? arg.message : String(arg))),
      )
      .join("\n");
    expect(loggedText).not.toContain("sk-test-log-secret");
    consoleError.mockRestore();
  });

  it("stores provider API keys in the keychain, not plaintext .env", () => {
    setEnvValue("OPENAI_API_KEY", "sk-test-secret", "default");

    expect(
      mockFiles["/mock/home/profiles/default/.env.secrets.json"],
    ).toContain('"OPENAI_API_KEY": "encrypted:sk-test-secret"');
    expect(mockFiles["/mock/home/profiles/default/.env"]).toContain(
      "OPENAI_API_KEY=__keychain__",
    );
  });

  it("clears sensitive keys without leaving a keychain placeholder", () => {
    setEnvValue("OPENROUTER_API_KEY", "sk-or-test-secret", "default");
    setEnvValue("OPENROUTER_API_KEY", "", "default");

    const envContent = mockFiles["/mock/home/profiles/default/.env"];
    expect(envContent).toContain("OPENROUTER_API_KEY=");
    expect(envContent).not.toContain("OPENROUTER_API_KEY=__keychain__");
    expect(envContent).not.toContain("sk-or-test-secret");
    expect(
      mockFiles["/mock/home/profiles/default/.env.secrets.json"],
    ).not.toContain("sk-or-test-secret");
  });
});
