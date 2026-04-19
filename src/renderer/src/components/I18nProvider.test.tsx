import { render, screen } from "@testing-library/react";
import { I18nProvider } from "./I18nProvider";
import { useI18n } from "./useI18n";

function Probe(): React.JSX.Element {
  const { t } = useI18n();
  return <div>{t("welcome.title")}</div>;
}

describe("I18nProvider", () => {
  it("renders English translations by default", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByText("Welcome to Hermes")).toBeInTheDocument();
  });
});
