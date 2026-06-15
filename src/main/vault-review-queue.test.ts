import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVaultProposalIn,
  dismissVaultProposalIn,
  listVaultProposalsIn,
} from "./vault-review-queue";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vault-review-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("vault review queue", () => {
  it("persists created proposals and keeps them pending by default", async () => {
    const root = tempRoot();

    const proposal = await createVaultProposalIn(root, {
      source: "inbox",
      title: "Process captures",
      summary: "Create a durable project note",
      operations: [
        {
          id: "op-create",
          kind: "upsert-page",
          pageId: "Project-Atlas",
          title: "Project Atlas",
          markdown: "# Project Atlas\n\nA durable page.",
        },
      ],
    });

    expect(proposal.status).toBe("pending");
    expect(proposal.operations[0]?.operationStatus).toBe("pending");
    expect(await listVaultProposalsIn(root)).toEqual([proposal]);
    expect(
      readFileSync(join(root, "sps-agent", "vault-review-queue.json"), "utf-8"),
    ).toContain("Project Atlas");
  });

  it("marks proposals dismissed without dropping their audit record", async () => {
    const root = tempRoot();
    const proposal = await createVaultProposalIn(root, {
      source: "health",
      title: "Vault health fixes",
      summary: "Repair one link",
      operations: [
        {
          id: "op-link",
          kind: "replace-wikilink",
          pageId: "Home",
          from: "[[missing]]",
          to: "[[Existing]]",
        },
      ],
    });

    const dismissed = await dismissVaultProposalIn(root, proposal.id);

    expect(dismissed?.status).toBe("dismissed");
    expect((await listVaultProposalsIn(root))[0]?.status).toBe("dismissed");
  });
});
