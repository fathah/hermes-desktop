import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listWorkspaceTemplates,
  renderWorkspaceButtonBlock,
  saveWorkspaceTemplate,
} from "../src/main/workspace-templates";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-templates-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace templates and buttons", () => {
  it("lists built-in page templates", async () => {
    const templates = await listWorkspaceTemplates({ root });

    expect(templates.map((template) => template.title)).toEqual([
      "Blank",
      "PRD",
      "Meeting notes",
      "Bug report",
      "Research note",
      "Sprint plan",
      "Agent runbook",
      "Decision log",
    ]);
  });

  it("saves custom templates without losing built-ins", async () => {
    await saveWorkspaceTemplate(
      {
        kind: "page",
        title: "Launch checklist",
        content: "# Launch checklist\n",
      },
      { root },
    );

    expect(
      (await listWorkspaceTemplates({ root })).map((template) => template.title),
    ).toContain("Launch checklist");
  });

  it("renders a YAML button block for local agent workflows", () => {
    expect(
      renderWorkspaceButtonBlock({
        label: "Summarize",
        prompt: "Summarize this page.",
      }),
    ).toContain("hermesType: button");
    expect(
      renderWorkspaceButtonBlock({
        label: "Summarize",
        prompt: "Summarize this page.",
      }),
    ).toContain("prompt: Summarize this page.");
  });
});
