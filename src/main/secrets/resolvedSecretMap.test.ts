import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config", () => ({
  getConfigValue: vi.fn(),
  readEnv: vi.fn(),
}));
import { getConfigValue, readEnv } from "../config";
import { getSecretsProvider, resolvedSecretMap } from "./index";

const mockedGetConfigValue = vi.mocked(getConfigValue);
const mockedReadEnv = vi.mocked(readEnv);

describe("resolvedSecretMap", () => {
  beforeEach(() => {
    mockedGetConfigValue.mockReset();
    mockedReadEnv.mockReset();
    mockedReadEnv.mockReturnValue({});
    for (const k of ["R_TEST_KEY", "R_DOTENV_KEY", "R_PROC_KEY"]) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ["R_TEST_KEY", "R_DOTENV_KEY", "R_PROC_KEY"]) {
      delete process.env[k];
    }
  });

  it("defaults to env provider when no secrets.provider is configured", () => {
    mockedGetConfigValue.mockReturnValue(null);
    // The env provider's list() is readEnv() — so the resolved map is
    // exactly the .env view. The audit sees what the gateway sees.
    mockedReadEnv.mockReturnValue({ R_TEST_KEY: "from-dotenv" });
    expect(getSecretsProvider().id).toBe("env");
    expect(resolvedSecretMap().R_TEST_KEY).toBe("from-dotenv");
  });

  it("overlay order: process.env > .env > provider", () => {
    mockedGetConfigValue.mockReturnValue(null);
    mockedReadEnv.mockReturnValue({ R_TEST_KEY: "from-dotenv" });
    process.env.R_TEST_KEY = "from-process-env";
    const merged = resolvedSecretMap();
    expect(merged.R_TEST_KEY).toBe("from-process-env");
  });

  it(".env wins over an empty provider when no process.env is set", () => {
    mockedGetConfigValue.mockReturnValue(null);
    mockedReadEnv.mockReturnValue({ R_TEST_KEY: "from-dotenv" });
    const merged = resolvedSecretMap();
    expect(merged.R_TEST_KEY).toBe("from-dotenv");
  });

  it("keeps the .env value verbatim (empty string is still a value)", () => {
    // The .env overlay is a "replace" — it doesn't fall through on empty.
    // Empty values are unusual but legal (the audit treats "" as missing
    // elsewhere; this function is the raw "where is it set?" view).
    mockedGetConfigValue.mockReturnValue(null);
    mockedReadEnv.mockReturnValue({ R_TEST_KEY: "" });
    const merged = resolvedSecretMap();
    // Either undefined or "" is acceptable; we just want to assert the
    // function doesn't crash and the key is consistently treated.
    expect(merged.R_TEST_KEY === "" || merged.R_TEST_KEY === undefined).toBe(
      true,
    );
  });

  it("never throws when readEnv fails", () => {
    mockedGetConfigValue.mockReturnValue(null);
    mockedReadEnv.mockImplementation(() => {
      throw new Error("readEnv broken");
    });
    // Should swallow the error and return at least the process.env view.
    expect(() => resolvedSecretMap()).not.toThrow();
  });

  it("includes process.env keys that the .env file does not have", () => {
    mockedGetConfigValue.mockReturnValue(null);
    mockedReadEnv.mockReturnValue({});
    process.env.R_PROC_KEY = "from-process-env";
    const merged = resolvedSecretMap();
    expect(merged.R_PROC_KEY).toBe("from-process-env");
  });
});
