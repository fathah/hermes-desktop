import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "./I18nProvider";
import {
  ChatPreferencesProvider,
  useChatPreferences,
} from "./ChatPreferencesProvider";
import LanguagePane from "./settings/LanguagePane";
import NotificationsPane from "./settings/NotificationsPane";

const getSpellCheckerInfo = vi.fn(async () => ({
  available: ["en-US", "nl-NL"],
  selected: ["en-US"],
  system: ["en-US"],
}));
const setSpellCheckerLanguages = vi.fn(
  async (languages: string[]) => languages,
);

function Wrapper({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <I18nProvider>
      <ChatPreferencesProvider>{children}</ChatPreferencesProvider>
    </I18nProvider>
  );
}

function SpellcheckState(): React.JSX.Element {
  const preferences = useChatPreferences();
  return <output>{preferences.spellcheckLanguages.join(",")}</output>;
}

describe("chat preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    getSpellCheckerInfo.mockClear();
    setSpellCheckerLanguages.mockClear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { getSpellCheckerInfo, setSpellCheckerLanguages },
    });
  });

  it("persists the master completion-sound switch", () => {
    render(
      <Wrapper>
        <NotificationsPane />
      </Wrapper>,
    );

    const toggle = screen.getByRole("checkbox", {
      name: "Play a sound when a response finishes",
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem("hermes.preferences.completionSound")).toBe(
      "false",
    );
  });

  it("applies multiple validated dictionaries and can disable spellcheck", async () => {
    render(
      <Wrapper>
        <LanguagePane />
        <SpellcheckState />
      </Wrapper>,
    );

    await waitFor(() => expect(getSpellCheckerInfo).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(setSpellCheckerLanguages).toHaveBeenCalledWith(["en-US"]),
    );

    fireEvent.click(
      screen.getByRole("radio", { name: /Choose spellcheck languages/i }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "nl-NL" }));
    await waitFor(() =>
      expect(setSpellCheckerLanguages).toHaveBeenLastCalledWith([
        "en-US",
        "nl-NL",
      ]),
    );
    expect(screen.getByRole("status")).toHaveTextContent("en-US,nl-NL");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable spellcheck" }),
    );
    await waitFor(() =>
      expect(setSpellCheckerLanguages).toHaveBeenLastCalledWith([]),
    );
  });
});
