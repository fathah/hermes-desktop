import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const isRemoteOnlyModeMock = vi.fn(() => false);
let testHome = "";

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

async function loadFiles(): Promise<void> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  handlers.clear();
  const mod = await import("../src/main/files");
  mod.registerFilesHandlers();
}

describe("files sandbox", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-files-home-"));
    root = mkdtempSync(join(tmpdir(), "hermes-files-root-"));
    outside = mkdtempSync(join(tmpdir(), "hermes-files-outside-"));
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "ok.txt"), "hello");
    writeFileSync(join(outside, "secret.txt"), "secret");
    isRemoteOnlyModeMock.mockReturnValue(false);
    await loadFiles();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("requires an explicit workspace root", () => {
    expect(handlers.get("files-list-dir")!({}, "")).toMatchObject({
      success: false,
      error: "Choose a workspace folder first.",
    });
  });

  it("rejects symlink escapes with realpath containment", () => {
    expect(handlers.get("files-set-workspace-root")!({}, root)).toMatchObject({ success: true });
    symlinkSync(outside, join(root, "outside-link"));

    const listed = handlers.get("files-list-dir")!({}, root) as {
      success: boolean;
      data: { entries: Array<{ name: string; error?: string }> };
    };

    expect(listed.success).toBe(true);
    expect(listed.data.entries.find((e) => e.name === "outside-link")?.error).toBe(
      "Outside workspace",
    );
    expect(handlers.get("files-read")!({}, join(root, "outside-link", "secret.txt"))).toMatchObject({
      success: false,
    });
  });

  it("enforces read/write size and text limits", () => {
    expect(handlers.get("files-set-workspace-root")!({}, root)).toMatchObject({ success: true });
    writeFileSync(join(root, "binary.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(join(root, "large.txt"), "x".repeat(1024 * 1024 + 1));

    expect(handlers.get("files-read")!({}, join(root, "binary.bin"))).toMatchObject({
      success: false,
      error: "Binary files are not supported.",
    });
    expect(handlers.get("files-read")!({}, join(root, "large.txt"))).toMatchObject({
      success: false,
      error: "File is too large to open.",
    });
    expect(
      handlers.get("files-write")!({}, join(root, "nested", "too-large.txt"), "x".repeat(1024 * 1024 + 1)),
    ).toMatchObject({ success: false });
  });

  it("rejects remote-only mode in the main process", () => {
    isRemoteOnlyModeMock.mockReturnValue(true);
    expect(handlers.get("files-set-workspace-root")!({}, root)).toMatchObject({
      success: false,
      unsupportedMode: true,
    });
  });
});
