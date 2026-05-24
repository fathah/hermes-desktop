import { act, fireEvent, render, screen } from "@testing-library/react";
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

function LocaleSwitcherProbe(): React.JSX.Element {
  const { t, setLocale } = useI18n();

  return (
    <>
      <button onClick={() => setLocale("es")}>Switch to Spanish</button>
      <div>{t("welcome.title")}</div>
    </>
  );
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

    expect(await screen.findByText("Welcome to Hermes")).toBeInTheDocument();
  });

  it("renders Spanish translations after switching locale", async () => {
    render(
      <I18nProvider>
        <LocaleSwitcherProbe />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to Spanish" }),
      );
    });

    expect(setLocale).toHaveBeenLastCalledWith("es");
    expect(await screen.findByText("Bienvenido a Hermes")).toBeInTheDocument();
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
      resolveMainLocale("es");
    });

    expect(setLocale).toHaveBeenLastCalledWith("es");
    expect(await screen.findByText("Bienvenido a Hermes")).toBeInTheDocument();
  });
});
