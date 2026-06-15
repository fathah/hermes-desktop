import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { runConfigHealthCheck as runConfigHealthCheckType } from "./config-health";
import type { resolvedSecretMap as resolvedSecretMapType } from "./secrets";

const mocks = vi.hoisted(() => ({
  readEnv: vi.fn(),
  getConfigValue: vi.fn(),
  getModelConfig: vi.fn(),
  getConnectionConfig: vi.fn(() => ({ mode: "local", remoteUrl: "", apiKey: "" })),
  customEndpointKeyResolvable: vi.fn(() => false),
  hasOAuthCredentials: vi.fn(() => false),
  setEnvValue: vi.fn(),
  setConfigValue: vi.fn(),
  appendConfigFixLog: vi.fn(),
  upsertBlockChild: vi.fn(),
  maskKey: vi.fn((v: string) => v.slice(0, 4) + "***"),
  fakeVault: {} as Record<string, string>,
  fakeEnv: {} as Record<string, string>,
}));

vi.mock("./config", () => ({
  readEnv: mocks.readEnv,
  getConfigValue: mocks.getConfigValue,
  getModelConfig: mocks.getModelConfig,
  getConnectionConfig: mocks.getConnectionConfig,
  customEndpointKeyResolvable: mocks.customEndpointKeyResolvable,
  hasOAuthCredentials: mocks.hasOAuthCredentials,
  setEnvValue: mocks.setEnvValue,
  setConfigValue: mocks.setConfigValue,
  appendConfigFixLog: mocks.appendConfigFixLog,
  upsertBlockChild: mocks.upsertBlockChild,
  maskKey: mocks.maskKey,
}));

vi.mock("./utils", async () => {
  const actual = await vi.importActual<typeof import("./utils")>("./utils");
  return {
    ...actual,
    profilePaths: vi.fn((profile?: string) => ({
      home: "/fake/home/.hermes",
      // Use a real checkout file so the config-existence gate stays true
      // even when another test imports config-health before this fs mock is
      // installed in the worker.
      envFile: `${process.cwd()}/package.json`,
      configFile: `${process.cwd()}/package.json`,
      profile: profile || "default",
    })),
  };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(
      (p: string) =>
        // Pretend the config file always exists; the audit gates the
        // EMPTY_API_SERVER_KEY warning on config existence.
        String(p).endsWith("config.yaml") || String(p).endsWith(".env"),
    ),
  };
});

vi.mock("./secrets", async () => {
  const actual = await vi.importActual<typeof import("./secrets")>("./secrets");
  return {
    ...actual,
    // Default provider selection: pretend secrets.provider === "command" so
    // getSecretsProvider() returns a command-shaped provider. Tests that
    // specifically want the env provider can override getConfigValue to
    // return null for "secrets.provider".
    getSecretsProvider: () => ({
      id: "command",
      get: (key: string) => mocks.fakeVault[key] ?? null,
      list: () => ({ ...mocks.fakeVault }),
    }),
    // Mirror the real resolvedSecretMap merge direction exactly: provider is
    // the base, then .env overwrites it, then process.env overwrites both.
    resolvedSecretMap: () => {
      const merged: Record<string, string> = { ...mocks.fakeVault };
      for (const [k, v] of Object.entries(mocks.fakeEnv)) {
        if (v != null && v !== "") merged[k] = v;
      }
      for (const [k, v] of Object.entries(process.env)) {
        if (v != null && v !== "") merged[k] = v;
      }
      return merged;
    },
  };
});

const mockedReadEnv = mocks.readEnv;
const mockedGetConfigValue = mocks.getConfigValue;
const mockedGetModelConfig = mocks.getModelConfig;
const mockedGetConnectionConfig = mocks.getConnectionConfig;
const mockedCustomEndpointKeyResolvable = mocks.customEndpointKeyResolvable;
const mockedHasOAuthCredentials = mocks.hasOAuthCredentials;

