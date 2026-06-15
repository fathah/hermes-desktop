import { describe, expect, it } from "vitest";
import { createBaseProposalInput, getBaseWorkbenchRecipe } from "./base-workbenches";

describe("base workbenches", () => {
  it("creates a reviewable Base page proposal from a built-in recipe", () => {
    const recipe = getBaseWorkbenchRecipe("projects");

    expect(recipe?.columns).toContain("status");

    const proposal = createBaseProposalInput({
      recipe: "projects",
      folder: "Projects",
      pageId: "Projects-Base",
    });

    expect(proposal.source).toBe("base");
    expect(proposal.operations[0]).toMatchObject({
      kind: "create-base-page",
      pageId: "Projects-Base",
      title: "Active projects",
    });
    const operation = proposal.operations[0];
    if (operation?.kind !== "create-base-page") {
      throw new Error("Expected a create-base-page operation");
    }
    expect(operation.markdown).toContain("source: Projects");
    expect(operation.markdown).toContain("view: board");
  });
});
