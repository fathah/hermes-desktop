import type {
  VaultOperation,
  VaultProposal,
} from "../../../../../shared/sps-types";
import type { IngestPageProposal } from "../inbox/ingestApply";
import { INBOX_FOLDER, withStatus } from "../inbox/capture";

export interface CommitVaultProposalOptions {
  profile?: string;
  selectedOperationIds?: Set<string>;
  commitPage: (page: IngestPageProposal) => void;
}

export async function commitVaultProposal(
  proposal: VaultProposal,
  options: CommitVaultProposalOptions,
): Promise<{ committed: string[]; skipped: string[] }> {
  const committed: string[] = [];
  const skipped: string[] = [];
  for (const operation of proposal.operations) {
    if (
      options.selectedOperationIds &&
      !options.selectedOperationIds.has(operation.id)
    ) {
      skipped.push(operation.id);
      continue;
    }
    await commitOperation(operation, options);
    committed.push(operation.id);
  }
  await window.hermesAPI.spsCommitVaultProposal?.(
    proposal.id,
    committed,
    options.profile,
  );
  return { committed, skipped };
}

async function commitOperation(
  operation: VaultOperation,
  options: CommitVaultProposalOptions,
): Promise<void> {
  const api = window.hermesAPI;
  if (operation.kind === "upsert-page" || operation.kind === "create-base-page") {
    options.commitPage({
      op: "create",
      pageId: operation.pageId,
      title: operation.title,
      markdown: operation.markdown,
    });
    return;
  }
  if (operation.kind === "update-frontmatter") {
    await api.spsUpdatePageProperties?.(
      operation.pageId,
      operation.patch,
      options.profile,
    );
    return;
  }
  if (operation.kind === "replace-wikilink") {
    throw new Error("Replace-wikilink proposals must be reviewed manually in v1.");
  }
  if (operation.kind === "mark-duplicate-merged") {
    await api.spsUpdatePageProperties?.(
      operation.duplicatePageId,
      { mergedInto: operation.canonicalPageId },
      options.profile,
    );
    return;
  }
  if (operation.kind === "mark-capture") {
    const current = await api.spsReadRow?.(
      INBOX_FOLDER,
      operation.captureId,
      options.profile,
    );
    if (current) {
      await api.spsExportRow?.(
        INBOX_FOLDER,
        operation.captureId,
        withStatus(current, operation.status),
        options.profile,
      );
    }
    return;
  }
  if (operation.kind === "add-memory") {
    await api.addMemoryEntry?.(operation.body, options.profile);
  }
}
