import { act, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  DEFAULT_ACTIVE_LOCALE,
  setLocale as setSharedLocale,
  type AppLocale,
} from "../../../shared/i18n";
import { I18nProvider } from "./I18nProvider";
import { useI18n } from "./useI18n";

function Probe(): React.JSX.Element {
  const { t } = useI18n();
  return <div>{t("welcome.title")}</div>;
}

function installHermesAPI(
  api: Pick<Window["hermesAPI"], "getLocale" | "setLocale">,
): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
}

describe("I18nProvider", () => {
  const getLocale = vi.fn().mockResolvedValue(DEFAULT_ACTIVE_LOCALE);
  const setLocale = vi.fn().mockResolvedValue(DEFAULT_ACTIVE_LOCALE);

  beforeEach(() => {
    installHermesAPI({
      getLocale,
      setLocale,
    });
    getLocale.mockClear();
    setLocale.mockClear();
    getLocale.mockResolvedValue(DEFAULT_ACTIVE_LOCALE);
    setLocale.mockResolvedValue(DEFAULT_ACTIVE_LOCALE);
  });

  afterEach(() => {
    setSharedLocale(DEFAULT_ACTIVE_LOCALE);
    try {
      localStorage.removeItem("hermes-locale");
    } catch {
      /* ignore */
    }
  });

  it("renders English translations by default", async () => {
    await act(async () => {
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
    });

    expect(await screen.findByText("Welcome to SPS")).toBeInTheDocument();
  });

  it("falls back to English when localStorage contains a stale locale", async () => {
    localStorage.setItem("hermes-locale", "es");

    await act(async () => {
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
    });

    expect(await screen.findByText("Welcome to SPS")).toBeInTheDocument();
    expect(setLocale).toHaveBeenLastCalledWith("en");
  });

  it("does not overwrite the main-process locale with the startup fallback", async () => {
    let resolveMainLocale: (locale: AppLocale) => void = () => {};
    getLocale.mockReturnValue(
      new Promise<AppLocale>((resolve) => {
        resolveMainLocale = resolve;
      }),
    );

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    await act(async () => {});

    expect(setLocale).not.toHaveBeenCalled();

    await act(async () => {
      resolveMainLocale("en");
    });

    expect(setLocale).toHaveBeenLastCalledWith("en");
    expect(await screen.findByText("Welcome to SPS")).toBeInTheDocument();
  });

  it("normalizes a stale main-process locale to English", async () => {
    getLocale.mockResolvedValue("es" as AppLocale);

    await act(async () => {
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
    });

    expect(await screen.findByText("Welcome to SPS")).toBeInTheDocument();
    expect(setLocale).toHaveBeenLastCalledWith("en");
  });
});
