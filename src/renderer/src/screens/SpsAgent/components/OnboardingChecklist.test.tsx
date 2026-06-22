import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const setSurface = vi.fn();
const setPaletteOpen = vi.fn();
const openInboxImageCapture = vi.fn();

// Selector-level store mock (avoids the full store import chain).
vi.mock("../store", () => ({
  useStore: (sel: (s: unknown) => unknown) =>
    sel({ setSurface, setPaletteOpen, openInboxImageCapture }),
}));

import { OnboardingChecklist } from "./OnboardingChecklist";

beforeEach(() => {
  localStorage.clear();
  setSurface.mockClear();
  setPaletteOpen.mockClear();
  openInboxImageCapture.mockClear();
});
afterEach(cleanup);

describe("OnboardingChecklist", () => {
  it("renders the three steps on a fresh profile", () => {
    render(<OnboardingChecklist />);
    expect(screen.getByText("Get started in 3 steps")).toBeInTheDocument();
    expect(screen.getByText("Capture")).toBeInTheDocument();
    expect(screen.getByText("Ingest")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("Capture opens screenshot intake and Ingest opens the Inbox surface", () => {
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByText("Capture screenshot"));
    fireEvent.click(screen.getByText("Process Inbox"));
    expect(openInboxImageCapture).toHaveBeenCalledTimes(1);
    expect(setSurface).toHaveBeenCalledTimes(1);
    expect(setSurface).toHaveBeenCalledWith("inbox");
  });

  it("Search opens the command palette", () => {
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByText("Search (⌘K)"));
    expect(setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("dismiss hides it and persists to localStorage", () => {
    const { container } = render(<OnboardingChecklist />);
    fireEvent.click(screen.getByLabelText("Dismiss getting started"));
    expect(container.querySelector(".ob-checklist")).toBeNull();
    expect(
      localStorage.getItem("hermes_sps_onboarding_checklist_dismissed"),
    ).toBe("true");
  });

  it("renders nothing when already dismissed", () => {
    localStorage.setItem("hermes_sps_onboarding_checklist_dismissed", "true");
    const { container } = render(<OnboardingChecklist />);
    expect(container.querySelector(".ob-checklist")).toBeNull();
  });
});
