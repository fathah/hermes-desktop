// @vitest-environment node
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { load } from "js-yaml";
import { DebugLogger } from "builder-util";
import { AppInfo } from "app-builder-lib/out/appInfo";
import type { Packager } from "app-builder-lib/out/packager";
import type { Configuration } from "app-builder-lib/out/configuration";
import { validateConfiguration } from "app-builder-lib/out/util/config/config";
import { expandMacro } from "app-builder-lib/out/util/macroExpander";
import { installPrefix } from "app-builder-lib/out/targets/LinuxTargetHelper";
import {
  getMainFileMatchers,
  getNodeModuleFileMatcher,
} from "app-builder-lib/out/fileMatcher";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const config = load(
  readFileSync(join(root, "electron-builder.yml"), "utf8"),
) as Configuration;
const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packager = { config, metadata } as Packager;

describe("platform packaging identity", () => {
  it("accepts the configuration with the installed builder schema", async () => {
    await expect(
      validateConfiguration(config, new DebugLogger()),
    ).resolves.toBeUndefined();
  });

  // @lat: [[desktop-updates#Stable and beta release channels#Production package contents]]
  it("packages built application files without development material or local configuration", () => {
    const info = {
      ...packager,
      projectDir: root,
      buildResourcesDir: config.directories!.buildResources!,
      debugLogger: new DebugLogger(),
    } as Packager;
    const destination = join(root, "dist", "fixture", "resources", "app");
    const mainMatchers = getMainFileMatchers(
      root,
      destination,
      (value) => value,
      {},
      { info } as Parameters<typeof getMainFileMatchers>[4],
      join(root, "dist"),
      false,
    )!;
    const filter = mainMatchers[0].createFilter();
    const fileStat = statSync(join(root, "package.json"));
    for (const file of [
      "package.json",
      "LICENSE",
      "out/main/index.js",
      "out/main/chunks/helper.js",
      "out/preload/index.js",
      "out/preload/askpass.js",
      "out/renderer/index.html",
      "out/renderer/assets/chat.js",
      "out/renderer/assets/office.glb",
      "resources/icon.png",
    ]) {
      expect(filter(join(root, file), fileStat), file).toBe(true);
    }
    for (const file of [
      ".agents/skills/electron-pro/SKILL.md",
      ".codex/config.toml",
      ".claude/settings.json",
      ".sandbox/hermes/.env",
      ".env",
      ".env.production",
      ".npmrc",
      "src/main/index.ts",
      "tests/installer-download.test.ts",
      "apps/tauri/package.json",
      "docs/releases/v0.7.8.md",
      "lat.md/desktop-updates.md",
      "scripts/verify-agent-chat.mjs",
      "previews/chat.png",
      "resources/.env",
      "out/.env.local",
    ]) {
      expect(filter(join(root, file), fileStat), file).toBe(false);
    }
    const dependencyFilter = getNodeModuleFileMatcher(
      root,
      destination,
      (value) => value,
      {},
      info,
    ).createFilter();
    expect(
      dependencyFilter(
        join(root, "node_modules/better-sqlite3/prebuilds/darwin-arm64.node"),
        fileStat,
      ),
    ).toBe(true);
  });

  // @lat: [[desktop-updates#Desktop Updates#Stable and beta release channels#Platform package identity]]
  it("retains the macOS bundle name used by release verification", () => {
    const app = new AppInfo(packager, undefined, config.mac);
    expect(`${app.productFilename}.app`).toBe("Hermes One.app");
    const verifier = readFileSync(
      join(root, "scripts/verify-native-module-architecture.sh"),
      "utf8",
    );
    expect(verifier).toContain(`${app.productFilename}.app`);
  });

  it("keeps the Linux install path space-free and delegates package setup to the builder", () => {
    const app = new AppInfo(packager, undefined, config.linux);
    const installPath = `${installPrefix}/${app.sanitizedProductName}`;
    expect(installPath).toBe("/opt/HermesOne");
    expect(config.deb?.afterInstall).toBeUndefined();
    expect(config.rpm?.afterInstall).toBeUndefined();
  });

  it("produces an RPM filename matched by release upload globs", () => {
    const app = new AppInfo(packager, undefined, config.linux);
    const filename = expandMacro(config.rpm!.artifactName!, "x64", app, {
      ext: "rpm",
      os: "linux",
    });
    expect(filename).toBe(`${metadata.name}-${metadata.version}.rpm`);
  });
});
