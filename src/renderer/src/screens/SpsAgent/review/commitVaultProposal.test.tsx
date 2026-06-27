// commitVaultProposal.test.tsx — committing an AI contact-enrichment proposal
// appends the proposed fragments/tags onto the person row (via the row
// serializer, preserving body + existing data) rather than clobbering it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitVaultProposal } from "./commitVaultProposal";
import { rowToMarkdown } from "../editor/rowMarkdown";
import {
  PERSON_FOLDER,
  personToRowProps,
} from "../../../../../shared/contacts";
import type { VaultProposal } from "../../../../../shared/sps-types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

function enrichProposal(): VaultProposal {
  return {
    id: "vp_1",
    source: "enrichment",
    title: "Enrich Priya Sharma",
    summary: "Suggested 1 fragment and 1 tag.",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    operations: [
      {
        id: "op_1",
        kind: "enrich-contact",
        pageId: `${PERSON_FOLDER}/priya-sharma`,
        personName: "Priya Sharma",
        fragments: [{ text: "runs BlueBop kitchen", source: "enrichment" }],
        tags: ["cafe"],
      },
    ],
  };
}

describe("commitVaultProposal — enrich-contact", () => {
  it("appends fragments/tags to the person row, preserving existing data and body", async () => {
    const existing = rowToMarkdown(
      personToRowProps("Priya Sharma", {
        tags: ["family"],
        fragments: [{ text: "wife" }],
      }),
      "Met at BlueBop.",
    );
    const exportSpy = vi.fn().mockResolvedValue(true);
    stubApi({
      spsReadRow: vi.fn().mockResolvedValue(existing),
      spsExportRow: exportSpy,
      spsCommitVaultProposal: vi.fn(),
    });

    await commitVaultProposal(enrichProposal(), { commitPage: () => {} });

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const [folder, rowId, markdown] = exportSpy.mock.calls[0];
    expect(folder).toBe(PERSON_FOLDER);
    expect(rowId).toBe("priya-sharma");
    // existing fact kept, new fact appended, tags merged, body preserved
    expect(markdown).toContain("wife");
    expect(markdown).toContain("runs BlueBop kitchen");
    expect(markdown).toContain("family");
    expect(markdown).toContain("cafe");
    expect(markdown).toContain("Met at BlueBop.");
  });

  it("writes nothing when the person row no longer exists", async () => {
    const exportSpy = vi.fn();
    stubApi({
      spsReadRow: vi.fn().mockResolvedValue(null),
      spsExportRow: exportSpy,
      spsCommitVaultProposal: vi.fn(),
    });

    await commitVaultProposal(enrichProposal(), { commitPage: () => {} });
    expect(exportSpy).not.toHaveBeenCalled();
  });
});
