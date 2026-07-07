import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock Electron safeStorage module before importing config
let isEncryptionAvailableMock = true;

const safeStorageMock = {
  isEncryptionAvailable: () => isEncryptionAvailableMock,
  encryptString: (str: string) => {
    return Buffer.from("encrypted:" + str, "utf-8");
  },
  decryptString: (buf: Buffer) => {
    const val = buf.toString("utf-8");
    if (!val.startsWith("encrypted:")) {
      throw new Error("Decryption failed");
    }
    return val.replace("encrypted:", "");
  },
};

type SecureStorageTestGlobal = typeof globalThis & {
  mockSafeStorage?: typeof safeStorageMock;
};

vi.mock("electron", () => ({
  safeStorage: safeStorageMock,
}));

describe("config secure secret storage", () => {
  beforeEach(() => {
    isEncryptionAvailableMock = true;
    (globalThis as SecureStorageTestGlobal).mockSafeStorage = safeStorageMock;
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as SecureStorageTestGlobal).mockSafeStorage;
  });

  it("encrypts secrets if safeStorage is available", async () => {
    const { encryptSecret, decryptSecret } = await import("../src/main/config");
    const plaintext = "super-secret-key-123";
    const encrypted = encryptSecret(plaintext);

    // Should be base64-encoded encrypted format
    expect(encrypted).not.toBe(plaintext);
    expect(
      Buffer.from(encrypted, "base64")
        .toString("utf-8")
        .startsWith("encrypted:"),
    ).toBe(true);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("falls back to raw string on decryption failure (legacy plain text keys)", async () => {
    const { decryptSecret } = await import("../src/main/config");
    const legacyPlaintext = "my-old-plaintext-api-key";

    // Decrypting raw plaintext should fail decryption internally but fall back to returning raw string
    const result = decryptSecret(legacyPlaintext);
    expect(result).toBe(legacyPlaintext);
  });

  it("does not encrypt if safeStorage is unavailable", async () => {
    isEncryptionAvailableMock = false;
    const { encryptSecret, decryptSecret } = await import("../src/main/config");

    const plaintext = "some-key";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).toBe(plaintext);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});

describe("desktop.json secret fields", () => {
  let testDir: string;

  async function freshConfig(
    home: string,
  ): Promise<typeof import("../src/main/config")> {
    vi.resetModules();
    process.env.HERMES_HOME = home;
    (globalThis as SecureStorageTestGlobal).mockSafeStorage = safeStorageMock;
    return await import("../src/main/config");
  }

  beforeEach(() => {
    isEncryptionAvailableMock = true;
    testDir = mkdtempSync(join(tmpdir(), "hermes-openalex-secret-"));
  });

  afterEach(() => {
    delete process.env.HERMES_HOME;
    delete (globalThis as SecureStorageTestGlobal).mockSafeStorage;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("encrypts OpenAlex API keys while preserving decrypted reads", async () => {
    const { readDesktopConfig, writeDesktopConfig } =
      await freshConfig(testDir);

    writeDesktopConfig({
      openalexMailto: "research@example.com",
      openalexApiKey: "oa-secret-key",
    });

    const raw = readFileSync(join(testDir, "desktop.json"), "utf-8");
    expect(raw).not.toContain("oa-secret-key");
    expect(
      Buffer.from(JSON.parse(raw).openalexApiKey, "base64").toString("utf-8"),
    ).toBe("encrypted:oa-secret-key");
    expect(readDesktopConfig().openalexApiKey).toBe("oa-secret-key");
  });

  it("migrates legacy plaintext OpenAlex API keys through the encrypted writer", async () => {
    writeFileSync(
      join(testDir, "desktop.json"),
      JSON.stringify(
        {
          openalexMailto: "research@example.com",
          openalexApiKey: "legacy-openalex-key",
        },
        null,
        2,
      ),
    );

    const { migrateDesktopConfigSecrets, readDesktopConfig } =
      await freshConfig(testDir);
    migrateDesktopConfigSecrets();

    const raw = readFileSync(join(testDir, "desktop.json"), "utf-8");
    expect(raw).not.toContain("legacy-openalex-key");
    expect(readDesktopConfig().openalexApiKey).toBe("legacy-openalex-key");
  });

  it("stores SPS automation prefs per profile with normalized intervals", async () => {
    const { getSpsAutomationPrefs, setSpsAutomationPrefs } =
      await freshConfig(testDir);

    expect(getSpsAutomationPrefs("work")).toEqual({
      autoApply: false,
      ingestIntervalMin: 0,
      lintIntervalMin: 0,
    });

    setSpsAutomationPrefs(
      { autoApply: true, ingestIntervalMin: 15.8, lintIntervalMin: -1 },
      "work",
    );

    expect(getSpsAutomationPrefs("work")).toEqual({
      autoApply: true,
      ingestIntervalMin: 15,
      lintIntervalMin: 0,
    });
    expect(getSpsAutomationPrefs("default")).toEqual({
      autoApply: false,
      ingestIntervalMin: 0,
      lintIntervalMin: 0,
    });
  });

  it("stores owner notification prefs per profile with safe defaults", async () => {
    const { getOwnerNotificationPrefs, setOwnerNotificationPrefs } =
      await freshConfig(testDir);

    expect(getOwnerNotificationPrefs("work")).toMatchObject({
      channels: {
        macos: true,
        telegram: false,
        email: false,
        whatsapp: false,
      },
      targets: {
        telegramChatId: "",
        emailAddress: "",
        whatsappTarget: "",
      },
      rateLimitMinutes: 10,
    });

    setOwnerNotificationPrefs(
      {
        channels: { telegram: true, macos: false },
        targets: {
          telegramChatId: " 12345 ",
          emailAddress: " owner@example.com ",
        },
        quietHours: { enabled: true, start: "21:30", end: "06:15" },
        rateLimitMinutes: 2.8,
      },
      "work",
    );

    expect(getOwnerNotificationPrefs("work")).toMatchObject({
      channels: {
        macos: false,
        telegram: true,
        email: false,
        whatsapp: false,
      },
      targets: {
        telegramChatId: "12345",
        emailAddress: "owner@example.com",
      },
      quietHours: { enabled: true, start: "21:30", end: "06:15" },
      rateLimitMinutes: 2,
    });
    expect(getOwnerNotificationPrefs("default").channels.macos).toBe(true);
  });
});
