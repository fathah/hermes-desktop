// @vitest-environment node
import { readFileSync } from "fs";
import { join } from "path";
import { load } from "js-yaml";
import { DebugLogger } from "builder-util";
import { AppInfo } from "app-builder-lib/out/appInfo";
import type { Packager } from "app-builder-lib/out/packager";
import type { Configuration } from "app-builder-lib/out/configuration";
import { validateConfiguration } from "app-builder-lib/out/util/config/config";
import { expandMacro } from "app-builder-lib/out/util/macroExpander";
import { installPrefix } from "app-builder-lib/out/targets/LinuxTargetHelper";
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

  it("keeps the Linux install and sandbox hook paths aligned without spaces", () => {
    const app = new AppInfo(packager, undefined, config.linux);
    const installPath = `${installPrefix}/${app.sanitizedProductName}`;
    expect(installPath).toBe("/opt/HermesOne");
    expect(
      readFileSync(join(root, "build/linux-after-install.sh"), "utf8"),
    ).toContain(`SANDBOX="${installPath}/chrome-sandbox"`);
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
