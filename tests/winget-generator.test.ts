import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "fs";
import { tmpdir } from "os";
// @ts-expect-error - .mjs has no type declarations; we test it as JS.
import { generateWingetManifests } from "../scripts/generate-winget-manifests.mjs";

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), "winget-test-"));
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function setupTemplates(rootDir: string): void {
  const buildDir = join(rootDir, "build", "winget");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(
    join(buildDir, "Installer.template.yaml"),
    "Version: {{VERSION}}\nUrl: {{INSTALLER_URL}}\nSha: {{INSTALLER_SHA256}}\nDate: {{RELEASE_DATE}}\n",
  );
  writeFileSync(
    join(buildDir, "Locale.en-US.template.yaml"),
    "Version: {{VERSION}}\nNotes: {{RELEASE_NOTES_URL}}\n",
  );
  writeFileSync(
    join(buildDir, "Version.template.yaml"),
    "Version: {{VERSION}}\n",
  );
}

describe("generateWingetManifests", () => {
  it("produces three YAML files under the winget-pkgs directory layout", () => {
    setupTemplates(TEST_DIR);
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    generateWingetManifests({
      rootDir: TEST_DIR,
      version: "9.9.9",
      name: "hermes-desktop",
      publishOwner: "fathah",
    });

    const outDir = join(
      distDir,
      "winget",
      "manifests",
      "n",
      "NousResearch",
      "HermesDesktop",
      "9.9.9",
    );
    expect(
      existsSync(join(outDir, "NousResearch.HermesDesktop.installer.yaml")),
    ).toBe(true);
    expect(
      existsSync(join(outDir, "NousResearch.HermesDesktop.locale.en-US.yaml")),
    ).toBe(true);
    expect(existsSync(join(outDir, "NousResearch.HermesDesktop.yaml"))).toBe(
      true,
    );
  });

  it("replaces all placeholders in the installer manifest", () => {
    setupTemplates(TEST_DIR);
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    generateWingetManifests({
      rootDir: TEST_DIR,
      version: "9.9.9",
      name: "hermes-desktop",
      publishOwner: "fathah",
    });

    const outFile = join(
      distDir,
      "winget",
      "manifests",
      "n",
      "NousResearch",
      "HermesDesktop",
      "9.9.9",
      "NousResearch.HermesDesktop.installer.yaml",
    );
    const content = readFileSync(outFile, "utf-8");
    expect(content).toContain("Version: 9.9.9");
    expect(content).toContain(
      "Url: https://github.com/fathah/hermes-desktop/releases/download/v9.9.9/hermes-desktop-9.9.9-setup.exe",
    );
    expect(content).toMatch(/Sha: [A-F0-9]{64}/);
    expect(content).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(content).not.toContain("{{");
  });

  it("replaces ReleaseNotesUrl in the locale manifest", () => {
    setupTemplates(TEST_DIR);
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    generateWingetManifests({
      rootDir: TEST_DIR,
      version: "9.9.9",
      name: "hermes-desktop",
      publishOwner: "fathah",
    });

    const outFile = join(
      distDir,
      "winget",
      "manifests",
      "n",
      "NousResearch",
      "HermesDesktop",
      "9.9.9",
      "NousResearch.HermesDesktop.locale.en-US.yaml",
    );
    const content = readFileSync(outFile, "utf-8");
    expect(content).toContain(
      "Notes: https://github.com/fathah/hermes-desktop/releases/tag/v9.9.9",
    );
    expect(content).not.toContain("{{");
  });

  it("throws a clear error when the installer .exe is missing", () => {
    setupTemplates(TEST_DIR);
    mkdirSync(join(TEST_DIR, "dist"), { recursive: true });

    expect(() =>
      generateWingetManifests({
        rootDir: TEST_DIR,
        version: "9.9.9",
        name: "hermes-desktop",
        publishOwner: "fathah",
      }),
    ).toThrow(/installer not found/i);
  });

  it("throws a clear error when the templates directory is missing", () => {
    // Do NOT call setupTemplates — the templates directory should not exist.
    const distDir = join(TEST_DIR, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hermes-desktop-9.9.9-setup.exe"),
      "fake-installer-bytes",
    );

    expect(() =>
      generateWingetManifests({
        rootDir: TEST_DIR,
        version: "9.9.9",
        name: "hermes-desktop",
        publishOwner: "fathah",
      }),
    ).toThrow(/templates not found/i);
  });
});
