import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

let home = "";
let work = "";

async function loadGrants(): Promise<
  typeof import("../src/main/file-access-grants")
> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return import("../src/main/file-access-grants");
}

describe("file access grants", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-grants-home-"));
    work = mkdtempSync(join(tmpdir(), "hermes-grants-work-"));
  });

  afterEach(() => {
    delete process.env.HERMES_HOME;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  it("allows files and subdirectories under a user-granted directory", async () => {
    const dir = join(work, "project");
    const subdir = join(dir, "src");
    const file = join(subdir, "index.ts");
    mkdirSync(subdir, { recursive: true });
    writeFileSync(file, "console.log('ok')", "utf-8");

    const grants = await loadGrants();
    grants.grantDirectoryPath(dir);

    expect(grants.assertGrantedDirectoryPath(subdir)).toBe(
      realpathSync(subdir),
    );
    expect(grants.assertGrantedFilePath(file)).toBe(realpathSync(file));
  });

  it("rejects ungranted files", async () => {
    const file = join(work, "secret.txt");
    writeFileSync(file, "secret", "utf-8");

    const grants = await loadGrants();
    expect(() => grants.assertGrantedFilePath(file)).toThrow(/not granted/i);
  });

  it("keeps exact file grants scoped to that file", async () => {
    const granted = join(work, "picked.pdf");
    const sibling = join(work, "sibling.pdf");
    writeFileSync(granted, "%PDF", "utf-8");
    writeFileSync(sibling, "%PDF", "utf-8");

    const grants = await loadGrants();
    grants.grantFilePath(granted);

    expect(grants.assertGrantedFilePath(granted)).toBe(realpathSync(granted));
    expect(() => grants.assertGrantedFilePath(sibling)).toThrow(/not granted/i);
  });

  it("uses realpaths so a symlink cannot escape a granted directory", async () => {
    const dir = join(work, "project");
    const outside = join(work, "outside.txt");
    const link = join(dir, "linked-secret.txt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(outside, "secret", "utf-8");
    try {
      symlinkSync(outside, link);
    } catch {
      return;
    }

    const grants = await loadGrants();
    grants.grantDirectoryPath(dir);

    expect(() => grants.assertGrantedFilePath(link)).toThrow(/not granted/i);
  });
});
