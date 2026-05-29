import { describe, expect, it } from "vitest";
import { join, resolve, normalize, sep } from "path";
import { homedir, tmpdir } from "os";

function isPathUnderRoot(resolvedTarget: string, root: string): boolean {
  const resolvedRoot = normalize(resolve(root));
  if (resolvedTarget === resolvedRoot) return true;
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedTarget.startsWith(rootPrefix);
}

function isPathAllowed(target: string, allowedRoots: string[]): boolean {
  const resolved = normalize(resolve(target));
  return allowedRoots.some((root) => isPathUnderRoot(resolved, root));
}

describe("files path sandbox", () => {
  const home = homedir();
  const roots = [home, process.cwd()];

  it("allows paths inside home directory", () => {
    expect(isPathAllowed(join(home, "Projects", "file.txt"), roots)).toBe(true);
  });

  it("rejects sibling paths that share a prefix with home", () => {
    const sibling = `${home}-admin`;
    expect(isPathAllowed(join(sibling, "file.txt"), roots)).toBe(false);
  });

  it("allows the home directory itself", () => {
    expect(isPathAllowed(home, roots)).toBe(true);
  });

  it("rejects paths outside allowed roots", () => {
    expect(isPathAllowed(join(tmpdir(), "outside.txt"), roots)).toBe(false);
  });
});
