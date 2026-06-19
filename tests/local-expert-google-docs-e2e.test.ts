import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const { TEST_HOME, assistantSpy } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const googleSharingAnswer = `
## What to check
Check the Share dialog for the outside client, the exact error text, and whether their role is viewer, commenter, or editor. For managed accounts, external sharing may be blocked by work/school policy.

## Steps
Open Share, confirm the client's address or group, and choose the least access needed. If the client is outside the organization, collect the policy message before changing sharing.

## Verification
Confirm the intended person appears with the expected viewer, commenter, or editor role, and ask a Workspace admin to confirm any external sharing block.

## Risk
Medium risk because broadening access can expose sensitive office documents, and admin policy should not be bypassed.

## Sources
Use the Google Drive sharing record and Workspace admin policy boundary record.
`;
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-expert-google-e2e-")),
  );
  return {
    TEST_HOME: path.join(base, "hermes"),
    assistantSpy: vi.fn(async () => ({
      kind: "chat",
      reply: [googleSharingAnswer],
    })),
  };
});

vi.mock("../src/main/utils", async () => {
  const actual =
    await vi.importActual<typeof import("../src/main/utils")>(
      "../src/main/utils",
    );
  return {
    ...actual,
    profileHome: () => TEST_HOME,
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_REPO: join(TEST_HOME, "hermes-agent"),
  HERMES_PYTHON: "/usr/bin/python3",
  hermesCliArgs: (a: string[]) => a,
  getEnhancedPath: () => "",
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

vi.mock("../src/main/sps-agent", () => ({
  spsAssistant: assistantSpy,
}));

vi.mock("../src/main/cronjobs", () => ({
  createCronJob: vi.fn(async () => ({ success: true })),
  listCronJobs: vi.fn(async () => []),
  pauseCronJob: vi.fn(async () => ({ success: true })),
  removeCronJob: vi.fn(async () => ({ success: true })),
  resumeCronJob: vi.fn(async () => ({ success: true })),
}));

import {
  getLocalExpertPack,
  installLocalExpertPack,
  listLocalExpertPacks,
} from "../src/main/local-experts";
import {
  listAssistantRecipes,
  runAssistantRecipe,
} from "../src/main/assistant-recipes";
import {
  runLocalExpertAnswerEval,
  runLocalExpertScenarioEval,
} from "../src/main/local-experts/macos-evals";
import { GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS } from "../src/main/local-experts/google-workspace-evals";
import { GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/google-workspace-pack";

beforeEach(() => {
  assistantSpy.mockClear();
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("Google Docs Editors Expert offline proof", () => {
  it("installs, exposes scenario records, and answers an office-sharing question without live services", async () => {
    expect(listLocalExpertPacks().packs.map((pack) => pack.id)).toEqual([
      "macos",
      "google-docs-editors",
    ]);

    const installed = await installLocalExpertPack("google-docs-editors");

    expect(installed).toMatchObject({
      ok: true,
      packId: "google-docs-editors",
      installed: true,
      recordsWritten: GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.length,
    });
    expect(installed.skillPath).toContain(
      "assistant-google-docs-editors-expert",
    );

    const vault = join(TEST_HOME, "sps-agent", "vault");
    expect(existsSync(join(vault, "expert-google-docs-editors.md"))).toBe(
      true,
    );
    const sharingRecordPath = join(
      vault,
      "expert_google-docs-editors",
      "drive-share-specific-people.md",
    );
    expect(existsSync(sharingRecordPath)).toBe(true);
    expect(readFileSync(sharingRecordPath, "utf-8")).toContain(
      "workspace-admin-policy-boundaries",
    );

    const detail = getLocalExpertPack("google-docs-editors");
    const scenario = detail.pack?.scenarios?.find(
      (item) => item.id === "client-cannot-open-shared-file",
    );
    expect(detail.ok).toBe(true);
    expect(scenario).toMatchObject({
      title: "Client cannot open shared file",
      recordIds: expect.arrayContaining([
        "drive-share-specific-people",
        "drive-public-link-risk",
        "workspace-admin-policy-boundaries",
      ]),
      requiredEvidence: expect.arrayContaining([
        "Exact error text or access request message",
      ]),
    });
    expect(
      runLocalExpertScenarioEval(
        GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
        scenario!,
      ),
    ).toMatchObject({ ok: true });

    const recipe = listAssistantRecipes().find(
      (item) => item.skillName === "assistant-google-docs-editors-expert",
    );
    expect(recipe).toBeTruthy();

    const run = await runAssistantRecipe(
      recipe!.id,
      "A client outside our company says they cannot open the shared Google Doc. What should I check before changing sharing?",
    );

    expect(run.ok).toBe(true);
    expect(run.run).toMatchObject({
      recipeId: recipe!.id,
      recipeName: "Google Docs Editors Expert",
      status: "success",
      resultText: expect.stringContaining("## What to check"),
    });
    expect(run.prompt).toContain(
      "Never access Gmail, Drive, Docs, Sheets, Slides, or Apps Script directly",
    );
    expect(run.prompt).toContain("Do not run scripts");
    expect(run.prompt).toContain("expert_google-docs-editors");
    expect(assistantSpy).toHaveBeenCalledWith(
      expect.stringContaining("shared Google Doc"),
      { pageTitle: "Google Docs Editors Expert", blocks: [], notes: [] },
      undefined,
      true,
    );

    const evalCase = GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS.cases.find(
      (item) => item.id === "drive-share-specific-people",
    )!;
    expect(runLocalExpertAnswerEval(evalCase, run.run!.resultText)).toMatchObject(
      {
        ok: true,
      },
    );
  });
});
