import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  patchPagePropertiesMarkdown,
  updatePageProperties,
} from "./sps-properties";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sps-properties-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("patchPagePropertiesMarkdown", () => {
  it("preserves reserved frontmatter and body while patching editable properties", () => {
    const out = patchPagePropertiesMarkdown(
      "---\ntitle: Original\ntags:\n  - keep\nstatus: todo\n---\n# Body\n",
      {
        status: "done",
        rating: 5,
        aliases: ["Atlas"],
        title: "Ignored",
      },
    );

    expect(out).toContain("title: Original");
    expect(out).toContain("status: done");
    expect(out).toContain("rating: 5");
    expect(out).toContain("aliases:\n  - Atlas");
    expect(out).not.toContain("Ignored");
    expect(out.endsWith("# Body\n")).toBe(true);
  });

  it("removes properties when patch value is undefined", () => {
    const out = patchPagePropertiesMarkdown(
      "---\nstatus: todo\nrating: 4\n---\nBody",
      { rating: undefined },
    );

    expect(out).toContain("status: todo");
    expect(out).not.toContain("rating");
  });
});

describe("updatePageProperties", () => {
  it("patches the page file in the vault", async () => {
    const vaultDir = tempRoot();
    writeFileSync(
      join(vaultDir, "Project.md"),
      "---\ntitle: Project\n---\nBody",
    );

    const ok = await updatePageProperties(vaultDir, "Project", {
      status: "active",
    });

    expect(ok).toBe(true);
    expect(readFileSync(join(vaultDir, "Project.md"), "utf-8")).toContain(
      "status: active",
    );
  });
});
