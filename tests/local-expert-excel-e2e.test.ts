import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const { TEST_HOME, assistantSpy } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const excelCoauthoringAnswer = `
## What to check
Check whether the workbook is stored in OneDrive or SharePoint Online, whether the file format is .xlsx/.xlsm/.xlsb, and whether each collaborator is signed in with a Microsoft 365 subscription account.

## Steps
Collect the storage location, workbook format, collaborator account type, and any exact read-only, version, sync, or administrator message before suggesting a sharing change.

## Verification
Confirm the workbook is in a supported cloud location and format, then verify collaborators can edit according to their intended role.

## Risk
Medium risk because unsupported storage, tenant policy, or broad sharing can block or expose workbook collaboration.

## Sources
Use the Excel coauthoring record and the SharePoint/OneDrive sharing boundary record.
`;
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-expert-excel-e2e-")),
  );
  return {
    TEST_HOME: path.join(base, "hermes"),
    assistantSpy: vi.fn(async () => ({
      kind: "chat",
      reply: [excelCoauthoringAnswer],
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
import { EXCEL_LOCAL_EXPERT_EVALS } from "../src/main/local-experts/excel-evals";
import { EXCEL_LOCAL_EXPERT_PACK } from "../src/main/local-experts/excel-pack";

beforeEach(() => {
  assistantSpy.mockClear();
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("Excel Expert offline proof", () => {
  it("installs, exposes scenario records, and answers a coauthoring question without live services", async () => {
    expect(listLocalExpertPacks().packs.map((pack) => pack.id)).toEqual([
      "macos",
      "google-docs-editors",
      "excel",
    ]);

    const installed = await installLocalExpertPack("excel");

    expect(installed).toMatchObject({
      ok: true,
      packId: "excel",
      installed: true,
      recordsWritten: EXCEL_LOCAL_EXPERT_PACK.records.length,
    });
    expect(installed.skillPath).toContain("assistant-excel-expert");

    const vault = join(TEST_HOME, "sps-agent", "vault");
    expect(existsSync(join(vault, "expert-excel.md"))).toBe(true);
    const coauthoringRecordPath = join(
      vault,
      "expert_excel",
      "excel-coauthoring-cloud-requirements.md",
    );
    expect(existsSync(coauthoringRecordPath)).toBe(true);
    expect(readFileSync(coauthoringRecordPath, "utf-8")).toContain(
      "excel-sharing-admin-boundaries",
    );

    const detail = getLocalExpertPack("excel");
    const scenario = detail.pack?.scenarios?.find(
      (item) => item.id === "shared-workbook-cannot-coauthor",
    );
    expect(detail.ok).toBe(true);
    expect(scenario).toMatchObject({
      title: "Shared workbook cannot coauthor",
      recordIds: expect.arrayContaining([
        "excel-coauthoring-cloud-requirements",
        "excel-sharing-admin-boundaries",
      ]),
      requiredEvidence: expect.arrayContaining([
        "Workbook storage location: OneDrive, OneDrive for Business, SharePoint Online, or another location",
      ]),
    });
    expect(
      runLocalExpertScenarioEval(EXCEL_LOCAL_EXPERT_PACK, scenario!),
    ).toMatchObject({ ok: true });

    const recipe = listAssistantRecipes().find(
      (item) => item.skillName === "assistant-excel-expert",
    );
    expect(recipe).toBeTruthy();

    const run = await runAssistantRecipe(
      recipe!.id,
      "Our team cannot coauthor an Excel workbook. What should I check before changing sharing?",
    );

    expect(run.ok).toBe(true);
    expect(run.run).toMatchObject({
      recipeId: recipe!.id,
      recipeName: "Excel Expert",
      status: "success",
      resultText: expect.stringContaining("## What to check"),
    });
    expect(run.prompt).toContain(
      "Never open Excel files, run VBA macros, run Office Scripts, or change sharing",
    );
    expect(run.prompt).toContain("Do not request credentials");
    expect(run.prompt).toContain("expert_excel");
    expect(assistantSpy).toHaveBeenCalledWith(
      expect.stringContaining("coauthor an Excel workbook"),
      { pageTitle: "Excel Expert", blocks: [], notes: [] },
      undefined,
      true,
    );

    const evalCase = EXCEL_LOCAL_EXPERT_EVALS.cases.find(
      (item) => item.id === "excel-coauthoring-cloud-requirements",
    )!;
    expect(
      runLocalExpertAnswerEval(evalCase, run.run!.resultText),
    ).toMatchObject({
      ok: true,
    });
  });
});
