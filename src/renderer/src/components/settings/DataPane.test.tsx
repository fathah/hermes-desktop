import { render } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
  openclawPath: 'C:\\"><img src=x onerror="alert(1)">',
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

beforeAll(async () => {
  await i18next.init({
    lng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: {
        translation: {
          settings: {
            migrationDesc:
              "Found OpenClaw at <code>{{path}}</code>. You can migrate your data.",
          },
        },
      },
    },
  });
});

describe("DataPane migration banner", () => {
  it("renders the detected path as text instead of HTML", () => {
    const { container } = render(
      <I18nextProvider i18n={i18next}>
        <I18nContext.Provider value={{ locale: "en", setLocale: vi.fn() }}>
          <DataPane />
        </I18nContext.Provider>
      </I18nextProvider>,
    );

    expect(container.querySelector(".settings-migration-desc img")).toBeNull();
    expect(
      container.querySelector(".settings-migration-desc code"),
    ).toHaveTextContent(settings.openclawPath);
  });
});
