import { describe, expect, it, vi } from "vitest";
import {
  dispatchBridgeFunction,
  isAuthorizedBridgeRequest,
  type BridgeHandlers,
} from "../obsidian-bridge/src/server";

function handlers(): BridgeHandlers {
  return {
    status: vi.fn().mockResolvedValue({ ok: true }),
    activeNote: vi.fn().mockResolvedValue({ path: "daily.md" }),
    openNote: vi.fn().mockResolvedValue({ opened: true }),
    insertAtCursor: vi.fn().mockResolvedValue({ inserted: true }),
    replaceSelection: vi.fn().mockResolvedValue({ replaced: true }),
    runCommand: vi.fn().mockResolvedValue({ command: "editor:save-file" }),
    writeNote: vi.fn().mockResolvedValue({ path: "daily.md" }),
  };
}

describe("Obsidian bridge request handling", () => {
  it("requires the exact bridge token", () => {
    expect(
      isAuthorizedBridgeRequest(
        new Headers({ "X-Hermes-Obsidian-Token": "secret" }),
        "secret",
      ),
    ).toBe(true);
    expect(
      isAuthorizedBridgeRequest(
        new Headers({ "X-Hermes-Obsidian-Token": "wrong" }),
        "secret",
      ),
    ).toBe(false);
    expect(isAuthorizedBridgeRequest(new Headers(), "secret")).toBe(false);
  });

  it("dispatches supported bridge functions", async () => {
    const bridgeHandlers = handlers();

    await expect(
      dispatchBridgeFunction("open-note", { path: "daily.md" }, bridgeHandlers),
    ).resolves.toEqual({ opened: true });

    expect(bridgeHandlers.openNote).toHaveBeenCalledWith({ path: "daily.md" });
  });

  it("rejects unknown bridge functions", async () => {
    await expect(
      dispatchBridgeFunction("delete-vault", {}, handlers()),
    ).rejects.toThrow("Unsupported Obsidian bridge function");
  });
});
