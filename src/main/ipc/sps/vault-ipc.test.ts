import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const {
  handlers,
  resolveSpsVaultDirMock,
  updatePagePropertiesMock,
  applyMarkdownImportPlanMock,
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resolveSpsVaultDirMock: vi.fn(() => "/vault"),
  updatePagePropertiesMock: vi.fn(async () => true),
  applyMarkdownImportPlanMock: vi.fn(async () => ({ success: true })),
}));

vi.mock("../safe-handle", () => ({
  safeHandle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, async (...args: unknown[]) => fn(...args));
  },
}));

vi.mock("../../action-receipts", () => ({
  appendActionReceipt: vi.fn(),
  readRecentActionReceipts: vi.fn(() => []),
}));

vi.mock("../../agent-orientation", () => ({
  ensureAgentOrientation: vi.fn(() => ({ created: false })),
}));

vi.mock("../../sps-wiki-log", () => ({
  appendWikiLog: vi.fn(),
}));

vi.mock("../../sps-pulse", () => ({
  appendSpsPulse: vi.fn(),
  readRecentSpsPulses: vi.fn(async () => []),
}));

vi.mock("../../sps-ingest", () => ({
  ensureIndexCoverage: vi.fn(),
}));

vi.mock("../../sps-storage", () => ({
  resolveSpsVaultDir: resolveSpsVaultDirMock,
}));

vi.mock("../../sps-okf", () => ({
  spsImportOkfBundle: vi.fn(),
  spsExportOkfBundle: vi.fn(),
}));

vi.mock("../../sps-import", () => ({
  applyMarkdownImportPlan: applyMarkdownImportPlanMock,
  createMarkdownImportPlan: vi.fn(async () => ({
    id: "imp-1",
    items: [],
    summary: { filesScanned: 0, pagesToCreate: 0, conflicts: 0, skipped: 0 },
  })),
}));

vi.mock("../../sps-properties", () => ({
  updatePageProperties: updatePagePropertiesMock,
}));

vi.mock("../../telos-auditor", () => ({
  runTelosAudit: vi.fn(),
  runPipingPattern: vi.fn(),
}));

vi.mock("../../vault-review-queue", () => ({
  createVaultProposal: vi.fn(),
  dismissVaultProposal: vi.fn(),
  listVaultProposals: vi.fn(() => []),
  markVaultProposalCommitted: vi.fn(),
}));

vi.mock("../../vault-health", () => ({
  buildVaultHealthReport: vi.fn(),
}));

vi.mock("../../context-packs", () => ({
  buildContextPack: vi.fn(),
}));

vi.mock("../../base-workbenches", () => ({
  createBaseProposalInput: vi.fn((input: unknown) => input),
}));

import { registerSpsVaultIpc } from "./vault";

function handler(channel: string): (...args: unknown[]) => unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`missing handler: ${channel}`);
  return fn;
}

describe("SPS vault IPC validation", () => {
  beforeEach(() => {
    handlers.clear();
    resolveSpsVaultDirMock.mockClear();
    updatePagePropertiesMock.mockClear();
    applyMarkdownImportPlanMock.mockClear();
    registerSpsVaultIpc();
  });

  it("rejects a hostile profile before resolving the vault", async () => {
    await expect(
      handler("sps-list-pulses")({} as IpcMainInvokeEvent, 20, "../escape"),
    ).rejects.toThrow(/profile/i);

    expect(resolveSpsVaultDirMock).not.toHaveBeenCalled();
  });

  it("rejects traversal page ids before calling page-property storage", async () => {
    await expect(
      handler("sps-update-page-properties")(
        {} as IpcMainInvokeEvent,
        "../escape",
        { status: "done" },
        "default",
      ),
    ).rejects.toThrow(/page id/i);

    expect(updatePagePropertiesMock).not.toHaveBeenCalled();
  });

  it("rejects malformed import plan ids before lookup or apply", async () => {
    await expect(
      handler("sps-apply-import-plan")(
        {} as IpcMainInvokeEvent,
        "imp-1\u0000evil",
        "default",
      ),
    ).rejects.toThrow(/plan id/i);

    expect(applyMarkdownImportPlanMock).not.toHaveBeenCalled();
  });
});
