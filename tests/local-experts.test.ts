import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-experts-test-")),
  );
  return { TEST_HOME: path.join(base, "hermes") };
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
  spsAssistant: vi.fn(async () => ({ kind: "chat", reply: ["ok"] })),
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
  previewLocalExpertPack,
  renderLocalExpertOverviewMarkdown,
  renderLocalExpertRecordMarkdown,
  uninstallLocalExpertPack,
} from "../src/main/local-experts";
import { MACOS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/macos-pack";
import {
  getLocalExpertPackQualityReport,
  getLocalExpertPackFreshness,
  validateLocalExpertPack,
} from "../src/shared/local-experts";
import { listAssistantRecipes } from "../src/main/assistant-recipes";
import { GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/google-workspace-pack";
import { EXCEL_LOCAL_EXPERT_PACK } from "../src/main/local-experts/excel-pack";

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("local experts", () => {
  it("validates the built-in Mac Expert pack", () => {
    const result = validateLocalExpertPack(MACOS_LOCAL_EXPERT_PACK);

    expect(result.ok).toBe(true);
    expect(MACOS_LOCAL_EXPERT_PACK.id).toBe("macos");
    expect(MACOS_LOCAL_EXPERT_PACK.title).toBe("Mac Expert");
    expect(MACOS_LOCAL_EXPERT_PACK.records.length).toBeGreaterThanOrEqual(8);
    expect(
      MACOS_LOCAL_EXPERT_PACK.records.every(
        (record) => record.sourceUrls.length > 0 && record.lastVerified,
      ),
    ).toBe(true);
  });

  it("validates the built-in Google Docs Editors Expert pack", () => {
    const result = validateLocalExpertPack(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
    );

    expect(result.ok).toBe(true);
    expect(GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.id).toBe(
      "google-docs-editors",
    );
    expect(GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.title).toBe(
      "Google Docs Editors Expert",
    );
    expect(GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.length).toBe(10);
    expect(GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.scenarios).toHaveLength(6);
    expect(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.every(
        (record) =>
          record.sourceUrls.length > 0 &&
          record.lastVerified &&
          record.appliesTo?.length,
      ),
    ).toBe(true);
    expect(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.scenarios?.every(
        (scenario) =>
          scenario.recordIds.length > 0 &&
          scenario.requiredEvidence.length > 0 &&
          scenario.expectedSections.join("|") ===
            "What to check|Steps|Verification|Risk|Sources",
      ),
    ).toBe(true);
  });

  it("validates the built-in Excel Expert pack", () => {
    const result = validateLocalExpertPack(EXCEL_LOCAL_EXPERT_PACK);

    expect(result.ok).toBe(true);
    expect(EXCEL_LOCAL_EXPERT_PACK.id).toBe("excel");
    expect(EXCEL_LOCAL_EXPERT_PACK.title).toBe("Excel Expert");
    expect(EXCEL_LOCAL_EXPERT_PACK.version).toBe("1.0.1");
    expect(EXCEL_LOCAL_EXPERT_PACK.records.length).toBe(14);
    expect(EXCEL_LOCAL_EXPERT_PACK.scenarios).toHaveLength(10);
    expect(EXCEL_LOCAL_EXPERT_PACK.sourceTiers).toEqual([
      "microsoft_365_official",
      "microsoft_developer_official",
    ]);
    expect(
      EXCEL_LOCAL_EXPERT_PACK.records.every(
        (record) =>
          record.sourceUrls.length > 0 &&
          ["2026-06-22", "2026-06-24"].includes(record.lastVerified) &&
          record.appliesTo?.length,
      ),
    ).toBe(true);
    expect(EXCEL_LOCAL_EXPERT_PACK.records.map((record) => record.id)).toEqual(
      expect.arrayContaining([
        "excel-workbook-recovery-repair",
        "excel-embedded-chart-triage",
        "excel-gridlines-readability-cleanup",
        "excel-worksheet-order-cleanup",
      ]),
    );
    expect(
      EXCEL_LOCAL_EXPERT_PACK.scenarios?.every(
        (scenario) =>
          scenario.recordIds.length > 0 &&
          scenario.requiredEvidence.length > 0 &&
          scenario.expectedSections.join("|") ===
            "What to check|Steps|Verification|Risk|Sources",
      ),
    ).toBe(true);
  });

  it("validates enriched record metadata and source freshness", () => {
    const record = MACOS_LOCAL_EXPERT_PACK.records[0];

    expect(record.commonQuestions?.length).toBeGreaterThan(0);
    expect(record.dontSay?.length).toBeGreaterThan(0);
    expect(record.authorityNotes).toBeTruthy();
    expect(record.freshnessDays).toBeGreaterThan(0);

    const freshness = getLocalExpertPackFreshness(
      MACOS_LOCAL_EXPERT_PACK,
      new Date("2026-06-17T12:00:00Z"),
    );

    expect(freshness.status).toBe("current");
    expect(freshness.current).toBe(MACOS_LOCAL_EXPERT_PACK.records.length);
    expect(freshness.stale).toBe(0);
    expect(freshness.expired).toBe(0);
  });

  it("validates Google source freshness and flags stale copied packs", () => {
    const current = getLocalExpertPackFreshness(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      new Date("2026-06-18T12:00:00Z"),
    );
    const stalePack = {
      ...GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      records: GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.map((record) => ({
        ...record,
        lastVerified: "2025-01-01",
      })),
    };
    const stale = getLocalExpertPackFreshness(
      stalePack,
      new Date("2026-06-18T12:00:00Z"),
    );

    expect(current.status).toBe("current");
    expect(current.current).toBe(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.length,
    );
    expect(stale.status).toBe("expired");
    expect(stale.expired).toBe(stalePack.records.length);
  });

  it("reports Google pack quality and stale copied-pack quality", () => {
    const current = getLocalExpertPackQualityReport(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      new Date("2026-06-18T12:00:00Z"),
    );
    const stalePack = {
      ...GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      records: GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.map((record) => ({
        ...record,
        lastVerified: "2025-01-01",
      })),
    };
    const stale = getLocalExpertPackQualityReport(
      stalePack,
      new Date("2026-06-18T12:00:00Z"),
    );

    expect(current).toMatchObject({
      packId: "google-docs-editors",
      recordCount: 10,
      scenarioCount: 6,
      staleRecordCount: 0,
      expiredRecordCount: 0,
      brokenScenarioLinks: [],
    });
    expect(current.sourceCount).toBeGreaterThanOrEqual(9);
    expect(stale.expiredRecordCount).toBe(10);
  });

  it("reports Excel pack freshness and quality", () => {
    const freshness = getLocalExpertPackFreshness(
      EXCEL_LOCAL_EXPERT_PACK,
      new Date("2026-06-22T12:00:00Z"),
    );
    const quality = getLocalExpertPackQualityReport(
      EXCEL_LOCAL_EXPERT_PACK,
      new Date("2026-06-22T12:00:00Z"),
    );

    expect(freshness.status).toBe("current");
    expect(freshness.current).toBe(EXCEL_LOCAL_EXPERT_PACK.records.length);
    expect(quality).toMatchObject({
      packId: "excel",
      recordCount: 14,
      scenarioCount: 10,
      staleRecordCount: 0,
      expiredRecordCount: 0,
      brokenScenarioLinks: [],
      validationErrorCount: 0,
    });
    expect(quality.sourceCount).toBeGreaterThanOrEqual(13);
  });

  it("rejects duplicate record ids and non-HTTPS sources", () => {
    const badPack = {
      ...MACOS_LOCAL_EXPERT_PACK,
      records: [
        MACOS_LOCAL_EXPERT_PACK.records[0],
        {
          ...MACOS_LOCAL_EXPERT_PACK.records[0],
          sourceUrls: ["http://example.com/not-secure"],
        },
      ],
    };

    const result = validateLocalExpertPack(badPack);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      `Duplicate record id: ${MACOS_LOCAL_EXPERT_PACK.records[0].id}`,
    );
    expect(result.errors).toContain(
      `Record ${MACOS_LOCAL_EXPERT_PACK.records[0].id} source must be HTTPS: http://example.com/not-secure`,
    );
  });

  it("renders deterministic markdown records with required sections and sources", () => {
    const record = MACOS_LOCAL_EXPERT_PACK.records[0];
    const markdown = renderLocalExpertRecordMarkdown(
      MACOS_LOCAL_EXPERT_PACK,
      record,
    );

    expect(markdown).toContain(`title: "${record.title}"`);
    expect(markdown).toContain("#local-expert/macos");
    expect(markdown).toContain("## Symptoms");
    expect(markdown).toContain("## Steps");
    expect(markdown).toContain("## Verification");
    expect(markdown).toContain("## Common Questions");
    expect(markdown).toContain("## Do Not Say");
    expect(markdown).toContain("## Authority Notes");
    expect(markdown).toContain("## Risk");
    expect(markdown).toContain("## Sources");
    expect(markdown).toContain(record.sourceUrls[0]);
    expect(markdown).toBe(
      renderLocalExpertRecordMarkdown(MACOS_LOCAL_EXPERT_PACK, record),
    );
  });

  it("installs Mac Expert idempotently into vault rows, a profile skill, and an assistant recipe", async () => {
    const first = await installLocalExpertPack("macos");
    const second = await installLocalExpertPack("macos");

    expect(first.ok).toBe(true);
    expect(first.recordsWritten).toBe(MACOS_LOCAL_EXPERT_PACK.records.length);
    expect(first.recordsSkipped).toBe(0);
    expect(first.recipeId).toMatch(/^ar_/);
    expect(first.skillPath).toContain("assistant-mac-expert");
    expect(second.ok).toBe(true);
    expect(second.recordsWritten).toBe(0);
    expect(second.recordsSkipped).toBe(MACOS_LOCAL_EXPERT_PACK.records.length);
    expect(second.recipeId).toBe(first.recipeId);
    expect(second.skillPath).toBe(first.skillPath);
    expect(listAssistantRecipes()).toHaveLength(1);

    const state = JSON.parse(
      readFileSync(join(TEST_HOME, "sps-agent", "local-experts.json"), "utf-8"),
    );
    expect(state[0]).toMatchObject({
      packId: "macos",
      packVersion: MACOS_LOCAL_EXPERT_PACK.version,
      recordCount: MACOS_LOCAL_EXPERT_PACK.records.length,
      sourceCount: expect.any(Number),
      overviewPath: "expert-macos.md",
      recordsPath: "expert_macos/",
      packHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const vault = join(TEST_HOME, "sps-agent", "vault");
    expect(existsSync(join(vault, "expert-macos.md"))).toBe(true);
    expect(existsSync(join(vault, "expert_macos"))).toBe(true);
    const row = readFileSync(
      join(
        vault,
        "expert_macos",
        `${MACOS_LOCAL_EXPERT_PACK.records[0].id}.md`,
      ),
      "utf-8",
    );
    expect(row).toContain("## Sources");

    const skillFile = join(
      TEST_HOME,
      "skills",
      "assistant-recipes",
      "assistant-mac-expert",
      "SKILL.md",
    );
    expect(readFileSync(skillFile, "utf-8")).toContain(
      "never claim a setting is enabled unless evidence is provided",
    );
  });

  it("lists built-in experts and installs Google Docs Editors idempotently", async () => {
    expect(listLocalExpertPacks().packs.map((pack) => pack.id)).toEqual([
      "macos",
      "google-docs-editors",
      "excel",
    ]);

    const first = await installLocalExpertPack("google-docs-editors");
    const second = await installLocalExpertPack("google-docs-editors");

    expect(first.ok).toBe(true);
    expect(first.recordsWritten).toBe(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.length,
    );
    expect(first.recordsSkipped).toBe(0);
    expect(first.recipeId).toMatch(/^ar_/);
    expect(first.skillPath).toContain("assistant-google-docs-editors-expert");
    expect(second.ok).toBe(true);
    expect(second.recordsWritten).toBe(0);
    expect(second.recordsSkipped).toBe(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.length,
    );
    expect(second.recipeId).toBe(first.recipeId);
    expect(second.skillPath).toBe(first.skillPath);

    const state = JSON.parse(
      readFileSync(join(TEST_HOME, "sps-agent", "local-experts.json"), "utf-8"),
    );
    expect(state[0]).toMatchObject({
      packId: "google-docs-editors",
      packVersion: GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.version,
      recordCount: GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.length,
      sourceCount: expect.any(Number),
      overviewPath: "expert-google-docs-editors.md",
      recordsPath: "expert_google-docs-editors/",
      packHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const vault = join(TEST_HOME, "sps-agent", "vault");
    expect(existsSync(join(vault, "expert-google-docs-editors.md"))).toBe(true);
    expect(existsSync(join(vault, "expert_google-docs-editors"))).toBe(true);
    const row = readFileSync(
      join(
        vault,
        "expert_google-docs-editors",
        "drive-share-specific-people.md",
      ),
      "utf-8",
    );
    expect(row).toContain("Applies to: Google Drive, Google Docs editors");
    expect(row).toContain("## Related Records");
    expect(row).toContain("workspace-admin-policy-boundaries");
    expect(row).toContain("## Sources");

    const skillFile = join(
      TEST_HOME,
      "skills",
      "assistant-recipes",
      "assistant-google-docs-editors-expert",
      "SKILL.md",
    );
    expect(readFileSync(skillFile, "utf-8")).toContain(
      "Never access Gmail, Drive, Docs, Sheets, Slides, or Apps Script directly",
    );
  });

  it("installs Excel Expert idempotently into vault rows, a profile skill, and an assistant recipe", async () => {
    const first = await installLocalExpertPack("excel");
    const second = await installLocalExpertPack("excel");

    expect(first.ok).toBe(true);
    expect(first.recordsWritten).toBe(EXCEL_LOCAL_EXPERT_PACK.records.length);
    expect(first.recordsSkipped).toBe(0);
    expect(first.recipeId).toMatch(/^ar_/);
    expect(first.skillPath).toContain("assistant-excel-expert");
    expect(second.ok).toBe(true);
    expect(second.recordsWritten).toBe(0);
    expect(second.recordsSkipped).toBe(EXCEL_LOCAL_EXPERT_PACK.records.length);
    expect(second.recipeId).toBe(first.recipeId);
    expect(second.skillPath).toBe(first.skillPath);

    const state = JSON.parse(
      readFileSync(join(TEST_HOME, "sps-agent", "local-experts.json"), "utf-8"),
    );
    expect(state[0]).toMatchObject({
      packId: "excel",
      packVersion: EXCEL_LOCAL_EXPERT_PACK.version,
      recordCount: EXCEL_LOCAL_EXPERT_PACK.records.length,
      sourceCount: expect.any(Number),
      overviewPath: "expert-excel.md",
      recordsPath: "expert_excel/",
      packHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const vault = join(TEST_HOME, "sps-agent", "vault");
    expect(existsSync(join(vault, "expert-excel.md"))).toBe(true);
    expect(existsSync(join(vault, "expert_excel"))).toBe(true);
    const row = readFileSync(
      join(vault, "expert_excel", "excel-coauthoring-cloud-requirements.md"),
      "utf-8",
    );
    expect(row).toContain(
      "Applies to: Excel for Microsoft 365, Excel for the web, OneDrive, SharePoint Online",
    );
    expect(row).toContain("excel-sharing-admin-boundaries");
    expect(row).toContain("## Sources");
    const recoveryRow = readFileSync(
      join(vault, "expert_excel", "excel-workbook-recovery-repair.md"),
      "utf-8",
    );
    expect(recoveryRow).toContain("## Sources");
    expect(recoveryRow).toContain("excel-macro-security");

    const skillFile = join(
      TEST_HOME,
      "skills",
      "assistant-recipes",
      "assistant-excel-expert",
      "SKILL.md",
    );
    expect(readFileSync(skillFile, "utf-8")).toContain(
      "Never open Excel files, run VBA macros, run Office Scripts, or change sharing",
    );
    expect(readFileSync(skillFile, "utf-8")).toContain(
      "Never repair workbooks or claim data was recovered",
    );
  });

  it("lists install state and uninstalls without deleting vault records", async () => {
    const installed = await installLocalExpertPack("macos");

    const listed = listLocalExpertPacks();
    expect(listed.packs[0]).toMatchObject({
      id: "macos",
      installed: true,
      recipeId: installed.recipeId,
      packHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      freshness: expect.objectContaining({ status: "current" }),
    });

    const detail = getLocalExpertPack("macos");
    expect(detail.ok).toBe(true);
    expect(detail.pack?.records.length).toBe(
      MACOS_LOCAL_EXPERT_PACK.records.length,
    );
    expect(detail.installState?.recipeId).toBe(installed.recipeId);
    expect(detail.sourceTiers).toEqual(
      expect.arrayContaining(["apple_official", "developer_official"]),
    );

    const uninstalled = await uninstallLocalExpertPack("macos");
    expect(uninstalled).toMatchObject({
      ok: true,
      packId: "macos",
      installed: false,
      recordsLeftInVault: true,
    });
    expect(listAssistantRecipes()[0].enabled).toBe(false);
    expect(
      existsSync(
        join(
          TEST_HOME,
          "sps-agent",
          "vault",
          "expert_macos",
          `${MACOS_LOCAL_EXPERT_PACK.records[0].id}.md`,
        ),
      ),
    ).toBe(true);
  });

  it("previews invalid imported packs without installing them", () => {
    const badPath = join(TEST_HOME, "bad-pack.json");
    mkdirSync(TEST_HOME, { recursive: true });
    const duplicate = {
      schemaVersion: 1,
      pack: {
        ...MACOS_LOCAL_EXPERT_PACK,
        id: "macos",
        records: [
          MACOS_LOCAL_EXPERT_PACK.records[0],
          MACOS_LOCAL_EXPERT_PACK.records[0],
        ],
      },
    };
    writeFileSync(badPath, JSON.stringify(duplicate), "utf-8");

    const preview = previewLocalExpertPack(badPath);

    expect(preview.ok).toBe(false);
    expect(preview.canImport).toBe(false);
    expect(preview.errors.join("\n")).toContain(
      "conflicts with a built-in pack",
    );
  });

  it("rejects packs with broken scenario record links", () => {
    const broken = {
      ...GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      scenarios: [
        {
          ...GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.scenarios![0],
          recordIds: ["missing-record"],
        },
      ],
    };

    const result = validateLocalExpertPack(broken);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Scenario client-cannot-open-shared-file links missing record: missing-record",
    );
  });

  it("renders an overview page summarizing tiers and record count", () => {
    const markdown = renderLocalExpertOverviewMarkdown(MACOS_LOCAL_EXPERT_PACK);

    expect(markdown).toContain("# Mac Expert");
    expect(markdown).toContain("Record count:");
    expect(markdown).toContain("apple_official");
    expect(markdown).toContain("expert_macos/");
  });
});
