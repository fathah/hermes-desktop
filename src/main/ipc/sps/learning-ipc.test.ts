import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const {
  handlers,
  showOpenDialogMock,
  showSaveDialogMock,
  assertGrantedFilePathMock,
  assertGrantedDirectoryPathMock,
  grantFilePathMock,
  grantDirectoryPathMock,
  previewLocalExpertPackMock,
  importLocalExpertPackMock,
  exportLocalExpertPackMock,
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  assertGrantedFilePathMock: vi.fn(),
  assertGrantedDirectoryPathMock: vi.fn(),
  grantFilePathMock: vi.fn(),
  grantDirectoryPathMock: vi.fn(),
  previewLocalExpertPackMock: vi.fn(),
  importLocalExpertPackMock: vi.fn(),
  exportLocalExpertPackMock: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
  },
}));

vi.mock("../safe-handle", () => ({
  safeHandle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, async (...args: unknown[]) => fn(...args));
  },
}));

vi.mock("../connection-guards", () => ({
  requireLocalWorkspace: vi.fn(),
}));

vi.mock("../../file-access-grants", () => ({
  assertGrantedFilePath: assertGrantedFilePathMock,
  assertGrantedDirectoryPath: assertGrantedDirectoryPathMock,
  grantFilePath: grantFilePathMock,
  grantDirectoryPath: grantDirectoryPathMock,
}));

vi.mock("../../assistant-recipes", () => ({
  createAssistantRecipe: vi.fn(),
  deleteAssistantRecipe: vi.fn(),
  listAssistantRecipeRuns: vi.fn(),
  listAssistantRecipes: vi.fn(),
  runAssistantRecipe: vi.fn(),
  saveAssistantRecipeRun: vi.fn(),
  updateAssistantRecipe: vi.fn(),
}));

vi.mock("../../local-experts", () => ({
  exportLocalExpertPack: exportLocalExpertPackMock,
  getLocalExpertPack: vi.fn(),
  importLocalExpertPack: importLocalExpertPackMock,
  installLocalExpertPack: vi.fn(),
  listLocalExpertPacks: vi.fn(),
  previewLocalExpertPack: previewLocalExpertPackMock,
  uninstallLocalExpertPack: vi.fn(),
}));

vi.mock("../../local-experts/macos-checks", () => ({
  enableLocalExpertChecks: vi.fn(),
  runLocalExpertChecks: vi.fn(),
}));

import { registerSpsLearningIpc } from "./learning";

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`missing handler: ${channel}`);
  return fn;
}

describe("SPS learning IPC path validation", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    assertGrantedFilePathMock.mockImplementation(
      (path: string) => `/granted/${path.split("/").pop()}`,
    );
    assertGrantedDirectoryPathMock.mockImplementation(
      (path: string) => `/granted/${path.split("/").pop()}`,
    );
    grantFilePathMock.mockImplementation(
      (path: string) => `/granted/${path.split("/").pop()}`,
    );
    grantDirectoryPathMock.mockImplementation(
      (path: string) => `/granted/${path.split("/").pop()}`,
    );
    previewLocalExpertPackMock.mockReturnValue({ ok: true });
    importLocalExpertPackMock.mockReturnValue({ ok: true });
    exportLocalExpertPackMock.mockReturnValue({ ok: true });
    registerSpsLearningIpc();
  });

  it("rejects ungranted preview paths before reading pack files", async () => {
    assertGrantedFilePathMock.mockImplementationOnce(() => {
      throw new Error("Path was not granted by the user");
    });

    await expect(
      handler("sps-preview-local-expert-pack")(
        {} as IpcMainInvokeEvent,
        "/tmp/excel.json",
        "default",
      ),
    ).rejects.toThrow(/not granted/i);

    expect(previewLocalExpertPackMock).not.toHaveBeenCalled();
  });

  it("rejects ungranted import paths before importing pack files", async () => {
    assertGrantedFilePathMock.mockImplementationOnce(() => {
      throw new Error("Path was not granted by the user");
    });

    await expect(
      handler("sps-import-local-expert-pack")(
        {} as IpcMainInvokeEvent,
        "/tmp/excel.json",
        "default",
      ),
    ).rejects.toThrow(/not granted/i);

    expect(importLocalExpertPackMock).not.toHaveBeenCalled();
  });

  it("rejects ungranted export directories before writing pack files", async () => {
    assertGrantedDirectoryPathMock.mockImplementationOnce(() => {
      throw new Error("Path was not granted by the user");
    });

    await expect(
      handler("sps-export-local-expert-pack")(
        {} as IpcMainInvokeEvent,
        "macos",
        "/tmp/exports/macos.json",
        "default",
      ),
    ).rejects.toThrow(/not granted/i);

    expect(exportLocalExpertPackMock).not.toHaveBeenCalled();
  });

  it("previews and imports with grant-normalized file paths", async () => {
    await handler("sps-preview-local-expert-pack")(
      {} as IpcMainInvokeEvent,
      "/tmp/excel.json",
      "work",
    );
    await handler("sps-import-local-expert-pack")(
      {} as IpcMainInvokeEvent,
      "/tmp/excel.json",
      "work",
    );

    expect(assertGrantedFilePathMock).toHaveBeenCalledWith("/tmp/excel.json");
    expect(previewLocalExpertPackMock).toHaveBeenCalledWith(
      "/granted/excel.json",
      "work",
    );
    expect(importLocalExpertPackMock).toHaveBeenCalledWith(
      "/granted/excel.json",
      "work",
    );
  });

  it("exports under the grant-normalized parent directory", async () => {
    await handler("sps-export-local-expert-pack")(
      {} as IpcMainInvokeEvent,
      "macos",
      "/tmp/exports/macos.json",
      "work",
    );

    expect(assertGrantedDirectoryPathMock).toHaveBeenCalledWith("/tmp/exports");
    expect(exportLocalExpertPackMock).toHaveBeenCalledWith(
      "macos",
      "/granted/exports/macos.json",
      "work",
    );
  });

  it("returns null when the import picker is canceled", async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: true, filePaths: [] });

    await expect(
      handler("sps-pick-local-expert-pack")({
        sender: {},
      } as IpcMainInvokeEvent),
    ).resolves.toBeNull();

    expect(grantFilePathMock).not.toHaveBeenCalled();
  });

  it("grants the selected import pack file", async () => {
    showOpenDialogMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/tmp/excel.json"],
    });

    await expect(
      handler("sps-pick-local-expert-pack")({
        sender: {},
      } as IpcMainInvokeEvent),
    ).resolves.toBe("/granted/excel.json");

    expect(grantFilePathMock).toHaveBeenCalledWith("/tmp/excel.json");
  });

  it("grants the selected export parent directory", async () => {
    showSaveDialogMock.mockResolvedValueOnce({
      canceled: false,
      filePath: "/tmp/exports/macos.json",
    });

    await expect(
      handler("sps-pick-local-expert-pack-export-path")(
        { sender: {} } as IpcMainInvokeEvent,
        "macos",
      ),
    ).resolves.toBe("/granted/exports/macos.json");

    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "macos.json",
        filters: [{ name: "Local Expert Pack", extensions: ["json"] }],
      }),
    );
    expect(grantDirectoryPathMock).toHaveBeenCalledWith("/tmp/exports");
  });
});
