// sps-storage.test.ts — the pure vault-location decision logic (no fs/profile
// coupling). The I/O wrappers are exercised by the app + the note-index proof.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { chooseVaultDir, isValidVaultDirInput } from "./sps-storage";

describe("isValidVaultDirInput", () => {
  it("rejects empty / whitespace", () => {
    expect(isValidVaultDirInput("").ok).toBe(false);
    expect(isValidVaultDirInput("   ").ok).toBe(false);
  });
  it("rejects a relative path", () => {
    const res = isValidVaultDirInput("relative/path");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/absolute/i);
  });
  it("accepts an absolute path", () => {
    expect(isValidVaultDirInput("/Users/me/Obsidian/sps").ok).toBe(true);
  });
});

describe("chooseVaultDir", () => {
  const def = "/home/profile/sps-agent/vault";
  it("uses the default when there is no override", () => {
    expect(chooseVaultDir(undefined, def)).toBe(def);
  });
  it("uses an absolute override", () => {
    expect(chooseVaultDir("/vaults/obsidian/sps", def)).toBe(
      "/vaults/obsidian/sps",
    );
  });
  it("ignores a non-absolute override (falls back to default)", () => {
    expect(chooseVaultDir("not/absolute", def)).toBe(def);
  });
  it("canonicalizes an existing absolute override", () => {
    const dir = mkdtempSync(join(tmpdir(), "sps-storage-"));
    const target = join(dir, "target");
    const link = join(dir, "link");
    try {
      mkdirSync(target);
      symlinkSync(target, link);
      expect(chooseVaultDir(link, def)).toBe(realpathSync(target));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
