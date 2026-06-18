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
  getLocalExpertPackFreshness,
  validateLocalExpertPack,
} from "../src/shared/local-experts";
import { listAssistantRecipes } from "../src/main/assistant-recipes";

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

  it("renders an overview page summarizing tiers and record count", () => {
    const markdown = renderLocalExpertOverviewMarkdown(MACOS_LOCAL_EXPERT_PACK);

    expect(markdown).toContain("# Mac Expert");
    expect(markdown).toContain("Record count:");
    expect(markdown).toContain("apple_official");
    expect(markdown).toContain("expert_macos/");
  });
});
