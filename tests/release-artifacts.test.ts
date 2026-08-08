import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

describe("Linux release artifacts", () => {
  // @lat: [[desktop-updates#Linux package sandboxing]]
  it("uses electron-builder's AppArmor-aware package install hook", () => {
    const config = readFileSync(join(ROOT, "electron-builder.yml"), "utf-8");

    // A custom afterInstall replaces electron-builder's default hook. Its
    // default installs an AppArmor userns profile before considering SUID;
    // forcing SUID breaks Chromium when productName creates a spaced /opt path.
    expect(config).not.toContain("afterInstall:");
    expect(config).not.toContain("--no-sandbox");
  });

  it("includes the target architecture in every AppImage filename", () => {
    const config = readFileSync(join(ROOT, "electron-builder.yml"), "utf-8");

    expect(config).toMatch(
      /appImage:\s*\n\s+artifactName: \$\{name\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/,
    );
  });

  it.each([
    ["stable", ".github/workflows/release.yml", "latest-linux-arm64.yml"],
    ["beta", ".github/workflows/beta-release.yml", "beta-linux-arm64.yml"],
  ])("publishes the %s arm64 update feed", (_channel, workflow, feed) => {
    const source = readFileSync(join(ROOT, workflow), "utf-8");

    expect(source).toContain(`dist/${feed}`);
  });
});
