import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { APP_LOCALES, sharedI18n } from "../../../../shared/i18n";
import { I18nContext } from "../../components/I18nContext";
import { MemoryProviders } from "./MemoryProviders";

describe.each(APP_LOCALES)("Memory provider hint (%s)", (locale) => {
  // @lat: [[desktop-security#Runtime security#Memory provider HTML boundary]]
  it.each(["honcho", '<img src=x onerror="alert(1)"> & &#60;custom&#62;'])(
    "renders provider names as literal text: %s",
    (provider) => {
      const i18n = sharedI18n.cloneInstance({
        lng: locale,
        initImmediate: false,
      });
      const { container } = render(
        <I18nextProvider i18n={i18n}>
          <I18nContext.Provider value={{ locale, setLocale: vi.fn() }}>
            <MemoryProviders
              providers={[]}
              activeProvider={provider}
              onRefresh={vi.fn()}
            />
          </I18nContext.Provider>
        </I18nextProvider>,
      );
      const hint = container.querySelector(".memory-providers-hint span");
      expect(hint?.querySelector("strong")?.textContent).toBe(provider);
      expect(hint?.querySelectorAll("*")).toHaveLength(1);
    },
  );
});
