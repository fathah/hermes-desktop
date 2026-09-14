import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { APP_LOCALES, sharedI18n } from "../../../../shared/i18n";
import { I18nContext } from "../I18nContext";
import DataPane from "./DataPane";

const settings = vi.hoisted(() => ({
  backingUp: false,
  backupResult: null,
  importing: false,
  importResult: null,
  handleBackup: vi.fn(),
  handleImport: vi.fn(),
  openclawFound: true,
  openclawPath: "",
  migrationDismissed: false,
  migrating: false,
  migrationLog: null,
  migrationResult: null,
  migrationResultType: null,
  migrationLogRef: { current: null },
  handleMigrate: vi.fn(),
  handleDismissMigration: vi.fn(),
}));

vi.mock("./SettingsDataContext", () => ({ useSettings: () => settings }));

describe.each(APP_LOCALES)("DataPane migration banner (%s)", (locale) => {
  // @lat: [[sidebar-navigation#Settings modal#Migration path rendering]]
  it.each([
    "/home/alice/.openclaw",
    "C:\\Users\\Alice & Bob\\.openclaw",
    '/home/<img src=x onerror="alert(1)">/.openclaw',
    "/home/O'Brien & &#60;img&#62;/.openclaw",
    "/home/  two spaces  /$t(settings.migrationDetected)/.openclaw",
  ])("preserves the exact path as text: %s", (path) => {
    settings.openclawPath = path;
    const i18n = sharedI18n.cloneInstance({
      lng: locale,
      initImmediate: false,
    });
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <I18nContext.Provider value={{ locale, setLocale: vi.fn() }}>
          <DataPane />
        </I18nContext.Provider>
      </I18nextProvider>,
    );

    const description = container.querySelector(".settings-migration-desc");
    const code = description?.querySelector("code");
    expect(code?.textContent).toBe(path);
    expect(code?.childElementCount).toBe(0);
    expect(description?.querySelectorAll("*")).toHaveLength(1);
  });
});
