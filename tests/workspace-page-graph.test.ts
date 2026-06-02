import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspacePage, writeWorkspaceFile } from "../src/main/workspace";
import {
  getWorkspaceBacklinks,
  getWorkspacePageGraph,
  moveWorkspacePageInGraph,
  updateWorkspaceSidebarState,
} from "../src/main/workspace-page-graph";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-graph-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace page graph", () => {
  it("migrates workspace metadata into a graph with stable ids, ordering, backlinks, and sidebar state", async () => {
    const product = await createWorkspacePage(
      { title: "Product Roadmap" },
      { root },
    );
    const spec = await createWorkspacePage(
      { title: "Implementation Spec" },
      { root },
    );
    await writeWorkspaceFile(
      product.path,
      "# Product Roadmap\n\nSee [[Implementation Spec]] for details.",
      { root },
    );

    const graph = await getWorkspacePageGraph({ root });

    expect(graph.version).toBe(2);
    expect(graph.pages[product.path].id).toBe(product.id);
    expect(graph.rootOrder).toContain(product.path);
    expect(graph.childOrder.__root__).toContain(product.path);
    expect(graph.backlinks[spec.path]).toContain(product.path);

    const updated = await updateWorkspaceSidebarState(
      { collapsedSections: ["trash"], width: 312, collapsed: true },
      { root },
    );
    expect(updated.sidebar).toEqual({
      collapsedSections: ["trash"],
      width: 312,
      collapsed: true,
    });
  });

  it("moves a page before another page and exposes backlinks for the target", async () => {
    const alpha = await createWorkspacePage({ title: "Alpha" }, { root });
    const beta = await createWorkspacePage({ title: "Beta" }, { root });
    const gamma = await createWorkspacePage({ title: "Gamma" }, { root });
    await writeWorkspaceFile(alpha.path, "# Alpha\n\n[[Gamma]]", { root });

    const moved = await moveWorkspacePageInGraph(beta.path, null, gamma.path, {
      root,
    });
    const graph = await getWorkspacePageGraph({ root });

    expect(moved.parentPath).toBeNull();
    expect(graph.childOrder.__root__).toEqual([
      "index.md",
      alpha.path,
      beta.path,
      gamma.path,
    ]);
    expect(await getWorkspaceBacklinks(gamma.path, { root })).toEqual([
      alpha.path,
    ]);
  });
});
