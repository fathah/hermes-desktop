import { safeHandle } from "../safe-handle";
import {
  appendActionReceipt,
  readRecentActionReceipts,
} from "../../action-receipts";
import { ensureAgentOrientation } from "../../agent-orientation";
import { appendWikiLog, type WikiLogOp } from "../../sps-wiki-log";
import { appendSpsPulse, readRecentSpsPulses } from "../../sps-pulse";
import { ensureIndexCoverage } from "../../sps-ingest";
import { resolveSpsVaultDir } from "../../sps-storage";
import { spsImportOkfBundle, spsExportOkfBundle } from "../../sps-okf";
import {
  applyMarkdownImportPlan,
  createMarkdownImportPlan,
} from "../../sps-import";
import {
  updatePageProperties,
  type SpsPropertyPatch,
} from "../../sps-properties";
import { runTelosAudit, runPipingPattern } from "../../telos-auditor";
import type {
  SpsBaseProposalInput,
  SpsContextPackInput,
  SpsImportPlan,
  SpsImportSource,
  VaultProposalInput,
} from "../../../shared/sps-types";
import {
  createVaultProposal,
  dismissVaultProposal,
  listVaultProposals,
  markVaultProposalCommitted,
} from "../../vault-review-queue";
import { buildVaultHealthReport } from "../../vault-health";
import { buildContextPack } from "../../context-packs";
import { createBaseProposalInput } from "../../base-workbenches";
import {
  assertIpcString,
  assertPathInside,
  normalizeIpcProfile,
} from "../validate";

const importPlans = new Map<string, SpsImportPlan>();

function spsVaultDirFor(profile?: unknown): string {
  return resolveSpsVaultDir(normalizeIpcProfile(profile));
}

