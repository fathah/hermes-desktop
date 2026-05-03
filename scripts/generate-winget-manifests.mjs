// scripts/generate-winget-manifests.mjs
//
// Fills the YAML templates in build/winget/ with the current version,
// installer URL, and SHA256 of the NSIS installer in dist/, and writes
// the result under dist/winget/manifests/n/NousResearch/HermesDesktop/<version>/.
//
// Run from CLI: VERSION=0.2.3 PUBLISH_OWNER=fathah node scripts/generate-winget-manifests.mjs
// Or import as ESM and call generateWingetManifests({ rootDir, version, name, publishOwner }).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function generateWingetManifests({
  rootDir,
  version,
  name,
  publishOwner,
}) {
  const exePath = join(rootDir, "dist", `${name}-${version}-setup.exe`);
  if (!existsSync(exePath)) {
    throw new Error(
      `NSIS installer not found at ${exePath}. ` +
        `Run electron-builder --win nsis first, or download the windows-artifacts CI artifact into dist/.`,
    );
  }

  const sha256 = createHash("sha256")
    .update(readFileSync(exePath))
    .digest("hex")
    .toUpperCase();
  const releaseDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const installerUrl = `https://github.com/${publishOwner}/hermes-desktop/releases/download/v${version}/${name}-${version}-setup.exe`;
  const releaseNotesUrl = `https://github.com/${publishOwner}/hermes-desktop/releases/tag/v${version}`;

  const replacements = {
    VERSION: version,
    INSTALLER_URL: installerUrl,
    INSTALLER_SHA256: sha256,
    RELEASE_DATE: releaseDate,
    RELEASE_NOTES_URL: releaseNotesUrl,
  };

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const fillTemplate = (str) =>
    Object.entries(replacements).reduce(
      (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
      str,
    );

  const templateDir = join(rootDir, "build", "winget");
  if (!existsSync(templateDir)) {
    throw new Error(
      `Winget templates not found at ${templateDir}. ` +
        `This script must be run from the repo root.`,
    );
  }
  const outDir = join(
    rootDir,
    "dist",
    "winget",
    "manifests",
    "n",
    "NousResearch",
    "HermesDesktop",
    version,
  );
  mkdirSync(outDir, { recursive: true });

  const files = [
    ["Installer.template.yaml", "NousResearch.HermesDesktop.installer.yaml"],
    [
      "Locale.en-US.template.yaml",
      "NousResearch.HermesDesktop.locale.en-US.yaml",
    ],
    ["Version.template.yaml", "NousResearch.HermesDesktop.yaml"],
  ];

  for (const [tmplName, outName] of files) {
    const tmpl = readFileSync(join(templateDir, tmplName), "utf-8");
    writeFileSync(join(outDir, outName), fillTemplate(tmpl));
  }

  return { outDir, sha256, installerUrl };
}

// CLI entrypoint
const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const rootDir = process.cwd();
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
  const result = generateWingetManifests({
    rootDir,
    version: process.env.VERSION || pkg.version,
    name: pkg.name,
    publishOwner: process.env.PUBLISH_OWNER || "fathah",
  });
  console.log(`Winget manifests generated in ${result.outDir}`);
  console.log(`InstallerSha256: ${result.sha256}`);
  console.log(`InstallerUrl: ${result.installerUrl}`);
}
