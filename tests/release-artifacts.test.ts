import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

describe("Linux release artifacts", () => {
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

describe("Release quality gates", () => {
  // @lat: [[desktop-updates#Stable and beta release channels#Release security and quality gates]]
  it("blocks CI on high-severity production advisories and lint warnings", () => {
    const packageJson = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf-8"),
    ) as { scripts: Record<string, string> };
    const workflow = readFileSync(
      join(ROOT, ".github/workflows/ci.yml"),
      "utf-8",
    );

    expect(packageJson.scripts["audit:prod"]).toBe(
      "npm audit --omit=dev --audit-level=high",
    );
    expect(packageJson.scripts.lint).toContain("--max-warnings=0");
    expect(packageJson.scripts.test).toContain("--maxWorkers=4");
    expect(packageJson.scripts.postinstall).toContain("install-electron --no");
    expect(workflow).toContain("run: npm run audit:prod");
    expect(workflow).toContain("run: npm run lint");
    expect(workflow).not.toMatch(
      /- name: Lint\s+run: npm run lint\s+continue-on-error: true/,
    );
  });

  // @lat: [[desktop-updates#Stable and beta release channels#macOS signing keychain]]
  it.each([
    ["stable", ".github/workflows/release.yml", "release_mac"],
    ["beta", ".github/workflows/beta-release.yml", "beta_mac"],
  ])(
    "imports the %s macOS certificate into an explicit keychain",
    (_channel, workflow, jobName) => {
      const source = readFileSync(join(ROOT, workflow), "utf-8");
      const packageStep = source.match(
        /- name: Package macOS artifacts[\s\S]*?(?=\n\s+- name:)/,
      )?.[0];

      expect(source).toContain("run: bash scripts/import-macos-certificate.sh");
      expect(source).toContain('security delete-keychain "$CSC_KEYCHAIN"');
      expect(source).toMatch(
        new RegExp(`${jobName}:[\\s\\S]*?strategy:\\s*\\n\\s+fail-fast: false`),
      );
      expect(packageStep).toBeDefined();
      expect(packageStep).not.toContain("CSC_LINK:");
      expect(packageStep).not.toContain("CSC_KEY_PASSWORD:");
    },
  );
});
