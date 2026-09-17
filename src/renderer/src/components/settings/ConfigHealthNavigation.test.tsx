import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConfigHealthBanner } from "../ConfigHealthBanner";
import { SettingsModalProvider } from "./SettingsModalProvider";
import { useSettingsModal } from "./SettingsModalContext";

vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./useSettingsData", () => ({
  useSettingsData: (profile?: string) => ({ profile, hermesVersion: null }),
}));

function Entry({
  profile = "research",
}: {
  profile?: string;
}): React.JSX.Element {
  const { openSettings } = useSettingsModal();
  return (
    <ConfigHealthBanner
      profile={profile}
      onOpenDiagnose={(section?: string) => openSettings(section, { profile })}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfigHealth: vi
        .fn()
        .mockImplementation(async (profile = "default") => ({
          ranAt: Date.now(),
          profile,
          issues: [
            {
              code: "EMPTY_API_SERVER_KEY",
              severity: "warning",
              message: `Missing key for ${profile}`,
              locations: [],
              autoFixable: false,
            },
          ],
          summary: { errors: 0, warnings: 1, infos: 0 },
        })),
    },
  });
});

// @lat: [[config-health-navigation#Banner opens scoped details]]
it("opens the current profile's configuration details from a real banner click", async () => {
  render(
    <SettingsModalProvider>
      <Entry />
    </SettingsModalProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "diagnose.banner.showDetails" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Missing key for research")).toBeVisible(),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
});

// @lat: [[config-health-navigation#Repeated details navigation]]
it("allows repeated details navigation without creating duplicate dialogs", async () => {
  render(
    <SettingsModalProvider>
      <Entry />
    </SettingsModalProvider>,
  );
  const details = await screen.findByRole("button", {
    name: "diagnose.banner.showDetails",
  });
  fireEvent.click(details);
  await screen.findByText("Missing key for research");
  fireEvent.click(details);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await waitFor(() =>
    expect(screen.getByText("Missing key for research")).toBeVisible(),
  );
});
