import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeAsset,
  assetExists,
  resolveAssetPath,
  gcAssets,
  isValidAssetName,
  sanitizeExt,
  ASSETS_DIR,
} from "./sps-assets";

let vault: string;

beforeEach(async () => {
  vault = await fs.mkdtemp(join(tmpdir(), "sps-assets-"));
});
afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe("sanitizeExt", () => {
  it("normalizes to a safe lowercase .ext", () => {
    expect(sanitizeExt("WEBM")).toBe(".webm");
    expect(sanitizeExt(".JPG")).toBe(".jpg");
    expect(sanitizeExt("../../etc")).toBe(".etc");
    expect(sanitizeExt("")).toBe(".bin");
  });
});

describe("isValidAssetName", () => {
  it("accepts sha256 + ext only", () => {
    const ok = `${"a".repeat(64)}.webm`;
    expect(isValidAssetName(ok)).toBe(true);
    expect(isValidAssetName("../escape.jpg")).toBe(false);
    expect(isValidAssetName("short.jpg")).toBe(false);
    expect(isValidAssetName(`${"a".repeat(64)}.toolongextension`)).toBe(false);
  });
});

describe("writeAsset", () => {
  it("writes content-addressed and de-dupes identical bytes", async () => {
    const bytes = Buffer.from("hello world");
    const name1 = await writeAsset(vault, bytes, "txt");
    const name2 = await writeAsset(vault, bytes, "txt");
    expect(name1).toBe(name2); // same content → same name
    expect(isValidAssetName(name1)).toBe(true);
    expect(existsSync(join(vault, ASSETS_DIR, name1))).toBe(true);
    expect(assetExists(vault, name1)).toBe(true);
  });

  it("different content yields different names", async () => {
    const a = await writeAsset(vault, Buffer.from("a"), "bin");
    const b = await writeAsset(vault, Buffer.from("b"), "bin");
    expect(a).not.toBe(b);
  });
});

describe("resolveAssetPath", () => {
  it("rejects malformed names (traversal-proof)", () => {
    expect(resolveAssetPath(vault, "../../secret")).toBeNull();
    const good = `${"f".repeat(64)}.png`;
    expect(resolveAssetPath(vault, good)).toBe(join(vault, ASSETS_DIR, good));
  });
});

describe("gcAssets", () => {
  it("deletes unreferenced assets, keeps referenced + foreign files", async () => {
    const keep = await writeAsset(vault, Buffer.from("keep"), "txt");
    const drop = await writeAsset(vault, Buffer.from("drop"), "txt");
    // a foreign (non-asset-shaped) file must never be touched
    await fs.writeFile(join(vault, ASSETS_DIR, "README.txt"), "hi");

    const removed = await gcAssets(vault, [keep]);

    expect(removed).toBe(1);
    expect(assetExists(vault, keep)).toBe(true);
    expect(assetExists(vault, drop)).toBe(false);
    expect(existsSync(join(vault, ASSETS_DIR, "README.txt"))).toBe(true);
  });

  it("returns 0 when there is no _assets dir", async () => {
    expect(await gcAssets(vault, [])).toBe(0);
  });
});
