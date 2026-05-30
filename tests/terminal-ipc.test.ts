import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const isRemoteOnlyModeMock = vi.fn(() => false);
const spawnMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteOnlyMode: () => isRemoteOnlyModeMock(),
}));

vi.mock("node-pty", () => ({
  default: {
    spawn: (...args: unknown[]) => spawnMock(...args),
  },
}));

class FakePty {
  onDataHandler: ((data: string) => void) | null = null;
  onExitHandler: (() => void) | null = null;
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();

  onData(handler: (data: string) => void): void {
    this.onDataHandler = handler;
  }

  onExit(handler: () => void): void {
    this.onExitHandler = handler;
  }

  emitData(data: string): void {
    this.onDataHandler?.(data);
  }

  emitExit(): void {
    this.onExitHandler?.();
  }
}

function sender(id: number): EventEmitter & {
  id: number;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    id: number;
    send: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
  };
  emitter.id = id;
  emitter.send = vi.fn();
  emitter.isDestroyed = () => false;
  return emitter;
}

async function loadTerminal(): Promise<typeof import("../src/main/terminal")> {
  vi.resetModules();
  handlers.clear();
  const mod = await import("../src/main/terminal");
  mod.registerTerminalHandlers();
  return mod;
}

describe("terminal IPC hardening", () => {
  beforeEach(() => {
    isRemoteOnlyModeMock.mockReturnValue(false);
    spawnMock.mockReset();
  });

  it("rejects terminal creation in remote-only mode", async () => {
    await loadTerminal();
    isRemoteOnlyModeMock.mockReturnValue(true);

    const res = handlers.get("terminal-create")!({ sender: sender(1) });

    expect(res).toMatchObject({ success: false, unsupportedMode: true });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("sends terminal output only to the creating webContents", async () => {
    await loadTerminal();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    const owner = sender(1);

    const created = handlers.get("terminal-create")!({ sender: owner }) as { id: string };
    pty.emitData("hello");

    expect(owner.send).toHaveBeenCalledWith("terminal-data", {
      id: created.id,
      data: "hello",
    });
  });

  it("rejects writes from non-owner senders", async () => {
    await loadTerminal();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);

    const created = handlers.get("terminal-create")!({ sender: sender(1) }) as {
      id: string;
    };
    const res = handlers.get("terminal-write")!({ sender: sender(2) }, created.id, "x");

    expect(res).toMatchObject({ success: false });
    expect(pty.write).not.toHaveBeenCalled();
  });

  it("validates write size and resize dimensions", async () => {
    await loadTerminal();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    const owner = sender(1);
    const created = handlers.get("terminal-create")!({ sender: owner }) as { id: string };

    expect(
      handlers.get("terminal-write")!({ sender: owner }, created.id, "x".repeat(70_000)),
    ).toMatchObject({ success: false });
    expect(
      handlers.get("terminal-resize")!({ sender: owner }, created.id, Number.POSITIVE_INFINITY, 24),
    ).toMatchObject({ success: false });
  });

  it("enforces per-window session limits and handles spawn failure", async () => {
    await loadTerminal();
    spawnMock.mockImplementation(() => new FakePty());
    const owner = sender(1);

    expect(handlers.get("terminal-create")!({ sender: owner })).toMatchObject({ success: true });
    expect(handlers.get("terminal-create")!({ sender: owner })).toMatchObject({ success: true });
    expect(handlers.get("terminal-create")!({ sender: owner })).toMatchObject({ success: true });
    expect(handlers.get("terminal-create")!({ sender: owner })).toMatchObject({ success: false });

    await loadTerminal();
    spawnMock.mockImplementation(() => {
      throw new Error("missing shell");
    });
    expect(handlers.get("terminal-create")!({ sender: sender(3) })).toMatchObject({
      success: false,
      error: "missing shell",
    });
  });
});
