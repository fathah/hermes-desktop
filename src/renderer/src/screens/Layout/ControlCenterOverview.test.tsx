import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ControlCenterOverview from "./ControlCenterOverview";
import type { NormalizedAdminView } from "../../lib/openSettings";

const setSurface = vi.fn();

vi.mock("../SpsAgent/store", () => ({
  useStore: {
    getState: () => ({ setSurface }),
  },
}));

describe("ControlCenterOverview", () => {
  beforeEach(() => {
    setSurface.mockClear();
  });

  it("renders the task cards users need from the settings gear", () => {
    render(
      <ControlCenterOverview
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        profile="default"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Control Center" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open AI Setup" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Open Data & Privacy" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Open Troubleshooting" }),
    ).toBeEnabled();
  });

  it("routes personalization to the existing My Alignment surface", () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn<(view: NormalizedAdminView) => void>();

    render(
      <ControlCenterOverview
        onNavigate={onNavigate}
        onClose={onClose}
        profile="default"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Personalization" }));

    expect(setSurface).toHaveBeenCalledWith("you");
    expect(onClose).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
