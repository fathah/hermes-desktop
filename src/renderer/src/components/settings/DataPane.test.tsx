import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DataPane from "./DataPane";

// Mimic i18next configured with escapeValue: false (see src/shared/i18n/index.ts):
// interpolated values land in the returned string raw, so any runtime value a
// pane passes through t() ends up unescaped in markup rendered via
// dangerouslySetInnerHTML.
const rawTemplate =
  "Found OpenClaw at <code>{{path}}</code>. You can migrate your configuration.";

vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      key === "settings.migrationDesc"
        ? rawTemplate.replace("{{path}}", opts?.path ?? "")
        : key,
  }),
}));

const settings = vi.hoisted(() => ({ openclawPath: "" }));

vi.mock("./SettingsDataContext", () => ({
  useSettings: () => ({
    backingUp: false,
    backupResult: null,
    importing: false,
    importResult: null,
    handleBackup: vi.fn(),
    handleImport: vi.fn(),
    openclawFound: true,
    openclawPath: settings.openclawPath,
    migrationDismissed: false,
    migrating: false,
    migrationLog: null,
    migrationResult: null,
    migrationResultType: null,
    migrationLogRef: { current: null },
    handleMigrate: vi.fn(),
    handleDismissMigration: vi.fn(),
  }),
}));

describe("DataPane migration banner", () => {
  beforeEach(() => {
    settings.openclawPath = "";
  });

  it("renders a normal path inside the trusted <code> wrapper", () => {
    settings.openclawPath = "C:\\Users\\dev\\.openclaw";
    const { container } = render(<DataPane />);
    const desc = container.querySelector(".settings-migration-desc");
    expect(desc).not.toBeNull();
    expect(desc!.querySelector("code")?.textContent).toBe(
      "C:\\Users\\dev\\.openclaw",
    );
  });

  it("never injects HTML from the discovered OpenClaw path (#913)", () => {
    settings.openclawPath = 'C:\\Users\\<img src=x onerror=alert(1)>\\.openclaw';
    const { container } = render(<DataPane />);
    const desc = container.querySelector(".settings-migration-desc");
    expect(desc).not.toBeNull();
    // The malicious payload must survive as inert text, not become a live tag.
    expect(desc!.innerHTML).not.toContain("<img");
    expect(desc!.innerHTML).toContain("&lt;img src=x");
    // The trusted translation markup is still real HTML.
    expect(desc!.querySelector("code")).not.toBeNull();
  });
});