export function registerSpsVaultIpc(): void {
  safeHandle(
    "sps-wiki-log-append",
    async (_event, op: WikiLogOp, summary: string, profile?: unknown) => {
      // After any wiki change: record it in the append-only log AND refresh the
      // LLM-Wiki catalog so index.md always covers every page.
      const safeProfile = normalizeIpcProfile(profile);
      const vaultDir = resolveSpsVaultDir(safeProfile);
      await appendWikiLog(vaultDir, op, summary);
      appendActionReceipt(
        {
          source: "sps",
          action: "wiki-log",
          outcome: "saved",
          summary: op,
        },
        safeProfile,
      );
      await ensureIndexCoverage(vaultDir);
    },
  );
  safeHandle(
    "sps-list-action-receipts",
    (_event, limit?: number, profile?: unknown) =>
      readRecentActionReceipts(limit ?? 20, normalizeIpcProfile(profile)),
  );
  safeHandle(
    "sps-list-pulses",
    async (_event, limit?: number, profile?: unknown) =>
      readRecentSpsPulses(spsVaultDirFor(profile), limit ?? 20),
  );
  safeHandle(
    "sps-ensure-agent-orientation",
    async (_event, profile?: unknown) => {
      const safeProfile = normalizeIpcProfile(profile);
      const result = ensureAgentOrientation(safeProfile);
      appendActionReceipt(
        {
          source: "sps",
          action: "agent-orientation",
          outcome: result.created ? "created" : "existing",
          summary: "Agent Orientation",
        },
        safeProfile,
      );
      if (result.created) {
        const vaultDir = resolveSpsVaultDir(safeProfile);
        await appendSpsPulse(vaultDir, {
          source: "sps",
          kind: "agent-orientation",
          summary: "Agent Orientation created",
        });
        await ensureIndexCoverage(vaultDir);
      }
      return result;
    },
  );
  safeHandle(
    "sps-health-report",
    (_event, staleDays?: number, profile?: unknown) =>
      buildVaultHealthReport(normalizeIpcProfile(profile), staleDays ?? 30),
  );
  safeHandle(
    "sps-create-vault-proposal",
    (_event, input: VaultProposalInput, profile?: unknown) =>
      createVaultProposal(input, normalizeIpcProfile(profile)),
  );
  safeHandle("sps-list-vault-proposals", (_event, profile?: unknown) =>
    listVaultProposals(normalizeIpcProfile(profile)),
  );
  safeHandle(
    "sps-commit-vault-proposal",
    (_event, id: string, operationIds?: string[], profile?: unknown) =>
      markVaultProposalCommitted(
        assertIpcString(id, "proposal id"),
        operationIds,
        normalizeIpcProfile(profile),
      ),
  );
  safeHandle(
    "sps-dismiss-vault-proposal",
    (_event, id: string, profile?: unknown) =>
      dismissVaultProposal(
        assertIpcString(id, "proposal id"),
        normalizeIpcProfile(profile),
      ),
  );
  safeHandle(
    "sps-build-context-pack",
    (_event, input: SpsContextPackInput, profile?: unknown) =>
      buildContextPack(input, normalizeIpcProfile(profile)),
  );
  safeHandle(
    "sps-create-base-proposal",
    (_event, input: SpsBaseProposalInput, profile?: unknown) =>
      createVaultProposal(
        createBaseProposalInput(input),
        normalizeIpcProfile(profile),
      ),
  );
  safeHandle(
    "sps-update-page-properties",
    (_event, pageId: unknown, patch: SpsPropertyPatch, profile?: unknown) => {
      const vaultDir = spsVaultDirFor(profile);
      const safePageId = assertIpcString(pageId, "page id");
      assertPathInside(vaultDir, `${safePageId}.md`, "page id");
      return updatePageProperties(vaultDir, safePageId, patch);
    },
  );
  safeHandle(
    "sps-import-okf-bundle",
    (_event, bundleDir: unknown, profile?: unknown) =>
      spsImportOkfBundle(
        assertIpcString(bundleDir, "bundle directory"),
        normalizeIpcProfile(profile),
      ),
  );
  safeHandle(
    "sps-create-import-plan",
    async (
      _event,
      input: { source: SpsImportSource; targetFolder?: string },
      profile?: unknown,
    ) => {
      const vaultDir = spsVaultDirFor(profile);
      if (input.source.kind !== "markdown-folder") {
        throw new Error(
          `Import dry-run is not implemented for ${input.source.kind}.`,
        );
      }
      const sourcePath = assertIpcString(input.source.path, "source path");
      const targetFolder =
        input.targetFolder === undefined
          ? undefined
          : assertIpcString(input.targetFolder, "target folder");
      if (targetFolder) {
        assertPathInside(vaultDir, targetFolder, "target folder");
      }
      const plan = await createMarkdownImportPlan({
        source: { ...input.source, path: sourcePath },
        vaultDir,
        targetFolder,
      });
      importPlans.set(plan.id, plan);
      return plan;
    },
  );
  safeHandle(
    "sps-apply-import-plan",
    async (_event, planId: unknown, profile?: unknown) => {
      const safePlanId = assertIpcString(planId, "plan id");
      const plan = importPlans.get(safePlanId);
      if (!plan) {
        return {
          success: false,
          pagesCreated: 0,
          conflicts: 0,
          skipped: 0,
          error: "Import plan not found. Create a fresh dry-run first.",
        };
      }
      const result = await applyMarkdownImportPlan(
        plan,
        spsVaultDirFor(profile),
      );
      if (result.success) importPlans.delete(safePlanId);
      return result;
    },
  );
  safeHandle(
    "sps-export-okf-bundle",
    (_event, targetDir: unknown, profile?: unknown) => {
      const vaultDir = spsVaultDirFor(profile);
      return spsExportOkfBundle(
        vaultDir,
        assertIpcString(targetDir, "target directory"),
      );
    },
  );
  safeHandle("sps-run-telos-audit", (_event, profile?: unknown) =>
    runTelosAudit(normalizeIpcProfile(profile)),
  );
  safeHandle(
    "sps-run-piping",
    (_event, text: string, pattern: string, profile?: unknown) =>
      runPipingPattern(text, pattern, normalizeIpcProfile(profile)),
  );
}
