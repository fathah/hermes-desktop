import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { mkdirSync, readFileSync, rmSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-obsidian-config-${Date.now()}`),
  };
});

let isEncryptionAvailableMock = true;

const safeStorageMock = {
  isEncryptionAvailable: () => isEncryptionAvailableMock,
  encryptString: (str: string) => Buffer.from(`encrypted:${str}`, "utf-8"),
  decryptString: (buf: Buffer) => {
    const value = buf.toString("utf-8");
    if (!value.startsWith("encrypted:")) throw new Error("decrypt failed");
    return value.replace("encrypted:", "");
  },
};

type ObsidianConfigTestGlobal = typeof globalThis & {
  mockSafeStorage?: typeof safeStorageMock;
};

vi.mock("electron", () => ({
  safeStorage: safeStorageMock,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: (args: string[] = []) => ["/dev/null", ...args],
  getEnhancedPath: () => process.env.PATH || "",
}));

import { getObsidianConfig, setObsidianConfig } from "../src/main/obsidian";

beforeEach(() => {
  isEncryptionAvailableMock = true;
  (globalThis as ObsidianConfigTestGlobal).mockSafeStorage = safeStorageMock;
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  delete (globalThis as ObsidianConfigTestGlobal).mockSafeStorage;
  vi.resetModules();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("Obsidian profile configuration", () => {
  it("returns a disabled config when no vault is configured", async () => {
    await expect(getObsidianConfig()).resolves.toEqual({
      enabled: false,
      vaultPath: "",
      vaultName: "",
      vaultId: "",
      bridgeUrl: "",
      hasBridgeToken: false,
    });
  });

  it("stores bridge tokens encrypted and returns only token presence", async () => {
    const vaultPath = join(TEST_HOME, "vault");
    mkdirSync(vaultPath, { recursive: true });

    await setObsidianConfig({
      vaultPath,
      vaultName: "Notes",
      vaultId: "notes",
      bridgeUrl: "http://127.0.0.1:27124",
      bridgeToken: "secret-token",
    });

    const raw = readFileSync(
      join(TEST_HOME, "desktop", "obsidian.json"),
      "utf-8",
    );
    expect(raw).not.toContain("secret-token");
    expect(raw).toContain(
      Buffer.from("encrypted:secret-token").toString("base64"),
    );
    await expect(getObsidianConfig()).resolves.toEqual({
      enabled: true,
      vaultPath,
      vaultName: "Notes",
      vaultId: "notes",
      bridgeUrl: "http://127.0.0.1:27124",
      hasBridgeToken: true,
    });
  });

  it("stores named profile configuration separately", async () => {
    const defaultVault = join(TEST_HOME, "default-vault");
    const workVault = join(TEST_HOME, "work-vault");
    mkdirSync(defaultVault, { recursive: true });
    mkdirSync(workVault, { recursive: true });

    await setObsidianConfig({ vaultPath: defaultVault, vaultName: "Default" });
    await setObsidianConfig(
      { vaultPath: workVault, vaultName: "Work" },
      "work_1",
    );

    expect((await getObsidianConfig()).vaultPath).toBe(defaultVault);
    expect((await getObsidianConfig("work_1")).vaultPath).toBe(workVault);
  });
});
