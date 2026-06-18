import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-expert-import-test-")),
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

import {
  exportLocalExpertPack,
  importLocalExpertPack,
  listLocalExpertPacks,
  previewLocalExpertPack,
} from "../src/main/local-experts";
import { MACOS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/macos-pack";

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("local expert import/export", () => {
  it("exports a pack as a portable JSON envelope", () => {
    const target = join(TEST_HOME, "exports", "macos.json");

    const result = exportLocalExpertPack("macos", target);

    expect(result.ok).toBe(true);
    expect(result.packHash).toMatch(/^[a-f0-9]{64}$/);
    const exported = JSON.parse(readFileSync(target, "utf-8"));
    expect(exported).toMatchObject({
      schemaVersion: 1,
      packHash: result.packHash,
      pack: { id: "macos", title: "Mac Expert" },
    });
    expect(exported.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("imports a valid custom pack and lists it after built-ins", () => {
    const custom = {
      ...MACOS_LOCAL_EXPERT_PACK,
      id: "excel",
      title: "Excel Expert",
      domain: "excel",
      records: MACOS_LOCAL_EXPERT_PACK.records.slice(0, 1).map((record) => ({
        ...record,
        id: "excel-file-associations",
        topic: "excel.file_associations",
        tags: ["excel", "files"],
      })),
      recipe: {
        ...MACOS_LOCAL_EXPERT_PACK.recipe,
        name: "Excel Expert",
      },
    };
    const source = join(TEST_HOME, "excel-pack.json");
    writeFileSync(
      source,
      JSON.stringify({ schemaVersion: 1, pack: custom }, null, 2),
      "utf-8",
    );

    const preview = previewLocalExpertPack(source);
    const imported = importLocalExpertPack(source);
    const listed = listLocalExpertPacks();

    expect(preview.ok).toBe(true);
    expect(preview.canImport).toBe(true);
    expect(imported.ok).toBe(true);
    expect(
      existsSync(
        join(TEST_HOME, "sps-agent", "local-expert-packs", "excel.json"),
      ),
    ).toBe(true);
    expect(listed.packs.map((pack) => pack.id)).toEqual(["macos", "excel"]);
  });

  it("rejects imported packs that conflict with built-ins", () => {
    const source = join(TEST_HOME, "macos-copy.json");
    writeFileSync(
      source,
      JSON.stringify({ schemaVersion: 1, pack: MACOS_LOCAL_EXPERT_PACK }),
      "utf-8",
    );

    const result = importLocalExpertPack(source);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "conflicts with a built-in pack",
    );
  });
});
