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

const importPlans = new Map<string, SpsImportPlan>();

export function registerSpsVaultIpc(): void {
  safeHandle(
    "sps-wiki-log-append",
    async (_event, op: WikiLogOp, summary: string, profile?: string) => {
      // After any wiki change: record it in the append-only log AND refresh the
      // LLM-Wiki catalog so index.md always covers every page.
      const vaultDir = resolveSpsVaultDir(profile);
      await appendWikiLog(vaultDir, op, summary);
      appendActionReceipt(
        {
          source: "sps",
          action: "wiki-log",
          outcome: "saved",
          summary: op,
        },
        profile,
      );
      await ensureIndexCoverage(vaultDir);
    },
  );
  safeHandle(
    "sps-list-action-receipts",
    (_event, limit?: number, profile?: string) =>
      readRecentActionReceipts(limit ?? 20, profile),
  );
  safeHandle(
    "sps-list-pulses",
    async (_event, limit?: number, profile?: string) =>
      readRecentSpsPulses(resolveSpsVaultDir(profile), limit ?? 20),
  );
  safeHandle(
    "sps-ensure-agent-orientation",
    async (_event, profile?: string) => {
      const result = ensureAgentOrientation(profile);
      appendActionReceipt(
        {
          source: "sps",
          action: "agent-orientation",
          outcome: result.created ? "created" : "existing",
          summary: "Agent Orientation",
        },
        profile,
      );
      if (result.created) {
        const vaultDir = resolveSpsVaultDir(profile);
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
    (_event, staleDays?: number, profile?: string) =>
      buildVaultHealthReport(profile, staleDays ?? 30),
  );
  safeHandle(
    "sps-create-vault-proposal",
    (_event, input: VaultProposalInput, profile?: string) =>
      createVaultProposal(input, profile),
  );
  safeHandle("sps-list-vault-proposals", (_event, profile?: string) =>
    listVaultProposals(profile),
  );
  safeHandle(
    "sps-commit-vault-proposal",
    (_event, id: string, operationIds?: string[], profile?: string) =>
      markVaultProposalCommitted(id, operationIds, profile),
  );
  safeHandle(
    "sps-dismiss-vault-proposal",
    (_event, id: string, profile?: string) => dismissVaultProposal(id, profile),
  );
  safeHandle(
    "sps-build-context-pack",
    (_event, input: SpsContextPackInput, profile?: string) =>
      buildContextPack(input, profile),
  );
  safeHandle(
    "sps-create-base-proposal",
    (_event, input: SpsBaseProposalInput, profile?: string) =>
      createVaultProposal(createBaseProposalInput(input), profile),
  );
  safeHandle(
    "sps-update-page-properties",
    (_event, pageId: string, patch: SpsPropertyPatch, profile?: string) =>
      updatePageProperties(resolveSpsVaultDir(profile), pageId, patch),
  );
  safeHandle(
    "sps-import-okf-bundle",
    (_event, bundleDir: string, profile?: string) =>
      spsImportOkfBundle(bundleDir, profile),
  );
  safeHandle(
    "sps-create-import-plan",
    async (
      _event,
      input: { source: SpsImportSource; targetFolder?: string },
      profile?: string,
    ) => {
      if (input.source.kind !== "markdown-folder") {
        throw new Error(
          `Import dry-run is not implemented for ${input.source.kind}.`,
        );
      }
      const plan = await createMarkdownImportPlan({
        source: input.source,
        vaultDir: resolveSpsVaultDir(profile),
        targetFolder: input.targetFolder,
      });
      importPlans.set(plan.id, plan);
      return plan;
    },
  );
  safeHandle(
    "sps-apply-import-plan",
    async (_event, planId: string, profile?: string) => {
      const plan = importPlans.get(planId);
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
        resolveSpsVaultDir(profile),
      );
      if (result.success) importPlans.delete(planId);
      return result;
    },
  );
  safeHandle(
    "sps-export-okf-bundle",
    (_event, targetDir: string, profile?: string) => {
      const vaultDir = resolveSpsVaultDir(profile);
      return spsExportOkfBundle(vaultDir, targetDir);
    },
  );
  safeHandle("sps-run-telos-audit", (_event, profile?: string) =>
    runTelosAudit(profile),
  );
  safeHandle(
    "sps-run-piping",
    (_event, text: string, pattern: string, profile?: string) =>
      runPipingPattern(text, pattern, profile),
  );
}
