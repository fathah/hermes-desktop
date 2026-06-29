import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewPanel } from "./WhatsNewPanel";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hermes-desktop-last-seen-version", "0.5.4");
  vi.stubGlobal("electron", { process: { platform: "darwin" } });
  vi.stubGlobal("hermesAPI", {
    getAppVersion: vi.fn().mockResolvedValue("0.5.5"),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WhatsNewPanel", () => {
  it("shows unseen affordances after an app version change", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    expect(await screen.findByText("PDFs in Capture")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Capture" }),
    ).toBeInTheDocument();
  });

  it("persists dismissal at the current version", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss what's new" }),
    );

    await waitFor(() =>
      expect(localStorage.getItem("hermes-desktop-last-seen-version")).toBe(
        "0.5.5",
      ),
    );
  });
});
