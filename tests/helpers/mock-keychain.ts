import { vi } from "vitest";

export function createMockKeychain(): {
  execFileSync: ReturnType<typeof vi.fn>;
  install: () => void;
  reset: () => void;
  secrets: Map<string, string>;
  setEncryptionAvailable: (available: boolean) => void;
} {
  const secrets = new Map<string, string>();
  let encryptionAvailable = true;

  const safeStorageMock = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (secret: string) =>
      Buffer.from(`encrypted:${secret}`, "utf-8"),
    decryptString: (buffer: Buffer) => {
      const value = buffer.toString("utf-8");
      if (!value.startsWith("encrypted:")) {
        throw new Error("Decryption failed");
      }
      return value.slice("encrypted:".length);
    },
  };

  const runKeychainCommand = (_file: string, args?: string[]): Buffer => {
    const commandIndex =
      args?.findIndex((arg) => arg === "set-secret" || arg === "get-secret") ??
      -1;
    const command = commandIndex >= 0 ? args?.[commandIndex] : "";
    const profile =
      commandIndex >= 0 ? (args?.[commandIndex + 1] ?? "default") : "default";
    const key = commandIndex >= 0 ? (args?.[commandIndex + 2] ?? "") : "";
    const mapKey = `${profile}:${key}`;

    if (command === "set-secret") {
      secrets.set(mapKey, args?.[commandIndex + 3] ?? "");
      return Buffer.from("ok");
    }
    if (command === "get-secret") {
      return Buffer.from(`${secrets.get(mapKey) ?? ""}\n`);
    }

    return Buffer.from("ok");
  };

  const execFileSync = vi.fn(runKeychainCommand);

  return {
    execFileSync,
    install: () => {
      vi.doMock("child_process", () => {
        const fns = { execFileSync };
        return { ...fns, default: fns };
      });
      (
        globalThis as typeof globalThis & {
          mockSafeStorage?: typeof safeStorageMock;
        }
      ).mockSafeStorage = safeStorageMock;
    },
    reset: () => {
      secrets.clear();
      encryptionAvailable = true;
      execFileSync.mockReset();
      execFileSync.mockImplementation(runKeychainCommand);
      (
        globalThis as typeof globalThis & {
          mockSafeStorage?: typeof safeStorageMock;
        }
      ).mockSafeStorage = safeStorageMock;
    },
    secrets,
    setEncryptionAvailable: (available: boolean) => {
      encryptionAvailable = available;
    },
  };
}
