import { vi } from "vitest";

export function createMockKeychain(): {
  execFileSync: ReturnType<typeof vi.fn>;
  install: () => void;
  reset: () => void;
  secrets: Map<string, string>;
} {
  const secrets = new Map<string, string>();

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
    },
    reset: () => {
      secrets.clear();
      execFileSync.mockReset();
      execFileSync.mockImplementation(runKeychainCommand);
    },
    secrets,
  };
}
