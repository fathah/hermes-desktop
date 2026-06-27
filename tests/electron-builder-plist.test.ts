import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

// Guards a silent build-config footgun: electron-builder's mac.extendInfo must
// be a MAPPING. Written as a YAML list, electron-builder injects it under
// numeric keys ("0","1",...) instead of merging into Info.plist, so every macOS
// usage description is dropped — and Contacts (no Electron default) crashes the
// app on first access. See electron-builder.yml.
describe("electron-builder mac.extendInfo", () => {
  const root = join(__dirname, "..");
  const cfg = parseYaml(
    readFileSync(join(root, "electron-builder.yml"), "utf8"),
  );
  const extendInfo = cfg?.mac?.extendInfo;

  it("is a mapping, not a list (the list form silently drops every key)", () => {
    expect(Array.isArray(extendInfo)).toBe(false);
    expect(typeof extendInfo).toBe("object");
    expect(extendInfo).not.toBeNull();
  });

  it("every usage description is a plain string value", () => {
    for (const [key, value] of Object.entries(extendInfo)) {
      expect(typeof value, `${key} must be a string`).toBe("string");
      expect(
        (value as string).length,
        `${key} must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("declares the Contacts usage description (required or the app crashes on sync)", () => {
    expect(typeof extendInfo.NSContactsUsageDescription).toBe("string");
    expect(extendInfo.NSContactsUsageDescription.length).toBeGreaterThan(0);
  });

  it("declares the Contacts entitlement in the signing entitlements", () => {
    const entitlementsPath = cfg?.mac?.entitlements;
    expect(entitlementsPath).toBeTruthy();
    const plist = readFileSync(join(root, entitlementsPath), "utf8");
    expect(plist).toContain(
      "com.apple.security.personal-information.addressbook",
    );
  });
});