describe("config-health audit - vault awareness", () => {
  let runConfigHealthCheck: typeof runConfigHealthCheckType;
  let resolvedSecretMap: typeof resolvedSecretMapType;

  const envKeys = [
    "API_SERVER_KEY",
    "NANO_GPT_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_TOKEN",
    "CUSTOM_API_KEY",
    "OPENAI_API_KEY",
  ];

  beforeEach(async () => {
    vi.resetModules();
    for (const k of envKeys) {
      delete process.env[k];
    }
    mocks.fakeVault = {};
    mocks.fakeEnv = {};
    mockedReadEnv.mockReset();
    mockedGetConfigValue.mockReset();
    mockedGetModelConfig.mockReset();
    mockedGetConnectionConfig.mockReset();
    mockedCustomEndpointKeyResolvable.mockReset();
    mockedHasOAuthCredentials.mockReset();

    // Defaults: empty .env, empty config.yaml. We pick provider: "anthropic"
    // with no baseUrl so expectedEnvKeyForModel() returns ANTHROPIC_API_KEY.
    mockedReadEnv.mockReturnValue({});
    mockedGetConfigValue.mockReturnValue(null);
    mockedGetModelConfig.mockReturnValue({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
      baseUrl: "",
    });
    mockedCustomEndpointKeyResolvable.mockReturnValue(false);
    mockedHasOAuthCredentials.mockReturnValue(false);

    ({ runConfigHealthCheck } = await import("./config-health"));
    ({ resolvedSecretMap } = await import("./secrets"));

    // Default: local connection mode (the desktop owns the keys).
    mockedGetConnectionConfig.mockReturnValue({
      mode: "local",
      remoteUrl: "",
      apiKey: "",
    } as ReturnType<typeof getConnectionConfig>);
  });

  afterEach(() => {
    // Don't leak process.env from one test to the next.
    for (const k of envKeys) {
      delete process.env[k];
    }
  });

  describe("env provider (default) - byte-for-byte unchanged", () => {
    it("still fires EMPTY_API_SERVER_KEY when neither .env nor vault has the key", () => {
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).toContain("EMPTY_API_SERVER_KEY");
    });

    it("still fires MODEL_KEY_MISSING when the active model's key is absent everywhere", () => {
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).toContain("MODEL_KEY_MISSING");
    });

    it("does NOT fire EMPTY_API_SERVER_KEY when the .env file has the key", () => {
      mockedReadEnv.mockReturnValue({ API_SERVER_KEY: "from-dotenv" });
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("EMPTY_API_SERVER_KEY");
    });

    it("does NOT fire MODEL_KEY_MISSING when the .env file has the key", () => {
      mockedReadEnv.mockReturnValue({ ANTHROPIC_API_KEY: "from-dotenv" });
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("MODEL_KEY_MISSING");
    });

    it("does NOT fire MODEL_KEY_MISSING when the vault has ANTHROPIC_TOKEN (alias of ANTHROPIC_API_KEY)", () => {
      mocks.fakeEnv = {};
      mocks.fakeVault = { ANTHROPIC_TOKEN: "from-vault" };
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("MODEL_KEY_MISSING");
    });
  });

  describe("command provider - vault-only user", () => {
    it("does NOT fire EMPTY_API_SERVER_KEY when the vault has the key", () => {
      mocks.fakeVault = { API_SERVER_KEY: "from-vault" };
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("EMPTY_API_SERVER_KEY");
    });

    it("does NOT fire MODEL_KEY_MISSING when the vault has the active model's key", () => {
      mocks.fakeVault = { ANTHROPIC_API_KEY: "from-vault" };
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("MODEL_KEY_MISSING");
    });

    it("does NOT fire MODEL_KEY_MISSING when the vault has ANTHROPIC_TOKEN (alias of ANTHROPIC_API_KEY)", () => {
      // REGRESSION: the recurring real-world case. mumbo's vault injects the
      // anthropic credential under ANTHROPIC_TOKEN (the gateway/Bearer name),
      // NOT ANTHROPIC_API_KEY (the .env/url-key-map name). Both authenticate
      // against Anthropic, so the gate must treat them as equivalent. Before
      // the alias-aware lookup, a vault-only user with ANTHROPIC_TOKEN saw a
      // false "ANTHROPIC_API_KEY is not set" warning on every chat start even
      // though the gateway authenticated fine.
      FAKE_VAULT = { ANTHROPIC_TOKEN: "sk-ant-from-vault" };
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("MODEL_KEY_MISSING");
    });

    it("does NOT fire MODEL_KEY_MISSING for a custom endpoint when the vault has OPENAI_API_KEY", () => {
      mockedGetModelConfig.mockReturnValue({
        provider: "custom",
        model: "any-model",
        baseUrl: "https://api.openai.com/v1",
      });
      mockedReadEnv.mockReturnValue({});
      mocks.fakeVault = { OPENAI_API_KEY: "from-vault" };
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("MODEL_KEY_MISSING");
    });
  });

  describe("process.env (vault-style env injection) - works the same way", () => {
    it("does NOT fire EMPTY_API_SERVER_KEY when process.env has the key", () => {
      process.env.API_SERVER_KEY = "from-process-env";
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("EMPTY_API_SERVER_KEY");
    });

    it("does NOT fire MODEL_KEY_MISSING when process.env has the key", () => {
      process.env.ANTHROPIC_API_KEY = "from-process-env";
      const report = runConfigHealthCheck("default");
      const codes = report.issues.map((i) => i.code);
      expect(codes).not.toContain("MODEL_KEY_MISSING");
    });
  });

  describe("rotation + deletion - reflected on next audit", () => {
    it("EMPTY_API_SERVER_KEY fires when the only source is removed", () => {
      mockedReadEnv.mockReturnValue({ API_SERVER_KEY: "from-dotenv" });
      let report = runConfigHealthCheck("default");
      expect(report.issues.map((i) => i.code)).not.toContain(
        "EMPTY_API_SERVER_KEY",
      );

      mockedReadEnv.mockReturnValue({});
      report = runConfigHealthCheck("default");
      expect(report.issues.map((i) => i.code)).toContain(
        "EMPTY_API_SERVER_KEY",
      );
    });

    it("MODEL_KEY_MISSING recovers when a vault key is added", () => {
      let report = runConfigHealthCheck("default");
      expect(report.issues.map((i) => i.code)).toContain("MODEL_KEY_MISSING");

      mocks.fakeVault = { ANTHROPIC_API_KEY: "rotated-value" };
      report = runConfigHealthCheck("default");
      expect(report.issues.map((i) => i.code)).not.toContain(
        "MODEL_KEY_MISSING",
      );

      mocks.fakeVault = { ANTHROPIC_API_KEY: "rotated-again" };
      report = runConfigHealthCheck("default");
      expect(report.issues.map((i) => i.code)).not.toContain(
        "MODEL_KEY_MISSING",
      );

      mocks.fakeVault = {};
      report = runConfigHealthCheck("default");
      expect(report.issues.map((i) => i.code)).toContain("MODEL_KEY_MISSING");
    });

    it("resolves precedence process.env > .env > provider on a key CONFLICT (AIR-008)", () => {
      mocks.fakeVault = { API_SERVER_KEY: "from-vault" };
      mocks.fakeEnv = { API_SERVER_KEY: "from-dotenv" };

      delete process.env.API_SERVER_KEY;
      expect(resolvedSecretMap("default").API_SERVER_KEY).toBe("from-dotenv");

      process.env.API_SERVER_KEY = "from-process-env";
      try {
        expect(resolvedSecretMap("default").API_SERVER_KEY).toBe(
          "from-process-env",
        );
      } finally {
        delete process.env.API_SERVER_KEY;
      }

      mocks.fakeEnv = {};
      expect(resolvedSecretMap("default").API_SERVER_KEY).toBe("from-vault");
    });
  });

  describe("config-health audit — connection-mode awareness", () => {
    beforeEach(() => {
      mocks.fakeVault = {};
      mocks.fakeEnv = {};
      mocks.readEnv.mockReset();
      mocks.getConfigValue.mockReset();
      mocks.getModelConfig.mockReset();
      mocks.getConnectionConfig.mockReset();
      mocks.customEndpointKeyResolvable.mockReset();
      mocks.hasOAuthCredentials.mockReset();

      mocks.readEnv.mockReturnValue({});
      mocks.getConfigValue.mockReturnValue(null);
      mocks.getModelConfig.mockReturnValue({
        provider: "anthropic",
        model: "claude-sonnet-4.6",
        baseUrl: "",
      });
      mocks.customEndpointKeyResolvable.mockReturnValue(false);
      mocks.hasOAuthCredentials.mockReturnValue(false);
    });

    afterEach(() => {
      for (const k of ["API_SERVER_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"]) {
        delete process.env[k];
      }
    });

    const setMode = (overrides: Record<string, string | boolean>) =>
      mocks.getConnectionConfig.mockReturnValue({
        mode: "local",
        remoteUrl: "",
        apiKey: "",
        ...overrides,
      });

    const codes = (profile?: string) =>
      runConfigHealthCheck(profile).issues.map((i) => i.code);

    it("LOCAL mode with no key anywhere fires both key warnings (control)", () => {
      setMode({ mode: "local" });
      const c = codes();
      expect(c).toContain("EMPTY_API_SERVER_KEY");
      expect(c).toContain("MODEL_KEY_MISSING");
    });

    it("REMOTE mode suppresses both local key warnings (the bug fix)", () => {
      setMode({ mode: "remote", remoteUrl: "http://127.0.0.1:8642" });
      const c = codes();
      expect(c).not.toContain("EMPTY_API_SERVER_KEY");
      expect(c).not.toContain("MODEL_KEY_MISSING");
    });

    it("SSH mode suppresses both local key warnings", () => {
      setMode({ mode: "ssh" });
      const c = codes();
      expect(c).not.toContain("EMPTY_API_SERVER_KEY");
      expect(c).not.toContain("MODEL_KEY_MISSING");
    });

    it("REMOTE mode WITHOUT a remoteUrl still warns (misconfigured remote, gray zone)", () => {
      setMode({ mode: "remote", remoteUrl: "" });
      const c = codes();
      expect(c).toContain("EMPTY_API_SERVER_KEY");
      expect(c).toContain("MODEL_KEY_MISSING");
    });

    it("REMOTE mode skips ONLY the key checks, not the whole audit", () => {
      setMode({ mode: "remote", remoteUrl: "http://127.0.0.1:8642" });
      const report = runConfigHealthCheck();
      const c = report.issues.map((i) => i.code);
      expect(c).not.toContain("EMPTY_API_SERVER_KEY");
      expect(c).not.toContain("MODEL_KEY_MISSING");
      expect(report.summary).toBeDefined();
      expect(Array.isArray(report.issues)).toBe(true);
    });

    it("getConnectionConfig throwing falls back to LOCAL audit (fail safe)", () => {
      mocks.getConnectionConfig.mockImplementation(() => {
        throw new Error("desktop.json unreadable");
      });
      const c = codes();
      expect(c).toContain("EMPTY_API_SERVER_KEY");
      expect(c).toContain("MODEL_KEY_MISSING");
    });
  });
});
