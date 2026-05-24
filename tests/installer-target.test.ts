import { describe, expect, it } from "vitest";
import { classifyInstallTarget } from "../src/main/installer";

// Pre-install inspection (issue #272): classify what the installer will do
// to the target `hermes-agent` directory so the renderer can warn first.
describe("classifyInstallTarget", () => {
  it("reports a fresh install when nothing is at the target", () => {
    expect(classifyInstallTarget(false, false)).toBe("fresh");
    // repoIsGitRepo is meaningless when the directory doesn't exist.
    expect(classifyInstallTarget(false, true)).toBe("fresh");
  });

  it("reports an in-place update for an existing valid git checkout", () => {
    expect(classifyInstallTarget(true, true)).toBe("update");
  });

  it("reports a destructive replace when the dir is not a git repo", () => {
    // install.sh / install.ps1 delete-and-reclone a non-repo directory.
    expect(classifyInstallTarget(true, false)).toBe("replace");
  });
});
