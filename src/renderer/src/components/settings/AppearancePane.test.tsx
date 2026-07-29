import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppearancePane from "./AppearancePane";

const theme = vi.hoisted(() => ({
  theme: "system",
  resolved: "light",
  setTheme: vi.fn(),
  rounded: true,
  setRounded: vi.fn(),
}));

vi.mock("../ThemeProvider", () => ({ useTheme: () => theme }));
vi.mock("../FontProvider", () => ({
  useFont: () => ({ font: "manrope", setFont: vi.fn() }),
}));
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("AppearancePane themes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    theme.theme = "system";
    theme.resolved = "light";
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getGpuStatus: vi.fn().mockRejectedValue(new Error("unavailable")),
      },
    });
  });

  it("shows the active system choice and lets users select it", () => {
    // @lat: [[theme-selection#Tests#Appearance exposes the system choice]]
    const { rerender } = render(<AppearancePane />);
    const systemChoice = screen.getByRole("button", {
      name: /settings\.theme\.system/,
    });

    expect(systemChoice).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("settings.theme.light")).toBeTruthy();

    theme.theme = "dark";
    rerender(<AppearancePane />);
    fireEvent.click(
      screen.getByRole("button", { name: /settings\.theme\.system/ }),
    );

    expect(theme.setTheme).toHaveBeenCalledWith("system");
  });
});
